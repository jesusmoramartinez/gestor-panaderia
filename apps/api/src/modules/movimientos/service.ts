// CAPA 3 — SERVICIO: las reglas del negocio. No sabe que existe HTTP.
import {
  aDecimal,
  type AnularMovimientoInput,
  type CargarConsumoInput,
  type CargarMermaInput,
  type CargarSaldoInicialInput,
  estadoDeStock,
  type FilaStock,
  type FiltroHistorial,
  type FiltroStock,
  type HistorialMovimientos,
  type Motivo,
  type Movimiento,
  type ResultadoCarga,
  type StockPorSucursal,
} from '@panaderia/shared';

import { type Contexto, puedeOperarEn } from '../../lib/contexto.js';
import { prisma } from '../../lib/db.js';
import { AppError, errores } from '../../lib/errores.js';
import {
  bloquearContador,
  type EntradaMovimiento,
  registrarMovimientos,
  type ResultadoRegistro,
} from './motor.js';
import * as repo from './repo.js';

// ===========================================================================
// Traducción de filas de la base a objetos del dominio
// ===========================================================================

function aMovimiento(fila: repo.FilaMovimiento): Movimiento {
  return {
    id: fila.id,
    tipo: fila.tipo,
    // Los decimales salen como TEXTO: ver docs/aprendizaje/10.
    cantidadBase: fila.cantidadBase.toString(),
    cantidadIngresada: fila.cantidadIngresada.toString(),
    unidadIngresada: fila.unidadIngresada,
    factorConversion: fila.factorConversion.toString(),
    // Las fechas, como ISO 8601 en UTC. La pantalla las pasa a hora de
    // Argentina; el servidor nunca manda "hora local" sin zona.
    fecha: fila.fecha.toISOString(),
    creadoAt: fila.createdAt.toISOString(),
    usuario: fila.usuario,
    motivo: fila.motivo,
    notas: fila.notas,
    operacionId: fila.operacionId,
    forzado: fila.forzado,
    revierteAId: fila.revierteAId,
    revertido: fila.revertidoPor !== null,
    insumo: {
      id: fila.insumo.id,
      nombre: fila.insumo.nombre,
      unidadBaseCodigo: fila.insumo.unidadBase.codigo,
    },
    sucursal: fila.sucursal,
  };
}

/**
 * Arma la respuesta de una carga: los movimientos escritos y el saldo que
 * quedó en cada insumo.
 *
 * Devolver el saldo nuevo no es un adorno: es lo que permite que la pantalla
 * muestre "quedan 70 kg" sin tener que hacer otro pedido, y lo que le da al
 * usuario la confirmación de que lo que cargó tuvo el efecto que esperaba.
 */
async function armarResultado(registro: ResultadoRegistro): Promise<ResultadoCarga> {
  const filas = await repo.buscarMovimientos(registro.movimientoIds);
  return {
    operacionId: registro.operacionId,
    movimientos: filas.map(aMovimiento),
    saldos: registro.saldos.map((saldo) => ({
      insumoId: saldo.insumoId,
      insumoNombre: saldo.insumoNombre,
      unidadBaseCodigo: saldo.unidadBaseCodigo,
      saldo: saldo.saldo.toString(),
      // El semáforo se calcula contra el mínimo de la sucursal; acá todavía no
      // lo tenemos a mano, así que se informa el estado sin mínimo. La pantalla
      // de stock, que sí lo tiene, muestra el semáforo real.
      estado: estadoDeStock(saldo.saldo, '0'),
    })),
  };
}

// ===========================================================================
// Reglas compartidas
// ===========================================================================

async function exigirSucursalDeLaEmpresa(ctx: Contexto, sucursalId: string) {
  const sucursal = await repo.buscarSucursal(ctx.empresaId, sucursalId);
  if (!sucursal) throw errores.noEncontrado('La sucursal');
  return sucursal;
}

/** Convierte las líneas del pedido en entradas para el motor. */
function aEntradas(
  entrada: {
    sucursalId: string;
    lineas: readonly {
      insumoId: string;
      cantidad: string;
      unidadId: string | null;
      notas: string | null;
    }[];
    notas: string | null;
  },
  tipo: EntradaMovimiento['tipo'],
  motivoId: string | null,
): EntradaMovimiento[] {
  return entrada.lineas.map((linea) => ({
    sucursalId: entrada.sucursalId,
    insumoId: linea.insumoId,
    tipo,
    cantidad: linea.cantidad,
    unidadId: linea.unidadId,
    motivoId,
    // La nota de la línea gana sobre la de la operación: es más específica.
    notas: linea.notas ?? entrada.notas,
  }));
}

function fechaDe(valor: string | null): Date | null {
  return valor === null ? null : new Date(valor);
}

// ===========================================================================
// Comandos
// ===========================================================================

/**
 * El punto de partida del kardex: "en el depósito hay esto".
 *
 * Regla propia de esta operación: el insumo NO puede tener movimientos previos
 * en esa sucursal. Un "saldo inicial" por definición es el primero, y sin este
 * control un doble clic duplicaría el stock en silencio. Para corregir el
 * stock de un insumo que ya tiene historial se usa un consumo, una merma, o un
 * conteo físico (Fase 7).
 *
 * DÓNDE VA ESE CONTROL: adentro de la transacción y DESPUÉS de pedir el
 * candado. Lo escribí primero antes de la transacción y el test de
 * concurrencia lo encontró: dos pedidos simultáneos leían los dos "no tiene
 * movimientos", los dos pasaban la validación y el stock quedaba en 200.
 *
 * La lección general: UNA VALIDACIÓN QUE LEE EL ESTADO Y NO TIENE EL CANDADO
 * NO VALIDA NADA. Solo dice cómo estaban las cosas hace un rato.
 */
export async function cargarSaldoInicial(
  ctx: Contexto,
  entrada: CargarSaldoInicialInput,
): Promise<ResultadoCarga> {
  await exigirSucursalDeLaEmpresa(ctx, entrada.sucursalId);

  // Estas dos validaciones NO dependen de lo que hagan otros pedidos, así que
  // pueden ir afuera de la transacción: el insumo existe o no existe.
  const nombres = new Map<string, string>();
  for (const linea of entrada.lineas) {
    const insumo = await repo.buscarInsumo(ctx.empresaId, linea.insumoId);
    if (!insumo) {
      throw errores.datosInvalidos({ insumoId: 'Ese insumo no existe en tu empresa.' });
    }
    // Acá sí se exige que esté activo: cargarle el saldo inicial a un insumo
    // dado de baja no tiene sentido. En cambio un consumo o una merma sobre un
    // insumo inactivo SÍ se permiten: si quedó stock, hay que poder sacarlo.
    if (!insumo.activo) {
      throw errores.datosInvalidos({
        insumoId: `El insumo "${insumo.nombre}" está inactivo: reactivalo antes de cargarle stock.`,
      });
    }
    nombres.set(insumo.id, insumo.nombre);
  }

  const registro = await prisma.$transaction(async (tx) => {
    // En el MISMO orden que usa el motor (alfabético por id): si una operación
    // bloqueara A→B y otra B→A, se esperarían mutuamente para siempre.
    const insumoIds = [...entrada.lineas.map((linea) => linea.insumoId)].sort();

    for (const insumoId of insumoIds) {
      await bloquearContador(tx, ctx.empresaId, entrada.sucursalId, insumoId);

      // Recién ahora la respuesta es confiable: nadie más puede estar
      // escribiendo movimientos de este insumo en esta sucursal.
      const previos = await repo.contarMovimientos(tx, ctx.empresaId, entrada.sucursalId, insumoId);
      if (previos > 0) {
        throw new AppError(
          'SALDO_INICIAL_YA_CARGADO',
          `"${nombres.get(insumoId) ?? 'El insumo'}" ya tiene movimientos en esta sucursal: ` +
            'el saldo inicial se carga una sola vez. Para corregir el stock, cargá un consumo o una merma.',
          409,
          { insumoId },
        );
      }
    }

    return registrarMovimientos(tx, ctx, aEntradas(entrada, 'SALDO_INICIAL', null), {
      fecha: fechaDe(entrada.fecha),
    });
  });

  return armarResultado(registro);
}

/**
 * El consumo de producción, multi-línea.
 *
 * TODA la carga va en UNA transacción: si la cuarta de seis líneas es
 * inválida, no se escribe ninguna. Media carga de consumo es peor que ninguna,
 * porque nadie sabría qué parte quedó registrada.
 */
export async function cargarConsumo(
  ctx: Contexto,
  entrada: CargarConsumoInput,
): Promise<ResultadoCarga> {
  await exigirSucursalDeLaEmpresa(ctx, entrada.sucursalId);

  const registro = await prisma.$transaction((tx) =>
    registrarMovimientos(tx, ctx, aEntradas(entrada, 'CONSUMO', entrada.motivoId), {
      fecha: fechaDe(entrada.fecha),
      forzar: entrada.forzar,
    }),
  );

  return armarResultado(registro);
}

/** Una merma: pérdida sin uso. El motivo es obligatorio (lo exige el esquema). */
export async function cargarMerma(
  ctx: Contexto,
  entrada: CargarMermaInput,
): Promise<ResultadoCarga> {
  await exigirSucursalDeLaEmpresa(ctx, entrada.sucursalId);

  const registro = await prisma.$transaction((tx) =>
    registrarMovimientos(tx, ctx, aEntradas(entrada, 'MERMA', entrada.motivoId), {
      fecha: fechaDe(entrada.fecha),
      forzar: entrada.forzar,
    }),
  );

  return armarResultado(registro);
}

/**
 * Anula un movimiento con un CONTRA-ASIENTO.
 *
 * No se borra ni se edita nada: se escribe otro movimiento igual y opuesto,
 * con tipo REVERSA y `revierteAId` apuntando al original. El historial queda
 * contando la verdad completa ("se cargó mal y se corrigió a los 40 minutos")
 * en lugar de borrar la evidencia.
 *
 * UN DETALLE QUE IMPORTA: la reversa se arma con la cantidad BASE del original
 * y en su unidad base, no recalculando desde la cantidad tipeada. Si mañana
 * alguien corrigiera el factor de la unidad, recalcular daría un número
 * distinto y la reversa NO devolvería el saldo exacto. Así, la igualdad
 * "original + reversa = 0" está garantizada por construcción.
 */
export async function anular(
  ctx: Contexto,
  movimientoId: string,
  entrada: AnularMovimientoInput,
): Promise<ResultadoCarga> {
  const original = await repo.buscarMovimiento(ctx.empresaId, movimientoId);
  if (!original) throw errores.noEncontrado('El movimiento');

  // En las cargas esto lo hace el middleware requiereSucursal, porque la
  // sucursal viene en el pedido. Acá no viene: sale del movimiento que se
  // anula, así que el chequeo tiene que estar en el servicio. Sin él, un
  // encargado de Laferrere podría anular movimientos de la Central.
  if (!puedeOperarEn(ctx, original.sucursalId)) throw errores.sucursalNoPermitida();

  // Anular una reversa sería volver a aplicar el movimiento original, con un
  // historial que nadie podría seguir. Si hace falta, se carga de nuevo.
  if (original.tipo === 'REVERSA') {
    throw new AppError(
      'NO_SE_ANULA_UNA_REVERSA',
      'Una anulación no se puede anular. Si hace falta, cargá el movimiento de nuevo.',
      409,
    );
  }

  // El UNIQUE de revierte_a_id ya lo garantiza en la base; acá se chequea para
  // dar un mensaje entendible en lugar de un error de restricción.
  if (original.revertidoPor !== null) throw errores.movimientoYaRevertido();

  const cantidadBase = aDecimal(original.cantidadBase.toString());

  const registro = await prisma.$transaction((tx) =>
    registrarMovimientos(
      tx,
      ctx,
      [
        {
          sucursalId: original.sucursalId,
          insumoId: original.insumoId,
          tipo: 'REVERSA',
          cantidad: cantidadBase.abs(),
          // null = la unidad base del insumo, así el factor es 1 y la cantidad
          // entra exacta, sin recalcular nada.
          unidadId: null,
          sentido: cantidadBase.greaterThan(0) ? 'SALIDA' : 'ENTRADA',
          // La reversa hereda el motivo del original: anular una merma por
          // "Vencido" sigue siendo un hecho sobre esa merma.
          motivoId: original.motivoId,
          notas: entrada.notas ?? `Anula el movimiento del ${original.fecha.toISOString()}`,
          revierteAId: original.id,
        },
      ],
      { forzar: entrada.forzar },
    ),
  );

  return armarResultado(registro);
}

// ===========================================================================
// Consultas
// ===========================================================================

/**
 * El stock de TODOS los insumos de una sucursal.
 *
 * Trae también los insumos sin ningún movimiento, con saldo cero: si solo
 * apareciera lo que se movió, un insumo que nunca se cargó sería invisible
 * justo cuando hace falta comprarlo.
 */
export async function obtenerStock(ctx: Contexto, filtro: FiltroStock): Promise<StockPorSucursal> {
  const sucursal = await exigirSucursalDeLaEmpresa(ctx, filtro.sucursalId);

  const [insumos, saldos, parametros] = await Promise.all([
    repo.insumosParaStock({
      empresaId: ctx.empresaId,
      busqueda: filtro.busqueda,
      categoriaId: filtro.categoriaId,
    }),
    repo.saldosDeSucursal(ctx.empresaId, filtro.sucursalId),
    repo.parametrosDeSucursal(ctx.empresaId, filtro.sucursalId),
  ]);

  const porInsumo = new Map(saldos.map((fila) => [fila.insumoId, fila]));
  const configurado = new Map(parametros.map((fila) => [fila.insumoId, fila]));

  const items: FilaStock[] = insumos.map((insumo) => {
    const agregado = porInsumo.get(insumo.id);
    const parametro = configurado.get(insumo.id);

    const saldo = agregado?._sum.cantidadBase?.toString() ?? '0';
    const stockMinimo = parametro?.stockMinimo.toString() ?? '0';

    return {
      insumoId: insumo.id,
      nombre: insumo.nombre,
      codigo: insumo.codigo,
      categoriaNombre: insumo.categoria?.nombre ?? null,
      unidadBaseCodigo: insumo.unidadBase.codigo,
      saldo,
      stockMinimo,
      stockMaximo: parametro?.stockMaximo?.toString() ?? null,
      ubicacion: parametro?.ubicacion ?? null,
      estado: estadoDeStock(saldo, stockMinimo),
      cantidadMovimientos: agregado?._count._all ?? 0,
    };
  });

  // El resumen se calcula sobre TODO lo que coincide con la búsqueda, antes de
  // aplicar el filtro de alertas: si no, "solo alertas" mostraría 0 en OK y
  // parecería que no hay nada bien.
  const resumen = {
    critico: items.filter((item) => item.estado === 'CRITICO').length,
    bajo: items.filter((item) => item.estado === 'BAJO').length,
    ok: items.filter((item) => item.estado === 'OK').length,
  };

  return {
    sucursal,
    items: filtro.soloAlertas ? items.filter((item) => item.estado !== 'OK') : items,
    resumen,
  };
}

export async function obtenerHistorial(
  ctx: Contexto,
  insumoId: string,
  filtro: FiltroHistorial,
): Promise<HistorialMovimientos> {
  await exigirSucursalDeLaEmpresa(ctx, filtro.sucursalId);

  const insumo = await repo.buscarInsumo(ctx.empresaId, insumoId);
  if (!insumo) throw errores.noEncontrado('El insumo');

  // Acá Promise.all SÍ corresponde: son dos consultas sueltas contra `prisma`,
  // así que cada una toma su propia conexión del pool. Lo que no se puede es
  // paralelizar adentro de una transacción (ver el comentario en repo.ts).
  const [filas, resumen] = await Promise.all([
    repo.historial(
      ctx.empresaId,
      filtro.sucursalId,
      insumoId,
      filtro.limite,
      filtro.desplazamiento,
    ),
    repo.resumenHistorial(ctx.empresaId, filtro.sucursalId, insumoId),
  ]);

  return {
    items: filas.map(aMovimiento),
    total: resumen._count._all,
    saldo: resumen._sum.cantidadBase?.toString() ?? '0',
  };
}

export function listarMotivos(
  ctx: Contexto,
  tipoAplicable?: 'MERMA' | 'AJUSTE' | 'CONSUMO',
): Promise<Motivo[]> {
  return repo.listarMotivos(ctx.empresaId, tipoAplicable);
}
