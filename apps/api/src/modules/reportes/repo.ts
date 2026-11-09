// CAPA 4 — ACCESO A DATOS: las filas de un período. No decide reglas.
import { prisma } from '../../lib/db.js';

const INSUMO = {
  select: { id: true, nombre: true, unidadBase: { select: { codigo: true } } },
} as const;

/** Las compras PEDIDAS en el período (los borradores no son compras). */
export function compras(
  empresaId: string,
  sucursalIds: readonly string[],
  inicio: Date,
  fin: Date,
) {
  return prisma.ordenCompra.findMany({
    where: {
      empresaId,
      sucursalId: { in: [...sucursalIds] },
      estado: { not: 'BORRADOR' },
      pedidaAt: { gte: inicio, lte: fin },
    },
    orderBy: { pedidaAt: 'asc' },
    select: {
      id: true,
      numero: true,
      estado: true,
      pedidaAt: true,
      proveedor: { select: { id: true, nombre: true } },
      lineas: {
        select: {
          id: true,
          cantidad: true,
          cantidadBase: true,
          factorConversion: true,
          precioUnitario: true,
          insumo: INSUMO,
          presentacion: { select: { nombre: true } },
        },
      },
    },
  });
}

/** La fecha de la última entrega CONFIRMADA de cada compra. */
export async function ultimaEntregaPorCompra(ordenIds: readonly string[]) {
  if (ordenIds.length === 0) return new Map<string, Date>();
  const filas = await prisma.recepcionCompra.groupBy({
    by: ['ordenCompraId'],
    where: { ordenCompraId: { in: [...ordenIds] }, estado: 'CONFIRMADA' },
    _max: { fecha: true },
  });
  const resultado = new Map<string, Date>();
  for (const fila of filas) {
    if (fila.ordenCompraId !== null && fila._max.fecha !== null) {
      resultado.set(fila.ordenCompraId, fila._max.fecha);
    }
  }
  return resultado;
}

/** Los pagos NO anulados del período, por la fecha del pago. */
export function pagos(empresaId: string, sucursalIds: readonly string[], inicio: Date, fin: Date) {
  return prisma.pago.findMany({
    where: {
      empresaId,
      anuladoAt: null,
      fecha: { gte: inicio, lte: fin },
      orden: { sucursalId: { in: [...sucursalIds] } },
    },
    orderBy: { fecha: 'asc' },
    select: {
      fecha: true,
      monto: true,
      medio: true,
      orden: { select: { proveedor: { select: { id: true, nombre: true } } } },
    },
  });
}

/** Las entregas CONFIRMADAS del período (con compra o sin ella). */
export function entregas(
  empresaId: string,
  sucursalIds: readonly string[],
  inicio: Date,
  fin: Date,
) {
  return prisma.recepcionCompra.findMany({
    where: {
      empresaId,
      sucursalId: { in: [...sucursalIds] },
      estado: 'CONFIRMADA',
      fecha: { gte: inicio, lte: fin },
    },
    orderBy: { fecha: 'asc' },
    select: {
      id: true,
      numero: true,
      fecha: true,
      proveedor: { select: { id: true, nombre: true } },
      sucursal: { select: { nombre: true } },
      orden: { select: { numero: true } },
      lineas: {
        orderBy: { insumo: { nombre: 'asc' } },
        select: {
          cantidad: true,
          precioUnitario: true,
          insumo: INSUMO,
          presentacion: { select: { nombre: true } },
        },
      },
    },
  });
}
