// CAPA 4 — ACCESO A DATOS: consultas. No decide reglas.
import type { Prisma } from '../../generated/prisma/client.js';
import { prisma } from '../../lib/db.js';

/**
 * Todo lo que la pantalla y el historial necesitan de un movimiento.
 *
 * Fijate que NO trae `costoUnitario`: en esta fase siempre es null (el costo
 * promedio llega en la Fase 8) y cuando exista va a ser un dato de plata que
 * el empleado no tiene que recibir. Un campo que no se selecciona no se puede
 * filtrar por accidente más adelante.
 */
const SELECCION_MOVIMIENTO = {
  id: true,
  tipo: true,
  cantidadBase: true,
  cantidadIngresada: true,
  factorConversion: true,
  fecha: true,
  createdAt: true,
  notas: true,
  operacionId: true,
  forzado: true,
  revierteAId: true,
  unidadIngresada: { select: { id: true, codigo: true } },
  usuario: { select: { id: true, nombre: true } },
  motivo: { select: { id: true, nombre: true } },
  insumo: { select: { id: true, nombre: true, unidadBase: { select: { codigo: true } } } },
  sucursal: { select: { id: true, codigo: true, nombre: true } },
  // La reversa que anula a ESTE movimiento, si existe. Es el otro lado de la
  // relación de la tabla consigo misma, y es lo que permite que la pantalla no
  // ofrezca "anular" dos veces.
  revertidoPor: { select: { id: true } },
} as const;

export type FilaMovimiento = Prisma.MovimientoStockGetPayload<{
  select: typeof SELECCION_MOVIMIENTO;
}>;

export function buscarMovimientos(ids: readonly string[]): Promise<FilaMovimiento[]> {
  return prisma.movimientoStock.findMany({
    where: { id: { in: [...ids] } },
    orderBy: { insumo: { nombre: 'asc' } },
    select: SELECCION_MOVIMIENTO,
  });
}

export function buscarMovimiento(empresaId: string, movimientoId: string) {
  return prisma.movimientoStock.findFirst({
    // SIEMPRE por empresaId: un movimiento de otra empresa no existe.
    where: { id: movimientoId, empresaId },
    select: {
      ...SELECCION_MOVIMIENTO,
      insumoId: true,
      sucursalId: true,
      motivoId: true,
      unidadIngresadaId: true,
    },
  });
}

/**
 * El saldo y la cantidad de movimientos de CADA insumo en una sucursal, en una
 * sola consulta.
 *
 * `groupBy` genera un `GROUP BY insumo_id` con `SUM(cantidad_base)`: una
 * consulta para los 28 insumos en lugar de 28 consultas. Es el índice
 * (empresa_id, sucursal_id, insumo_id, fecha) el que la hace barata.
 */
export function saldosDeSucursal(empresaId: string, sucursalId: string) {
  return prisma.movimientoStock.groupBy({
    by: ['insumoId'],
    where: { empresaId, sucursalId },
    _sum: { cantidadBase: true },
    _count: { _all: true },
  });
}

export type FiltroInsumosStock = {
  empresaId: string;
  busqueda: string | undefined;
  categoriaId: string | undefined;
};

/** Los insumos ACTIVOS del catálogo: la pantalla de stock los muestra todos. */
export function insumosParaStock(filtro: FiltroInsumosStock) {
  return prisma.insumo.findMany({
    where: {
      empresaId: filtro.empresaId,
      activo: true,
      ...(filtro.categoriaId === undefined ? {} : { categoriaId: filtro.categoriaId }),
      ...(filtro.busqueda === undefined
        ? {}
        : {
            OR: [
              { nombre: { contains: filtro.busqueda, mode: 'insensitive' } },
              { codigo: { contains: filtro.busqueda, mode: 'insensitive' } },
            ],
          }),
    },
    orderBy: { nombre: 'asc' },
    select: {
      id: true,
      nombre: true,
      codigo: true,
      categoria: { select: { nombre: true } },
      unidadBase: { select: { codigo: true } },
    },
  });
}

/** Los mínimos configurados de una sucursal (los que no estén, valen cero). */
export function parametrosDeSucursal(empresaId: string, sucursalId: string) {
  return prisma.insumoSucursal.findMany({
    where: { empresaId, sucursalId },
    select: {
      insumoId: true,
      stockMinimo: true,
      stockMaximo: true,
      ubicacion: true,
    },
  });
}

export function buscarSucursal(empresaId: string, sucursalId: string) {
  return prisma.sucursal.findFirst({
    where: { id: sucursalId, empresaId },
    select: { id: true, codigo: true, nombre: true },
  });
}

export function buscarInsumo(empresaId: string, insumoId: string) {
  return prisma.insumo.findFirst({
    where: { id: insumoId, empresaId },
    select: {
      id: true,
      nombre: true,
      activo: true,
      unidadBase: { select: { id: true, codigo: true } },
    },
  });
}

/**
 * El historial de un insumo en una sucursal, paginado.
 *
 * OJO con algo que descubrí acá y que no es obvio: esta consulta NO va dentro
 * de una transacción, y es a propósito.
 *
 * Un `findMany` con varias relaciones en el `select` no es UNA consulta:
 * Prisma trae cada relación por separado y las lanza EN PARALELO. Fuera de una
 * transacción eso está bien (cada una toma su propia conexión del pool). Pero
 * una transacción vive en UNA conexión, y una conexión ejecuta una consulta a
 * la vez: adentro de una transacción, el driver `pg` avisa
 * ("client.query() when the client is already executing a query") porque en
 * pg 9 va a ser un error.
 *
 * Lo mismo vale para el motor: ahí todas las consultas van de a una.
 */
export function historial(
  empresaId: string,
  sucursalId: string,
  insumoId: string,
  limite: number,
  desplazamiento: number,
) {
  return prisma.movimientoStock.findMany({
    where: { empresaId, sucursalId, insumoId },
    // Lo más nuevo arriba. El segundo criterio desempata los movimientos con
    // la misma fecha (una carga de 6 líneas comparte la fecha exacta).
    orderBy: [{ fecha: 'desc' }, { createdAt: 'desc' }],
    take: limite,
    skip: desplazamiento,
    select: SELECCION_MOVIMIENTO,
  });
}

/**
 * El total y el saldo del historial, EN UNA SOLA consulta.
 *
 * `count` y `sum` son dos agregaciones del mismo `GROUP BY`, así que no hace
 * falta pedirlas por separado: una consulta en lugar de dos, y además los dos
 * números salen del mismo estado de la base sin necesidad de una transacción.
 */
export function resumenHistorial(empresaId: string, sucursalId: string, insumoId: string) {
  return prisma.movimientoStock.aggregate({
    where: { empresaId, sucursalId, insumoId },
    _count: { _all: true },
    _sum: { cantidadBase: true },
  });
}

/**
 * ¿Este insumo ya tiene movimientos en esta sucursal?
 *
 * Recibe el CLIENTE como primer parámetro, igual que registrarAuditoria. Es lo
 * que permite llamarla con el `tx` de una transacción, y eso acá no es un
 * detalle: la respuesta solo es confiable si se pregunta DENTRO de la
 * transacción que ya tomó el candado.
 */
export type ClienteMovimientos = Pick<typeof prisma, 'movimientoStock'>;

export function contarMovimientos(
  cliente: ClienteMovimientos,
  empresaId: string,
  sucursalId: string,
  insumoId: string,
) {
  return cliente.movimientoStock.count({ where: { empresaId, sucursalId, insumoId } });
}

export function listarMotivos(empresaId: string, tipoAplicable?: 'MERMA' | 'AJUSTE' | 'CONSUMO') {
  return prisma.motivoMovimiento.findMany({
    where: {
      empresaId,
      activo: true,
      ...(tipoAplicable === undefined ? {} : { tipoAplicable }),
    },
    orderBy: [{ tipoAplicable: 'asc' }, { nombre: 'asc' }],
    select: { id: true, tipoAplicable: true, nombre: true, activo: true },
  });
}
