// CAPA 3 — SERVICIO: las reglas del negocio. No sabe que existe HTTP.
import {
  type AccionOrden,
  accionesPosibles,
  aDecimal,
  type AnularRecepcionInput,
  type CerrarOrdenInput,
  type CostoInsumo,
  costoPorUnidadBase,
  type CrearOrdenInput,
  type Decimal,
  diaEnArgentina,
  type EditarOrdenInput,
  estaAtrasada,
  type EstadoOrden,
  type FiltroOrdenes,
  type FiltroRecepciones,
  formatearCantidad,
  type ListaOrdenes,
  type ListaRecepciones,
  type OrdenDetalle,
  type OrdenResumen,
  pendienteDe,
  puedeHacer,
  recalcularEstadoOrden,
  type RecepcionDeOrdenInput,
  type RecepcionDetalle,
  type RecepcionDirectaInput,
  type RecepcionResumen,
  redondearCantidad,
  redondearDinero,
} from '@panaderia/shared';
import { randomUUID } from 'node:crypto';

import { registrarAuditoria } from '../../lib/auditoria.js';
import { type Contexto, puedeOperarEn } from '../../lib/contexto.js';
import { prisma } from '../../lib/db.js';
import { AppError, errores } from '../../lib/errores.js';
import { registrarMovimientos, type Tx } from '../movimientos/motor.js';
import { recalcularCostoPromedio } from './costo.js';
import { type LineaResuelta, resolverLineas } from './lineas.js';
import { siguienteNumero } from './numeracion.js';
import * as repo from './repo.js';

// ===========================================================================
// Traducción de filas de la base a objetos del dominio
// ===========================================================================

/** 'AAAA-MM-DD' → la fecha que guarda la columna `date`. */
function aColumnaDia(dia: string | null): Date | null {
  return dia === null ? null : new Date(`${dia}T00:00:00.000Z`);
}

/** Lo inverso: una columna `date` vuelve como medianoche UTC de ese día. */
function deColumnaDia(fecha: Date | null): string | null {
  return fecha === null ? null : fecha.toISOString().slice(0, 10);
}

/** Suma de cantidad × precio. Null si ninguna línea tiene precio. */
function totalDe(
  lineas: readonly {
    cantidad: { toString(): string };
    precioUnitario: { toString(): string } | null;
  }[],
): string | null {
  const conPrecio = lineas.filter((linea) => linea.precioUnitario !== null);
  if (conPrecio.length === 0) return null;
  return redondearDinero(
    conPrecio.reduce(
      (suma, linea) =>
        suma.plus(
          aDecimal(linea.cantidad.toString()).times(aDecimal(String(linea.precioUnitario))),
        ),
      aDecimal('0'),
    ),
  ).toString();
}

function aOrdenResumen(fila: repo.FilaOrdenResumen, hoy: string): OrdenResumen {
  const fechaEntregaEstimada = deColumnaDia(fila.fechaEntregaEstimada);
  return {
    id: fila.id,
    numero: fila.numero,
    estado: fila.estado,
    sucursal: fila.sucursal,
    proveedor: fila.proveedor,
    usuario: fila.usuario,
    fechaEntregaEstimada,
    atrasada: estaAtrasada(fila.estado, fechaEntregaEstimada, hoy),
    creadaAt: fila.createdAt.toISOString(),
    pedidaAt: fila.pedidaAt?.toISOString() ?? null,
    totalEstimado: totalDe(fila.lineas),
    cantidadLineas: fila.lineas.length,
  };
}

function aRecepcionResumen(fila: repo.FilaRecepcionResumen): RecepcionResumen {
  return {
    id: fila.id,
    numero: fila.numero,
    estado: fila.estado,
    fecha: fila.fecha.toISOString(),
    sucursal: fila.sucursal,
    proveedor: fila.proveedor,
    orden: fila.orden,
    numeroRemito: fila.numeroRemito,
    numeroFactura: fila.numeroFactura,
    total: totalDe(fila.lineas) ?? '0',
    usuario: fila.usuario,
    anuladaAt: fila.anuladaAt?.toISOString() ?? null,
  };
}

// ===========================================================================
// Reglas compartidas
// ===========================================================================

async function exigirProveedorActivo(ctx: Contexto, proveedorId: string) {
  const proveedor = await repo.buscarProveedor(ctx.empresaId, proveedorId);
  if (!proveedor) {
    throw errores.datosInvalidos({ proveedorId: 'Ese proveedor no existe en tu empresa.' });
  }
  if (!proveedor.activo) {
    throw errores.datosInvalidos({
      proveedorId: `"${proveedor.nombre}" está inactivo: reactivalo antes de comprarle.`,
    });
  }
  return proveedor;
}

async function exigirSucursal(ctx: Contexto, sucursalId: string) {
  const sucursal = await repo.buscarSucursal(ctx.empresaId, sucursalId);
  if (!sucursal) throw errores.noEncontrado('La sucursal');
  return sucursal;
}

/**
 * La transición que se pidió no está en la máquina de estados.
 *
 * Es 409 (conflicto con el estado actual), no 400: el pedido está bien
 * formado, lo que pasa es que la orden ya no está en un estado que lo admita.
 */
function transicionInvalida(numero: number, estado: EstadoOrden, accion: AccionOrden): AppError {
  const verbos: Record<AccionOrden, string> = {
    editar: 'editar',
    pedir: 'marcar como pedida',
    recibir: 'recibir',
    cancelar: 'cancelar',
    cerrar: 'cerrar con faltante',
  };
  const pista =
    accion === 'recibir' && estado === 'BORRADOR'
      ? ' Marcala como pedida primero.'
      : accion === 'cancelar' && estado === 'PARCIAL'
        ? ' Ya llegó una parte: si el resto no va a llegar, cerrala con faltante.'
        : '';
  return new AppError(
    'TRANSICION_INVALIDA',
    `La orden ${String(numero)} está ${estado.toLowerCase()}: no se puede ${verbos[accion]}.${pista}`,
    409,
    { estado, accion },
  );
}

/**
 * Lleva el precio de una presentación a la presentación con la que el
 * proveedor tiene registrado el insumo.
 *
 * Caso real: la asociación dice "bolsa de 50 kg" y esta vez se compraron
 * bolsas de 25. El precio de la bolsa de 25 no puede guardarse como precio de
 * la de 50: se pasa por el costo del kilo y se multiplica por 50.
 */
async function precioParaAsociacion(
  tx: Tx,
  presentacionDeLaAsociacion: string | null,
  linea: { presentacionId: string | null; precioUnitario: Decimal; costoUnitarioBase: Decimal },
): Promise<Decimal> {
  if (presentacionDeLaAsociacion === linea.presentacionId) return linea.precioUnitario;
  if (presentacionDeLaAsociacion === null) return linea.costoUnitarioBase;

  const presentacion = await repo.cantidadBaseDePresentacion(tx, presentacionDeLaAsociacion);
  if (!presentacion) return linea.costoUnitarioBase;
  return redondearDinero(linea.costoUnitarioBase.times(presentacion.cantidadBase.toString()));
}

type LineaConPrecio = LineaResuelta & {
  precioUnitario: Decimal;
  costoUnitarioBase: Decimal;
  lineaOrdenCompraId: string | null;
};

/**
 * Pedido C-7 del cliente: "el precio se carga cada vez que se carga una
 * compra". La recepción actualiza sola el último precio del proveedor.
 *
 * Dos detalles:
 *   - Si el proveedor nunca había figurado para ese insumo, se crea la
 *     asociación: si le compraste, te lo provee.
 *   - Una recepción con fecha VIEJA (cargada tarde) no pisa un precio más
 *     nuevo. "Último" es por fecha del hecho, no por orden de carga.
 */
async function actualizarUltimosPrecios(
  tx: Tx,
  empresaId: string,
  proveedorId: string,
  lineas: readonly LineaConPrecio[],
  fecha: Date,
): Promise<void> {
  // Ordenadas por insumo, como todo lo que toma candados.
  for (const linea of [...lineas].sort((a, b) => a.insumoId.localeCompare(b.insumoId))) {
    const existente = await repo.asociacion(tx, proveedorId, linea.insumoId);

    if (!existente) {
      await tx.proveedorInsumo.create({
        data: {
          empresaId,
          proveedorId,
          insumoId: linea.insumoId,
          presentacionId: linea.presentacionId,
          ultimoPrecio: linea.precioUnitario.toString(),
          ultimoPrecioAt: fecha,
        },
      });
      continue;
    }

    if (existente.ultimoPrecioAt !== null && existente.ultimoPrecioAt > fecha) continue;

    const precio = await precioParaAsociacion(tx, existente.presentacionId, linea);
    await tx.proveedorInsumo.update({
      where: { id: existente.id },
      data: { ultimoPrecio: precio.toString(), ultimoPrecioAt: fecha },
    });
  }
}

/**
 * Al anular una recepción, el último precio que ELLA puso deja de ser cierto
 * (muchas veces se anula justamente porque el precio se cargó mal). Se vuelve
 * al de la recepción confirmada anterior. Si no hay ninguna, se deja como
 * estaba: puede ser el precio que se cargó a mano en la ficha del proveedor.
 */
async function restaurarUltimosPrecios(
  tx: Tx,
  empresaId: string,
  recepcion: { proveedorId: string; fecha: Date },
  insumoIds: readonly string[],
): Promise<void> {
  for (const insumoId of [...insumoIds].sort()) {
    const existente = await repo.asociacion(tx, recepcion.proveedorId, insumoId);
    // Si el precio vigente no es el de esta recepción, no fue ella quien lo
    // puso (hubo una compra posterior o una edición a mano): no se toca.
    if (existente?.ultimoPrecioAt?.getTime() !== recepcion.fecha.getTime()) continue;

    const anterior = await repo.ultimaRecepcionConfirmada(
      tx,
      empresaId,
      recepcion.proveedorId,
      insumoId,
    );
    if (!anterior) continue;

    const linea = await repo.lineaDeRecepcion(tx, anterior.id, insumoId);
    if (!linea) continue;

    const precio = await precioParaAsociacion(tx, existente.presentacionId, {
      presentacionId: linea.presentacionId,
      precioUnitario: aDecimal(linea.precioUnitario.toString()),
      costoUnitarioBase: aDecimal(linea.costoUnitarioBase.toString()),
    });
    await tx.proveedorInsumo.update({
      where: { id: existente.id },
      data: { ultimoPrecio: precio.toString(), ultimoPrecioAt: anterior.fecha },
    });
  }
}

/** Recalcula el estado de la orden según lo recibido y lo guarda si cambió. */
async function actualizarEstadoOrden(
  tx: Tx,
  orden: { id: string; estado: EstadoOrden },
): Promise<EstadoOrden> {
  const lineas = await repo.lineasDeOrden(tx, orden.id);
  const recibido = await repo.recibidoPorLinea(tx, orden.id);

  const nuevo = recalcularEstadoOrden(
    orden.estado,
    lineas.map((linea) => ({
      pedido: linea.cantidadBase.toString(),
      recibido: recibido.get(linea.id) ?? '0',
    })),
  );
  if (nuevo !== orden.estado) {
    await tx.ordenCompra.update({ where: { id: orden.id }, data: { estado: nuevo } });
  }
  return nuevo;
}

// ===========================================================================
// Órdenes de compra
// ===========================================================================

function datosDeLineasDeOrden(
  empresaId: string,
  ordenId: string,
  lineas: readonly LineaResuelta[],
  precios: readonly (string | null)[],
) {
  return lineas.map((linea, indice) => ({
    empresaId,
    ordenCompraId: ordenId,
    insumoId: linea.insumoId,
    presentacionId: linea.presentacionId,
    cantidad: linea.cantidad.toString(),
    factorConversion: linea.factor.toString(),
    cantidadBase: linea.cantidadBase.toString(),
    precioUnitario: precios[indice] ?? null,
  }));
}

/**
 * Crea una orden: nace PEDIDA (el dueño la carga mientras le escribe al
 * proveedor) o en BORRADOR (para terminarla después). Las dos cosas las pidió
 * el cliente.
 */
export async function crearOrden(ctx: Contexto, entrada: CrearOrdenInput): Promise<OrdenDetalle> {
  await exigirSucursal(ctx, entrada.sucursalId);
  await exigirProveedorActivo(ctx, entrada.proveedorId);
  const lineas = await resolverLineas(ctx, entrada.lineas);

  const ordenId = await prisma.$transaction(async (tx) => {
    const numero = await siguienteNumero(tx, ctx.empresaId, 'ORDEN_COMPRA');
    const ahora = new Date();

    const orden = await tx.ordenCompra.create({
      data: {
        empresaId: ctx.empresaId,
        sucursalId: entrada.sucursalId,
        proveedorId: entrada.proveedorId,
        numero,
        estado: entrada.pedir ? 'PEDIDA' : 'BORRADOR',
        pedidaAt: entrada.pedir ? ahora : null,
        fechaEntregaEstimada: aColumnaDia(entrada.fechaEntregaEstimada),
        notas: entrada.notas,
        usuarioId: ctx.usuarioId,
      },
      select: { id: true },
    });

    await tx.lineaOrdenCompra.createMany({
      data: datosDeLineasDeOrden(
        ctx.empresaId,
        orden.id,
        lineas,
        entrada.lineas.map((linea) => linea.precioUnitario),
      ),
    });

    await registrarAuditoria(tx, {
      empresaId: ctx.empresaId,
      usuarioId: ctx.usuarioId,
      entidad: 'orden_compra',
      entidadId: orden.id,
      accion: 'CREAR',
      datosDespues: { numero, ...entrada },
      ip: ctx.ip ?? null,
    });

    return orden.id;
  });

  return obtenerOrden(ctx, ordenId);
}

/**
 * Edita una orden: reemplaza la cabecera y las líneas.
 *
 * Solo mientras no llegó nada, y eso incluye recepciones ANULADAS: sus líneas
 * apuntan a las de la orden, y reemplazarlas dejaría el historial de la
 * recepción anulada apuntando a una línea que ya no existe.
 */
export async function editarOrden(
  ctx: Contexto,
  ordenId: string,
  entrada: EditarOrdenInput,
): Promise<OrdenDetalle> {
  await exigirSucursal(ctx, entrada.sucursalId);
  await exigirProveedorActivo(ctx, entrada.proveedorId);
  const lineas = await resolverLineas(ctx, entrada.lineas);

  await prisma.$transaction(async (tx) => {
    if (!(await repo.bloquearOrden(tx, ctx.empresaId, ordenId))) {
      throw errores.noEncontrado('La orden de compra');
    }
    const orden = await repo.ordenPlana(tx, ctx.empresaId, ordenId);
    if (!orden) throw errores.noEncontrado('La orden de compra');

    if (!puedeHacer(orden.estado, 'editar')) {
      throw transicionInvalida(orden.numero, orden.estado, 'editar');
    }
    if ((await repo.contarRecepcionesDeOrden(tx, ordenId)) > 0) {
      throw new AppError(
        'ORDEN_CON_RECEPCIONES',
        `La orden ${String(orden.numero)} ya tuvo recepciones: no se puede editar.`,
        409,
      );
    }

    const antes = await repo.lineasDeOrden(tx, ordenId);

    await tx.lineaOrdenCompra.deleteMany({ where: { ordenCompraId: ordenId } });
    await tx.ordenCompra.update({
      where: { id: ordenId },
      data: {
        sucursalId: entrada.sucursalId,
        proveedorId: entrada.proveedorId,
        fechaEntregaEstimada: aColumnaDia(entrada.fechaEntregaEstimada),
        notas: entrada.notas,
      },
    });
    await tx.lineaOrdenCompra.createMany({
      data: datosDeLineasDeOrden(
        ctx.empresaId,
        ordenId,
        lineas,
        entrada.lineas.map((linea) => linea.precioUnitario),
      ),
    });

    await registrarAuditoria(tx, {
      empresaId: ctx.empresaId,
      usuarioId: ctx.usuarioId,
      entidad: 'orden_compra',
      entidadId: ordenId,
      accion: 'ACTUALIZAR',
      datosAntes: { ...orden, lineas: antes },
      datosDespues: entrada,
      ip: ctx.ip ?? null,
    });
  });

  return obtenerOrden(ctx, ordenId);
}

/**
 * Las tres transiciones manuales: pedir, cancelar y cerrar con faltante.
 *
 * Las tres siguen el mismo recorrido —bloquear, leer el estado CON el
 * candado, preguntarle a la máquina de estados, escribir, auditar— así que
 * comparten la función. Lo que cambia es qué se escribe.
 */
async function transicionar(
  ctx: Contexto,
  ordenId: string,
  accion: 'pedir' | 'cancelar' | 'cerrar',
  nota: string | null,
): Promise<OrdenDetalle> {
  await prisma.$transaction(async (tx) => {
    if (!(await repo.bloquearOrden(tx, ctx.empresaId, ordenId))) {
      throw errores.noEncontrado('La orden de compra');
    }
    const orden = await repo.ordenPlana(tx, ctx.empresaId, ordenId);
    if (!orden) throw errores.noEncontrado('La orden de compra');

    if (!puedeHacer(orden.estado, accion)) {
      throw transicionInvalida(orden.numero, orden.estado, accion);
    }

    const ahora = new Date();
    const datos =
      accion === 'pedir'
        ? { estado: 'PEDIDA' as const, pedidaAt: ahora }
        : {
            estado: accion === 'cancelar' ? ('CANCELADA' as const) : ('CERRADA' as const),
            cerradaAt: ahora,
            notaCierre: nota,
          };

    await tx.ordenCompra.update({ where: { id: ordenId }, data: datos });

    await registrarAuditoria(tx, {
      empresaId: ctx.empresaId,
      usuarioId: ctx.usuarioId,
      entidad: 'orden_compra',
      entidadId: ordenId,
      accion: accion === 'pedir' ? 'ACTUALIZAR' : 'ANULAR',
      datosAntes: { estado: orden.estado },
      datosDespues: { ...datos, accion },
      ip: ctx.ip ?? null,
    });
  });

  return obtenerOrden(ctx, ordenId);
}

export function pedirOrden(ctx: Contexto, ordenId: string): Promise<OrdenDetalle> {
  return transicionar(ctx, ordenId, 'pedir', null);
}

export function cancelarOrden(
  ctx: Contexto,
  ordenId: string,
  entrada: CerrarOrdenInput,
): Promise<OrdenDetalle> {
  return transicionar(ctx, ordenId, 'cancelar', entrada.nota);
}

/** "Lo que falta no va a llegar." Respuesta del cliente al arrancar la fase. */
export function cerrarOrden(
  ctx: Contexto,
  ordenId: string,
  entrada: CerrarOrdenInput,
): Promise<OrdenDetalle> {
  return transicionar(ctx, ordenId, 'cerrar', entrada.nota);
}

export async function obtenerOrden(ctx: Contexto, ordenId: string): Promise<OrdenDetalle> {
  const fila = await repo.ordenDetalle(ctx.empresaId, ordenId);
  if (!fila) throw errores.noEncontrado('La orden de compra');
  // El encargado ve solo las órdenes de SUS sucursales.
  if (!puedeOperarEn(ctx, fila.sucursalId)) throw errores.sucursalNoPermitida();

  const [recibido, recepciones] = await Promise.all([
    repo.recibidoPorLinea(prisma, ordenId),
    repo.listarRecepciones({
      empresaId: ctx.empresaId,
      sucursalIds: ctx.sucursalesPermitidas,
      proveedorId: undefined,
      ordenCompraId: ordenId,
      limite: 200,
      desplazamiento: 0,
    }),
  ]);

  const hoy = diaEnArgentina(new Date());
  const lineas = fila.lineas.map((linea) => {
    const recibidoBase = recibido.get(linea.id) ?? '0';
    const pendienteBase = pendienteDe({
      pedido: linea.cantidadBase.toString(),
      recibido: recibidoBase,
    });
    return {
      id: linea.id,
      insumo: {
        id: linea.insumo.id,
        nombre: linea.insumo.nombre,
        unidadBaseCodigo: linea.insumo.unidadBase.codigo,
      },
      presentacion: linea.presentacion,
      cantidad: linea.cantidad.toString(),
      factorConversion: linea.factorConversion.toString(),
      cantidadBase: linea.cantidadBase.toString(),
      precioUnitario: linea.precioUnitario?.toString() ?? null,
      recibidoBase,
      pendienteBase: pendienteBase.toString(),
      // "Faltan 6 bolsas": lo pendiente, en la misma unidad en que se pidió.
      pendiente: redondearCantidad(
        pendienteBase.dividedBy(linea.factorConversion.toString()),
      ).toString(),
    };
  });

  // Editar depende también de que no haya recepciones (ni siquiera anuladas).
  const acciones = accionesPosibles(fila.estado).filter(
    (accion) => accion !== 'editar' || recepciones.length === 0,
  );

  return {
    ...aOrdenResumen(fila, hoy),
    notas: fila.notas,
    notaCierre: fila.notaCierre,
    cerradaAt: fila.cerradaAt?.toISOString() ?? null,
    lineas,
    recepciones: recepciones.map(aRecepcionResumen),
    acciones: [...acciones],
  };
}

export async function listarOrdenes(ctx: Contexto, filtro: FiltroOrdenes): Promise<ListaOrdenes> {
  const sucursalIds =
    filtro.sucursalId === undefined
      ? ctx.sucursalesPermitidas
      : ctx.sucursalesPermitidas.filter((id) => id === filtro.sucursalId);

  const consulta: repo.FiltroListaOrdenes = {
    empresaId: ctx.empresaId,
    sucursalIds,
    estados: filtro.soloPendientes
      ? ['PEDIDA', 'PARCIAL']
      : filtro.estado === undefined
        ? undefined
        : [filtro.estado],
    proveedorId: filtro.proveedorId,
    limite: filtro.limite,
    desplazamiento: filtro.desplazamiento,
  };

  const [filas, total] = await Promise.all([
    repo.listarOrdenes(consulta),
    repo.contarOrdenes(consulta),
  ]);

  const hoy = diaEnArgentina(new Date());
  return { items: filas.map((fila) => aOrdenResumen(fila, hoy)), total };
}

// ===========================================================================
// Recepciones
// ===========================================================================

type DatosConfirmacion = {
  sucursalId: string;
  proveedorId: string;
  ordenCompraId: string | null;
  fecha: Date;
  numeroRemito: string | null;
  numeroFactura: string | null;
  notas: string | null;
  lineas: readonly LineaConPrecio[];
};

/**
 * CONFIRMAR UNA RECEPCIÓN. Todo en la transacción del que llama:
 *
 *   1. número de documento (candado del contador)
 *   2. la recepción y sus líneas
 *   3. un movimiento COMPRA por línea, con su costo (el motor)
 *   4. el costo promedio de cada insumo, reconstruido
 *   5. el último precio del proveedor
 *   6. la auditoría
 *
 * Si cualquiera falla, no queda nada: ni el número gastado, ni el stock, ni
 * el precio. Una recepción a medias sería peor que ninguna.
 *
 * EL ORDEN DE LOS CANDADOS, para todo el módulo (y por qué no hay abrazos
 * mortales): recepción → orden → contador → insumo_sucursal → insumo →
 * proveedor_insumo. Toda operación que tome más de uno, los toma en ese orden.
 */
async function confirmarRecepcion(
  tx: Tx,
  ctx: Contexto,
  datos: DatosConfirmacion,
): Promise<{ id: string; costos: Map<string, Decimal | null> }> {
  const numero = await siguienteNumero(tx, ctx.empresaId, 'RECEPCION_COMPRA');
  const recepcionId = randomUUID();
  const operacionId = randomUUID();

  await tx.recepcionCompra.create({
    data: {
      id: recepcionId,
      empresaId: ctx.empresaId,
      sucursalId: datos.sucursalId,
      proveedorId: datos.proveedorId,
      ordenCompraId: datos.ordenCompraId,
      numero,
      fecha: datos.fecha,
      numeroRemito: datos.numeroRemito,
      numeroFactura: datos.numeroFactura,
      notas: datos.notas,
      usuarioId: ctx.usuarioId,
      operacionId,
    },
    select: { id: true },
  });

  await tx.lineaRecepcionCompra.createMany({
    data: datos.lineas.map((linea) => ({
      empresaId: ctx.empresaId,
      recepcionCompraId: recepcionId,
      lineaOrdenCompraId: linea.lineaOrdenCompraId,
      insumoId: linea.insumoId,
      presentacionId: linea.presentacionId,
      cantidad: linea.cantidad.toString(),
      factorConversion: linea.factor.toString(),
      cantidadBase: linea.cantidadBase.toString(),
      precioUnitario: linea.precioUnitario.toString(),
      costoUnitarioBase: linea.costoUnitarioBase.toString(),
    })),
  });

  // El stock entra por el ÚNICO lugar por donde entra todo: el motor. La
  // cantidad va en unidad base (la conversión ya la hizo la línea con el
  // factor de la presentación) y el costo, por unidad base.
  await registrarMovimientos(
    tx,
    ctx,
    datos.lineas.map((linea) => ({
      sucursalId: datos.sucursalId,
      insumoId: linea.insumoId,
      tipo: 'COMPRA' as const,
      cantidad: linea.cantidadBase,
      unidadId: null,
      costoUnitario: linea.costoUnitarioBase,
      recepcionCompraId: recepcionId,
      notas: datos.numeroRemito === null ? null : `Remito ${datos.numeroRemito}`,
    })),
    { fecha: datos.fecha, operacionId },
  );

  const costos = await recalcularCostoPromedio(
    tx,
    ctx.empresaId,
    datos.lineas.map((linea) => linea.insumoId),
  );

  await actualizarUltimosPrecios(tx, ctx.empresaId, datos.proveedorId, datos.lineas, datos.fecha);

  await registrarAuditoria(tx, {
    empresaId: ctx.empresaId,
    usuarioId: ctx.usuarioId,
    entidad: 'recepcion_compra',
    entidadId: recepcionId,
    accion: 'CREAR',
    datosDespues: {
      numero,
      sucursalId: datos.sucursalId,
      proveedorId: datos.proveedorId,
      ordenCompraId: datos.ordenCompraId,
      numeroRemito: datos.numeroRemito,
      lineas: datos.lineas.map((linea) => ({
        insumoId: linea.insumoId,
        cantidad: linea.cantidad.toString(),
        presentacionId: linea.presentacionId,
        precioUnitario: linea.precioUnitario.toString(),
      })),
    },
    ip: ctx.ip ?? null,
  });

  return { id: recepcionId, costos };
}

function conPrecio(
  linea: LineaResuelta,
  precioUnitario: string,
  lineaOrdenCompraId: string | null,
): LineaConPrecio {
  const precio = aDecimal(precioUnitario);
  return {
    ...linea,
    precioUnitario: precio,
    // $25.000 la bolsa / 25 kg = $1.000 el kilo.
    costoUnitarioBase: costoPorUnidadBase(precio, linea.factor),
    lineaOrdenCompraId,
  };
}

/** Llegó mercadería sin orden previa: la compra por teléfono. */
export async function recibirDirecta(
  ctx: Contexto,
  entrada: RecepcionDirectaInput,
): Promise<RecepcionDetalle> {
  await exigirSucursal(ctx, entrada.sucursalId);
  await exigirProveedorActivo(ctx, entrada.proveedorId);
  const resueltas = await resolverLineas(ctx, entrada.lineas);
  const lineas = resueltas.map((linea, indice) =>
    conPrecio(linea, entrada.lineas[indice]?.precioUnitario ?? '0', null),
  );

  const { id } = await prisma.$transaction((tx) =>
    confirmarRecepcion(tx, ctx, {
      sucursalId: entrada.sucursalId,
      proveedorId: entrada.proveedorId,
      ordenCompraId: null,
      fecha: entrada.fecha === null ? new Date() : new Date(entrada.fecha),
      numeroRemito: entrada.numeroRemito,
      numeroFactura: entrada.numeroFactura,
      notas: entrada.notas,
      lineas,
    }),
  );

  return obtenerRecepcion(ctx, id);
}

/**
 * Recibir (todo o una parte de) una orden.
 *
 * LA REGLA DE ESTA FASE: no se puede recibir más de lo que falta. Y "lo que
 * falta" se calcula ADENTRO de la transacción y DESPUÉS del candado de la
 * orden: si se leyera antes, dos recepciones simultáneas leerían las dos
 * "faltan 6", recibirían 6 cada una, y la orden terminaría con 16 de 10. Es la
 * misma lección de la Fase 6: una validación que lee el estado sin el candado
 * no valida nada.
 *
 * Si lo que llegó es MÁS de lo pedido (el proveedor mandó de más), lo que
 * sobra se carga como una recepción directa: así la orden dice la verdad de
 * lo que se pidió, y la mercadería extra igual entra al stock.
 */
export async function recibirDeOrden(
  ctx: Contexto,
  ordenId: string,
  entrada: RecepcionDeOrdenInput,
): Promise<RecepcionDetalle> {
  const { id } = await prisma.$transaction(async (tx) => {
    if (!(await repo.bloquearOrden(tx, ctx.empresaId, ordenId))) {
      throw errores.noEncontrado('La orden de compra');
    }
    const orden = await repo.ordenPlana(tx, ctx.empresaId, ordenId);
    if (!orden) throw errores.noEncontrado('La orden de compra');

    // La sucursal no viene en el pedido: es la de la orden. Por eso el
    // control lo hace el servicio y no el middleware.
    if (!puedeOperarEn(ctx, orden.sucursalId)) throw errores.sucursalNoPermitida();

    if (!puedeHacer(orden.estado, 'recibir')) {
      throw transicionInvalida(orden.numero, orden.estado, 'recibir');
    }

    const lineasOrden = new Map(
      (await repo.lineasDeOrden(tx, ordenId)).map((linea) => [linea.id, linea]),
    );
    const recibido = await repo.recibidoPorLinea(tx, ordenId);
    const nombres = new Map(
      (
        await tx.insumo.findMany({
          where: {
            empresaId: ctx.empresaId,
            id: { in: [...lineasOrden.values()].map((l) => l.insumoId) },
          },
          select: { id: true, nombre: true },
        })
      ).map((insumo) => [insumo.id, insumo.nombre]),
    );

    const lineas: LineaConPrecio[] = entrada.lineas.map((entradaLinea, indice) => {
      const campo = (nombre: string) => `lineas.${String(indice)}.${nombre}`;
      const lineaOrden = lineasOrden.get(entradaLinea.lineaOrdenId);
      if (!lineaOrden) {
        throw errores.datosInvalidos({ [campo('lineaOrdenId')]: 'Esa línea no es de esta orden.' });
      }

      // El factor es el de la ORDEN (su snapshot), no el de la presentación
      // de hoy: "recibí 4 de las bolsas que pedí" tiene que medirse con la
      // misma vara con que se pidió.
      const factor = aDecimal(lineaOrden.factorConversion.toString());
      const cantidad = redondearCantidad(entradaLinea.cantidad);
      const cantidadBase = redondearCantidad(cantidad.times(factor));

      const pendiente = pendienteDe({
        pedido: lineaOrden.cantidadBase.toString(),
        recibido: recibido.get(lineaOrden.id) ?? '0',
      });
      if (cantidadBase.greaterThan(pendiente)) {
        const nombre = nombres.get(lineaOrden.insumoId) ?? 'ese insumo';
        throw new AppError(
          'CANTIDAD_MAYOR_A_PENDIENTE',
          `De ${nombre} faltan ${formatearCantidad(pendiente.dividedBy(factor))} y querés recibir ` +
            `${formatearCantidad(cantidad)}. Si llegó de más, cargá lo que sobra como una recepción sin orden.`,
          409,
          { lineaOrdenId: lineaOrden.id, pendiente: pendiente.dividedBy(factor).toString() },
        );
      }

      return conPrecio(
        {
          insumoId: lineaOrden.insumoId,
          insumoNombre: nombres.get(lineaOrden.insumoId) ?? '',
          presentacionId: lineaOrden.presentacionId,
          cantidad,
          factor,
          cantidadBase,
        },
        entradaLinea.precioUnitario,
        lineaOrden.id,
      );
    });

    const confirmada = await confirmarRecepcion(tx, ctx, {
      sucursalId: orden.sucursalId,
      proveedorId: orden.proveedorId,
      ordenCompraId: ordenId,
      fecha: entrada.fecha === null ? new Date() : new Date(entrada.fecha),
      numeroRemito: entrada.numeroRemito,
      numeroFactura: entrada.numeroFactura,
      notas: entrada.notas,
      lineas,
    });

    // PEDIDA → PARCIAL → RECIBIDA: no lo elige nadie, lo dice lo que llegó.
    await actualizarEstadoOrden(tx, orden);
    return confirmada;
  });

  return obtenerRecepcion(ctx, id);
}

/**
 * ANULAR UNA RECEPCIÓN: el contra-asiento de un documento entero.
 *
 * No se borra nada. Se escribe una REVERSA por cada movimiento COMPRA, la
 * recepción queda ANULADA (con quién, cuándo y por qué), y se reconstruyen las
 * tres cosas que dependían de ella: el costo promedio, el último precio del
 * proveedor y el estado de la orden.
 *
 * Si la mercadería que entró ya se usó, sacarla deja el stock en negativo:
 * el motor lo frena con STOCK_INSUFICIENTE, salvo que se pida forzar con
 * permiso, igual que al anular cualquier otra entrada.
 */
export async function anularRecepcion(
  ctx: Contexto,
  recepcionId: string,
  entrada: AnularRecepcionInput,
): Promise<RecepcionDetalle> {
  await prisma.$transaction(async (tx) => {
    if (!(await repo.bloquearRecepcion(tx, ctx.empresaId, recepcionId))) {
      throw errores.noEncontrado('La recepción');
    }
    const recepcion = await repo.recepcionPlana(tx, ctx.empresaId, recepcionId);
    if (!recepcion) throw errores.noEncontrado('La recepción');

    if (!puedeOperarEn(ctx, recepcion.sucursalId)) throw errores.sucursalNoPermitida();

    if (recepcion.estado === 'ANULADA') {
      throw new AppError(
        'RECEPCION_YA_ANULADA',
        `La recepción ${String(recepcion.numero)} ya fue anulada.`,
        409,
      );
    }

    // Mismo orden de candados que al recibir: recepción → orden → el resto.
    const orden =
      recepcion.ordenCompraId === null
        ? null
        : await (async (ordenId: string) => {
            await repo.bloquearOrden(tx, ctx.empresaId, ordenId);
            return repo.ordenPlana(tx, ctx.empresaId, ordenId);
          })(recepcion.ordenCompraId);

    const compras = await repo.comprasDeRecepcion(tx, ctx.empresaId, recepcionId);

    await registrarMovimientos(
      tx,
      ctx,
      compras.map((compra) => ({
        sucursalId: compra.sucursalId,
        insumoId: compra.insumoId,
        tipo: 'REVERSA' as const,
        cantidad: aDecimal(compra.cantidadBase.toString()).abs(),
        unidadId: null,
        sentido: 'SALIDA' as const,
        revierteAId: compra.id,
        // Sale al mismo costo con que entró: la reversa es la compra al revés.
        costoUnitario: compra.costoUnitario?.toString() ?? null,
        recepcionCompraId: recepcionId,
        notas: `Anulación de la recepción ${String(recepcion.numero)}: ${entrada.motivo}`,
      })),
      { forzar: entrada.forzar },
    );

    // Primero se marca ANULADA y DESPUÉS se reconstruye: las consultas de
    // "lo recibido" y del "último precio" miran solo las CONFIRMADAS.
    await tx.recepcionCompra.update({
      where: { id: recepcionId },
      data: {
        estado: 'ANULADA',
        anuladaAt: new Date(),
        anuladaPorId: ctx.usuarioId,
        motivoAnulacion: entrada.motivo,
      },
    });

    const insumoIds = compras.map((compra) => compra.insumoId);
    await recalcularCostoPromedio(tx, ctx.empresaId, insumoIds);
    await restaurarUltimosPrecios(tx, ctx.empresaId, recepcion, insumoIds);
    if (orden) await actualizarEstadoOrden(tx, orden);

    await registrarAuditoria(tx, {
      empresaId: ctx.empresaId,
      usuarioId: ctx.usuarioId,
      entidad: 'recepcion_compra',
      entidadId: recepcionId,
      accion: 'ANULAR',
      datosAntes: { estado: 'CONFIRMADA', numero: recepcion.numero },
      datosDespues: { estado: 'ANULADA', motivo: entrada.motivo, forzar: entrada.forzar },
      ip: ctx.ip ?? null,
    });
  });

  return obtenerRecepcion(ctx, recepcionId);
}

export async function obtenerRecepcion(
  ctx: Contexto,
  recepcionId: string,
): Promise<RecepcionDetalle> {
  const fila = await repo.recepcionDetalle(ctx.empresaId, recepcionId);
  if (!fila) throw errores.noEncontrado('La recepción');
  if (!puedeOperarEn(ctx, fila.sucursalId)) throw errores.sucursalNoPermitida();

  return {
    ...aRecepcionResumen(fila),
    notas: fila.notas,
    operacionId: fila.operacionId,
    anuladaPor: fila.anuladaPor,
    motivoAnulacion: fila.motivoAnulacion,
    lineas: fila.lineas.map((linea) => ({
      id: linea.id,
      lineaOrdenId: linea.lineaOrdenCompraId,
      insumo: {
        id: linea.insumo.id,
        nombre: linea.insumo.nombre,
        unidadBaseCodigo: linea.insumo.unidadBase.codigo,
      },
      presentacion: linea.presentacion,
      cantidad: linea.cantidad.toString(),
      factorConversion: linea.factorConversion.toString(),
      cantidadBase: linea.cantidadBase.toString(),
      precioUnitario: linea.precioUnitario.toString(),
      costoUnitarioBase: linea.costoUnitarioBase.toString(),
      subtotal: redondearDinero(
        aDecimal(linea.cantidad.toString()).times(linea.precioUnitario.toString()),
      ).toString(),
    })),
    costos: fila.lineas.map((linea) => ({
      insumoId: linea.insumo.id,
      insumoNombre: linea.insumo.nombre,
      unidadBaseCodigo: linea.insumo.unidadBase.codigo,
      costoPromedio: linea.insumo.costoPromedio?.toString() ?? null,
    })),
  };
}

export async function listarRecepciones(
  ctx: Contexto,
  filtro: FiltroRecepciones,
): Promise<ListaRecepciones> {
  const consulta: repo.FiltroListaRecepciones = {
    empresaId: ctx.empresaId,
    sucursalIds:
      filtro.sucursalId === undefined
        ? ctx.sucursalesPermitidas
        : ctx.sucursalesPermitidas.filter((id) => id === filtro.sucursalId),
    proveedorId: filtro.proveedorId,
    limite: filtro.limite,
    desplazamiento: filtro.desplazamiento,
  };
  const [filas, total] = await Promise.all([
    repo.listarRecepciones(consulta),
    repo.contarRecepciones(consulta),
  ]);
  return { items: filas.map(aRecepcionResumen), total };
}

/** El costo promedio de un insumo, para su ficha. */
export async function costoDeInsumo(ctx: Contexto, insumoId: string): Promise<CostoInsumo> {
  const fila = await repo.costoDeInsumo(ctx.empresaId, insumoId);
  if (!fila) throw errores.noEncontrado('El insumo');
  return {
    insumoId: fila.id,
    unidadBaseCodigo: fila.unidadBase.codigo,
    costoPromedio: fila.costoPromedio?.toString() ?? null,
  };
}
