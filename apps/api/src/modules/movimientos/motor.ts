/**
 * EL MOTOR DE MOVIMIENTOS. El único código del sistema que escribe en
 * `movimiento_stock`.
 *
 * Por qué uno solo: todo lo que mueve stock (saldo inicial, consumo, merma,
 * compras, conteos, transferencias, y mañana la producción) tiene que pasar
 * por las mismas cinco validaciones. Si hubiera dos lugares que insertan,
 * tarde o temprano uno se olvida de una, y te enterás por un stock que no
 * cuadra tres semanas después, sin forma de saber desde cuándo.
 *
 * El recorrido es siempre el mismo:
 *
 *   1. resolver los datos que hacen falta (insumos, unidades, motivos)
 *   2. convertir cada cantidad a la unidad base y ponerle el signo del tipo
 *   3. ORDENAR las claves y BLOQUEARLAS (acá se evita la condición de carrera)
 *   4. calcular el saldo y validar que no quede negativo
 *   5. insertar todo y auditar lo excepcional
 *
 * Nada de esto abre su propia transacción: recibe el `tx` de quien lo llama.
 * Así una operación que escribe movimientos Y otra cosa (una recepción de
 * compra, el cierre de un conteo) queda toda en la misma transacción.
 */
import {
  aDecimal,
  conSignoDelTipo,
  type Decimal,
  esFechaFutura,
  factorDeConversion,
  formatearCantidad,
  type Numerico,
  redondearCantidad,
  requiereMotivo,
  signoValido,
  type TipoMovimiento,
  type UnidadConversion,
} from '@panaderia/shared';
import { randomUUID } from 'node:crypto';

import type { Prisma } from '../../generated/prisma/client.js';
import { registrarAuditoria } from '../../lib/auditoria.js';
import type { Contexto } from '../../lib/contexto.js';
import { AppError, errores } from '../../lib/errores.js';

/**
 * El cliente de Prisma DENTRO de una transacción.
 *
 * Es el tipo que recibe el callback de `prisma.$transaction`: el mismo cliente
 * pero sin `$transaction` ni `$connect` (no se puede abrir una transacción
 * adentro de otra). Pedir este tipo, y no el cliente completo, es lo que hace
 * imposible que el motor escriba por fuera de una transacción.
 */
export type Tx = Prisma.TransactionClient;

/** Una línea a registrar, antes de convertir y de ponerle signo. */
export type EntradaMovimiento = {
  sucursalId: string;
  insumoId: string;
  tipo: TipoMovimiento;
  /** SIN signo, en la unidad que indica `unidadId`. */
  cantidad: Numerico;
  /** null = la unidad base del insumo (el caso normal). */
  unidadId?: string | null;
  /**
   * Obligatorio para AJUSTE y REVERSA, que van en los dos sentidos y por eso
   * no pueden deducir el signo de su tipo.
   */
  sentido?: 'ENTRADA' | 'SALIDA';
  motivoId?: string | null;
  notas?: string | null;
  /** Solo para REVERSA: a qué movimiento anula. */
  revierteAId?: string | null;
};

export type OpcionesRegistro = {
  /** Cuándo ocurrió. Por defecto, ahora. */
  fecha?: Date | null;
  /** Pedido de dejar el stock negativo. Solo se honra con permiso. */
  forzar?: boolean;
  /** Para agrupar con movimientos de otra llamada. Por defecto se genera uno. */
  operacionId?: string;
};

export type SaldoResultante = {
  insumoId: string;
  insumoNombre: string;
  unidadBaseCodigo: string;
  saldo: Decimal;
};

export type ResultadoRegistro = {
  operacionId: string;
  movimientoIds: string[];
  saldos: SaldoResultante[];
};

/** La clave que identifica un "contador" de stock: un insumo en una sucursal. */
function claveDe(sucursalId: string, insumoId: string): string {
  return `${sucursalId}|${insumoId}`;
}

// ===========================================================================
// 1. Resolver los datos
// ===========================================================================

type DatosInsumo = {
  id: string;
  nombre: string;
  activo: boolean;
  unidadBase: UnidadConversion & { id: string };
};

async function cargarInsumos(
  tx: Tx,
  empresaId: string,
  ids: readonly string[],
): Promise<Map<string, DatosInsumo>> {
  const filas = await tx.insumo.findMany({
    // SIEMPRE por empresaId: un id que no sea de esta empresa simplemente no
    // aparece, y el chequeo de abajo lo trata como inexistente.
    where: { id: { in: [...ids] }, empresaId },
    select: {
      id: true,
      nombre: true,
      activo: true,
      unidadBase: { select: { id: true, codigo: true, dimension: true, factorABase: true } },
    },
  });

  return new Map(
    filas.map((fila) => [
      fila.id,
      {
        id: fila.id,
        nombre: fila.nombre,
        activo: fila.activo,
        unidadBase: {
          id: fila.unidadBase.id,
          codigo: fila.unidadBase.codigo,
          dimension: fila.unidadBase.dimension,
          // El Decimal de Prisma es OTRA clase que el nuestro, así que acá
          // siempre se pasa por texto. Ver docs/aprendizaje/10.
          factorABase: fila.unidadBase.factorABase.toString(),
        },
      },
    ]),
  );
}

async function cargarUnidades(
  tx: Tx,
  empresaId: string,
  ids: readonly string[],
): Promise<Map<string, UnidadConversion & { id: string }>> {
  if (ids.length === 0) return new Map();

  const filas = await tx.unidadMedida.findMany({
    where: { id: { in: [...ids] }, empresaId },
    select: { id: true, codigo: true, dimension: true, factorABase: true },
  });

  return new Map(
    filas.map((fila) => [
      fila.id,
      {
        id: fila.id,
        codigo: fila.codigo,
        dimension: fila.dimension,
        factorABase: fila.factorABase.toString(),
      },
    ]),
  );
}

async function cargarSucursales(
  tx: Tx,
  empresaId: string,
  ids: readonly string[],
): Promise<Map<string, { id: string; nombre: string }>> {
  const filas = await tx.sucursal.findMany({
    where: { id: { in: [...ids] }, empresaId },
    select: { id: true, nombre: true },
  });
  return new Map(filas.map((fila) => [fila.id, fila]));
}

async function cargarMotivos(
  tx: Tx,
  empresaId: string,
  ids: readonly string[],
): Promise<Map<string, { id: string; nombre: string; tipoAplicable: string; activo: boolean }>> {
  if (ids.length === 0) return new Map();

  const filas = await tx.motivoMovimiento.findMany({
    where: { id: { in: [...ids] }, empresaId },
    select: { id: true, nombre: true, tipoAplicable: true, activo: true },
  });
  return new Map(filas.map((fila) => [fila.id, fila]));
}

// ===========================================================================
// 2. Convertir y poner el signo
// ===========================================================================

/** Una línea ya resuelta: lista para insertar, pendiente del control de saldo. */
type MovimientoPreparado = {
  entrada: EntradaMovimiento;
  insumo: DatosInsumo;
  unidadIngresada: UnidadConversion & { id: string };
  cantidadIngresada: Decimal;
  factorConversion: Decimal;
  /** Con signo, en la unidad base del insumo. */
  cantidadBase: Decimal;
  motivoId: string | null;
};

/**
 * Convierte la cantidad tipeada a la unidad base y le pone el signo del tipo.
 *
 * Las tres cosas que guarda —cantidad tipeada, unidad y factor— son lo que
 * permite que el historial diga "cargó 2000 g = 2 kg" y siga siendo cierto en
 * cinco años, incluso si mañana alguien corrige el factor de la unidad.
 */
function prepararMovimiento(
  entrada: EntradaMovimiento,
  insumo: DatosInsumo,
  unidadIngresada: UnidadConversion & { id: string },
  motivoId: string | null,
): MovimientoPreparado {
  let factorConversion: Decimal;
  try {
    factorConversion = factorDeConversion(unidadIngresada, insumo.unidadBase);
  } catch (error) {
    // La conversión entre dimensiones distintas no es un bug del sistema: es
    // un dato mal elegido, y el usuario tiene que poder entender por qué.
    throw errores.dimensionIncompatible(
      `No se puede cargar ${insumo.nombre} en ${unidadIngresada.codigo}: ` +
        `se lleva en ${insumo.unidadBase.codigo} y son dimensiones distintas ` +
        `(${unidadIngresada.dimension} y ${insumo.unidadBase.dimension}).`,
      { insumoId: insumo.id, unidadId: unidadIngresada.id, causa: String(error) },
    );
  }

  const cantidadIngresada = redondearCantidad(entrada.cantidad);
  const magnitud = redondearCantidad(cantidadIngresada.times(factorConversion));

  // Redondear a la escala de la columna (6 decimales) ANTES de decidir el
  // signo evita insertar un número que Postgres va a redondear por su cuenta:
  // si el valor se redondeara a cero, el CHECK `cantidad_base <> 0` lo
  // rechazaría con un error ilegible. Mejor avisarlo acá.
  if (magnitud.isZero()) {
    throw errores.datosInvalidos({
      cantidad:
        `${formatearCantidad(cantidadIngresada)} ${unidadIngresada.codigo} es una cantidad ` +
        `demasiado chica para registrarse en ${insumo.unidadBase.codigo}.`,
    });
  }

  const cantidadBase =
    entrada.sentido === undefined
      ? conSignoDelTipo(entrada.tipo, magnitud)
      : entrada.sentido === 'SALIDA'
        ? magnitud.negated()
        : magnitud;

  // Último control antes de la base: el mismo invariante que el CHECK. Si esto
  // falla es un bug del motor, no un dato malo del usuario, y por eso el
  // mensaje no está pensado para el usuario final.
  if (!signoValido(entrada.tipo, cantidadBase)) {
    throw new AppError(
      'SIGNO_INVALIDO',
      `Un movimiento de tipo ${entrada.tipo} no puede tener cantidad ${cantidadBase.toString()}.`,
      500,
    );
  }

  return {
    entrada,
    insumo,
    unidadIngresada,
    cantidadIngresada,
    factorConversion,
    cantidadBase,
    motivoId,
  };
}

// ===========================================================================
// 3. El bloqueo: la parte que evita la condición de carrera
// ===========================================================================

/**
 * Bloquea el "contador" de un insumo en una sucursal hasta el fin de la
 * transacción.
 *
 * EL PROBLEMA QUE RESUELVE (una condición de carrera clásica):
 *
 *   Hay 10 kg de levadura. Dos personas cargan un consumo de 8 kg al mismo
 *   tiempo, cada una desde su tablet.
 *
 *     Ana:   lee el saldo → 10.  10 - 8 = 2 ≥ 0, ok.  escribe -8.
 *     Beto:  lee el saldo → 10.  10 - 8 = 2 ≥ 0, ok.  escribe -8.
 *     saldo final: -6
 *
 *   Las dos validaciones pasaron, cada una por separado era correcta, y el
 *   resultado es imposible. Esto NO se ve en desarrollo (nunca hay dos
 *   pedidos simultáneos) y aparece el primer día con dos usuarios reales.
 *
 * LA SOLUCIÓN: antes de leer el saldo, pedirle a Postgres el candado de una
 * fila concreta con `SELECT ... FOR UPDATE`. El primero que llega se lo
 * queda; el segundo ESPERA ahí hasta que el primero haga commit, y entonces
 * lee el saldo ya actualizado (2) y su validación falla como corresponde.
 *
 * Es un bloqueo PESIMISTA: asume que el choque va a pasar y lo previene. La
 * alternativa (optimista: escribir y reintentar si falló) es más rápida con
 * mucha concurrencia, pero acá hay dos tablets en un depósito: la espera es de
 * milisegundos y el código es mucho más simple de entender.
 *
 * Se exporta porque una operación puede necesitar bloquear ANTES de validar
 * algo que depende del estado (ver `cargarSaldoInicial`). Volver a pedir el
 * mismo candado dentro de la misma transacción no cuesta nada: ya lo tiene.
 *
 * ¿Qué fila se bloquea? La de `insumo_sucursal`, que es la fila de
 * configuración de ese insumo en esa sucursal. Se la crea si no existe: el
 * candado necesita algo concreto que trabar, y `movimiento_stock` no sirve
 * porque las filas que importan son las que todavía no existen (eso se llama
 * "lectura fantasma" y un candado de fila no la puede evitar).
 */
export async function bloquearContador(
  tx: Tx,
  empresaId: string,
  sucursalId: string,
  insumoId: string,
): Promise<void> {
  // ON CONFLICT DO NOTHING: si la fila ya está, no hace nada. Y si otra
  // transacción la está insertando en este instante, este INSERT espera a que
  // termine, así que no hay forma de que queden dos.
  await tx.$executeRaw`
    INSERT INTO insumo_sucursal (insumo_id, sucursal_id, empresa_id)
    VALUES (${insumoId}::uuid, ${sucursalId}::uuid, ${empresaId}::uuid)
    ON CONFLICT (insumo_id, sucursal_id) DO NOTHING`;

  const filas = await tx.$queryRaw<{ insumo_id: string }[]>`
    SELECT insumo_id FROM insumo_sucursal
    WHERE insumo_id = ${insumoId}::uuid AND sucursal_id = ${sucursalId}::uuid
    FOR UPDATE`;

  // Si no bloqueamos nada, seguir sería peor que fallar: el control de saldo
  // dejaría de ser confiable sin que nadie se enterara.
  if (filas.length !== 1) {
    throw new AppError(
      'ERROR_INTERNO',
      'No se pudo bloquear el contador de stock para registrar el movimiento.',
      500,
    );
  }
}

/** El saldo actual: la SUMA de los movimientos. Nunca un campo guardado. */
async function saldoActual(
  tx: Tx,
  empresaId: string,
  sucursalId: string,
  insumoId: string,
): Promise<Decimal> {
  const agregado = await tx.movimientoStock.aggregate({
    where: { empresaId, sucursalId, insumoId },
    _sum: { cantidadBase: true },
  });
  // Sin movimientos, _sum da null (no cero): es la diferencia entre "la suma
  // es cero" y "no hay nada que sumar". Para el stock las dos valen cero.
  return aDecimal(agregado._sum.cantidadBase?.toString() ?? '0');
}

// ===========================================================================
// El motor
// ===========================================================================

export async function registrarMovimientos(
  tx: Tx,
  ctx: Contexto,
  entradas: readonly EntradaMovimiento[],
  opciones: OpcionesRegistro = {},
): Promise<ResultadoRegistro> {
  if (entradas.length === 0) {
    throw errores.datosInvalidos({ lineas: 'No hay nada que registrar.' });
  }

  const fecha = opciones.fecha ?? new Date();
  if (esFechaFutura(fecha, new Date())) {
    throw errores.datosInvalidos({ fecha: 'La fecha no puede estar en el futuro.' });
  }

  const operacionId = opciones.operacionId ?? randomUUID();

  // --- 1. Resolver todo lo que hace falta: cuatro consultas, no 4×N.
  //
  // UNA POR UNA, no con Promise.all. Y la razón es importante: una transacción
  // vive en UNA conexión de Postgres, y una conexión ejecuta una consulta a la
  // vez. Lanzar cuatro en paralelo sobre el mismo `tx` no las hace más
  // rápidas: las encola, y el driver `pg` avisa con un DeprecationWarning
  // ("client.query() when the client is already executing a query") porque en
  // pg 9 va a ser un error.
  //
  // Promise.all sí sirve con `prisma` a secas, donde cada consulta toma una
  // conexión distinta del pool. Adentro de una transacción, nunca.
  const insumos = await cargarInsumos(tx, ctx.empresaId, [
    ...new Set(entradas.map((e) => e.insumoId)),
  ]);
  const unidades = await cargarUnidades(tx, ctx.empresaId, [
    ...new Set(entradas.map((e) => e.unidadId).filter((id): id is string => id != null)),
  ]);
  const sucursales = await cargarSucursales(tx, ctx.empresaId, [
    ...new Set(entradas.map((e) => e.sucursalId)),
  ]);
  const motivos = await cargarMotivos(tx, ctx.empresaId, [
    ...new Set(entradas.map((e) => e.motivoId).filter((id): id is string => id != null)),
  ]);

  // --- 2. Validar y preparar cada línea.
  const preparados: MovimientoPreparado[] = [];

  for (const [indice, entrada] of entradas.entries()) {
    const campo = (nombre: string) => `lineas.${String(indice)}.${nombre}`;

    const sucursal = sucursales.get(entrada.sucursalId);
    if (!sucursal) throw errores.noEncontrado('La sucursal');

    // Que el usuario PUEDA operar en esta sucursal lo verificó el middleware;
    // acá se verifica que la sucursal sea de su empresa. Son dos cosas
    // distintas y las dos hacen falta.
    const insumo = insumos.get(entrada.insumoId);
    if (!insumo) {
      throw errores.datosInvalidos({ [campo('insumoId')]: 'Ese insumo no existe en tu empresa.' });
    }

    const unidadIngresada =
      entrada.unidadId == null ? insumo.unidadBase : unidades.get(entrada.unidadId);
    if (!unidadIngresada) {
      throw errores.datosInvalidos({
        [campo('unidadId')]: 'Esa unidad de medida no existe en tu empresa.',
      });
    }

    // El motivo es obligatorio para MERMA y AJUSTE: sin él, el stock
    // desaparece sin explicación y después no hay forma de responder "¿cuánto
    // perdimos por vencimiento?".
    if (requiereMotivo(entrada.tipo) && entrada.motivoId == null) {
      throw errores.datosInvalidos({ motivoId: 'Hay que indicar un motivo.' });
    }

    let motivoId: string | null = null;
    if (entrada.motivoId != null) {
      const motivo = motivos.get(entrada.motivoId);
      if (!motivo || !motivo.activo) {
        throw errores.datosInvalidos({ motivoId: 'Ese motivo no existe en tu empresa.' });
      }
      // El motivo tiene que servir para ESTE tipo: "Diferencia de conteo" no
      // tiene sentido en una merma, y "Vencido" no tiene sentido en un ajuste.
      // La reversa hereda el motivo del movimiento que anula, así que se acepta
      // cualquiera.
      if (entrada.tipo !== 'REVERSA' && motivo.tipoAplicable !== entrada.tipo) {
        throw errores.datosInvalidos({
          motivoId: `El motivo "${motivo.nombre}" no se puede usar en un movimiento de tipo ${entrada.tipo.toLowerCase()}.`,
        });
      }
      motivoId = motivo.id;
    }

    preparados.push(prepararMovimiento(entrada, insumo, unidadIngresada, motivoId));
  }

  // --- 3. Agrupar por contador y ORDENAR las claves.
  //
  // El orden es lo que evita un ABRAZO MORTAL (deadlock): si Ana bloquea la
  // harina y después el azúcar, y Beto bloquea el azúcar y después la harina,
  // cada uno espera al otro para siempre y Postgres tiene que matar a uno.
  // Si TODOS bloquean en el mismo orden, eso no puede pasar.
  const porContador = new Map<string, MovimientoPreparado[]>();
  for (const preparado of preparados) {
    const clave = claveDe(preparado.entrada.sucursalId, preparado.insumo.id);
    const lista = porContador.get(clave);
    if (lista) lista.push(preparado);
    else porContador.set(clave, [preparado]);
  }
  const clavesOrdenadas = [...porContador.keys()].sort();

  // --- 4. Bloquear, calcular el saldo y validar que no quede negativo.
  const puedeForzar = ctx.permisos.includes('stock:forzar');
  const forzados: string[] = [];
  const saldos: SaldoResultante[] = [];

  for (const clave of clavesOrdenadas) {
    const grupo = porContador.get(clave) ?? [];
    const primero = grupo[0];
    if (!primero) continue;

    const { sucursalId } = primero.entrada;
    const insumo = primero.insumo;

    await bloquearContador(tx, ctx.empresaId, sucursalId, insumo.id);

    const saldoAnterior = await saldoActual(tx, ctx.empresaId, sucursalId, insumo.id);
    const delta = grupo.reduce((suma, p) => suma.plus(p.cantidadBase), aDecimal('0'));
    const saldoNuevo = saldoAnterior.plus(delta);

    // Solo se controla cuando el movimiento SACA stock. Si el saldo ya estaba
    // negativo y esta operación agrega, el resultado puede seguir siendo
    // negativo y eso no es un problema: está mejorando.
    if (delta.lessThan(0) && saldoNuevo.lessThan(0)) {
      if (!(opciones.forzar === true && puedeForzar)) {
        const sucursal = sucursales.get(sucursalId);
        throw errores.stockInsuficiente({
          insumoId: insumo.id,
          insumoNombre: insumo.nombre,
          sucursalNombre: sucursal?.nombre ?? '',
          disponible: formatearCantidad(saldoAnterior),
          solicitado: formatearCantidad(delta.negated()),
          unidad: insumo.unidadBase.codigo,
        });
      }
      forzados.push(clave);
    }

    saldos.push({
      insumoId: insumo.id,
      insumoNombre: insumo.nombre,
      unidadBaseCodigo: insumo.unidadBase.codigo,
      saldo: saldoNuevo,
    });
  }

  // --- 5. Insertar. Un solo createMany: menos viajes a la base y, sobre todo,
  // una sola oportunidad de que los CHECK rechacen algo.
  const forzadas = new Set(forzados);
  const movimientoIds = preparados.map(() => randomUUID());

  await tx.movimientoStock.createMany({
    data: preparados.map((preparado, indice) => ({
      // Se generan los ids acá en lugar de dejárselos a la base porque
      // createMany no devuelve las filas creadas, y las necesitamos para
      // responder con los movimientos escritos.
      id: movimientoIds[indice] ?? randomUUID(),
      // El empresaId sale SIEMPRE de la sesión, nunca del pedido.
      empresaId: ctx.empresaId,
      sucursalId: preparado.entrada.sucursalId,
      insumoId: preparado.insumo.id,
      tipo: preparado.entrada.tipo,
      cantidadBase: preparado.cantidadBase.toString(),
      cantidadIngresada: preparado.cantidadIngresada.toString(),
      unidadIngresadaId: preparado.unidadIngresada.id,
      factorConversion: preparado.factorConversion.toString(),
      // costoUnitario queda null: lo llena el costo promedio (Fase 8).
      fecha,
      usuarioId: ctx.usuarioId,
      motivoId: preparado.motivoId,
      notas: preparado.entrada.notas ?? null,
      operacionId,
      revierteAId: preparado.entrada.revierteAId ?? null,
      forzado: forzadas.has(claveDe(preparado.entrada.sucursalId, preparado.insumo.id)),
    })),
  });

  // --- 6. Auditar lo EXCEPCIONAL.
  //
  // Los movimientos normales no se auditan: ya son inmutables y llevan su
  // propio usuario y fecha, así que la tabla `auditoria` no agregaría nada.
  // Lo que sí se audita es dejar el stock en negativo a propósito, que es una
  // de las dos operaciones peligrosas del sistema.
  for (const clave of forzados) {
    const grupo = porContador.get(clave) ?? [];
    const primero = grupo[0];
    if (!primero) continue;
    const saldo = saldos.find((s) => s.insumoId === primero.insumo.id);

    await registrarAuditoria(tx, {
      empresaId: ctx.empresaId,
      usuarioId: ctx.usuarioId,
      entidad: 'movimiento_stock',
      entidadId: primero.insumo.id,
      accion: 'FORZAR_STOCK_NEGATIVO',
      datosDespues: {
        operacionId,
        sucursalId: primero.entrada.sucursalId,
        insumoId: primero.insumo.id,
        insumoNombre: primero.insumo.nombre,
        tipo: primero.entrada.tipo,
        saldoResultante: saldo?.saldo.toString() ?? null,
      },
      ip: ctx.ip ?? null,
    });
  }

  return { operacionId, movimientoIds, saldos };
}
