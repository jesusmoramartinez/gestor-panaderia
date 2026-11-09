// CAPA 4 — ACCESO A DATOS: consultas. No decide reglas.
import { prisma } from '../../lib/db.js';

const SELECCION_COMPRA = {
  id: true,
  numero: true,
  estado: true,
  pedidaAt: true,
  createdAt: true,
  proveedor: { select: { id: true, nombre: true } },
  sucursal: { select: { id: true, codigo: true, nombre: true } },
  lineas: {
    orderBy: { insumo: { nombre: 'asc' } },
    select: {
      id: true,
      cantidad: true,
      cantidadBase: true,
      factorConversion: true,
      precioUnitario: true,
      insumo: { select: { id: true, nombre: true, unidadBase: { select: { codigo: true } } } },
      presentacion: { select: { id: true, nombre: true } },
    },
  },
} as const;

/**
 * Las compras que todavía esperan mercadería (PEDIDA o PARCIAL), con sus
 * renglones. Una CERRADA con faltante ya no espera nada: lo que faltó no va a
 * llegar (si estaba pagado, es plata a favor: ver comprasTerminadasConPagos).
 */
export function comprasAbiertas(empresaId: string, sucursalIds: readonly string[]) {
  return prisma.ordenCompra.findMany({
    where: {
      empresaId,
      estado: { in: ['PEDIDA', 'PARCIAL'] },
      sucursalId: { in: [...sucursalIds] },
    },
    orderBy: [{ pedidaAt: 'asc' }, { numero: 'asc' }],
    select: SELECCION_COMPRA,
  });
}
export type FilaCompraAbierta = Awaited<ReturnType<typeof comprasAbiertas>>[number];

/** Lo recibido de cada renglón (en unidad base), solo de entregas CONFIRMADAS. */
export async function recibidoPorRenglon(
  ordenIds: readonly string[],
): Promise<Map<string, string>> {
  if (ordenIds.length === 0) return new Map();
  const filas = await prisma.lineaRecepcionCompra.groupBy({
    by: ['lineaOrdenCompraId'],
    where: {
      lineaOrden: { ordenCompraId: { in: [...ordenIds] } },
      recepcion: { estado: 'CONFIRMADA' },
    },
    _sum: { cantidadBase: true },
  });
  const resultado = new Map<string, string>();
  for (const fila of filas) {
    if (fila.lineaOrdenCompraId !== null) {
      resultado.set(fila.lineaOrdenCompraId, fila._sum.cantidadBase?.toString() ?? '0');
    }
  }
  return resultado;
}

/** Lo pagado de cada compra (pagos NO anulados). */
export async function pagadoPorCompra(ordenIds: readonly string[]): Promise<Map<string, string>> {
  if (ordenIds.length === 0) return new Map();
  const filas = await prisma.pago.groupBy({
    by: ['ordenCompraId'],
    where: { ordenCompraId: { in: [...ordenIds] }, anuladoAt: null },
    _sum: { monto: true },
  });
  return new Map(filas.map((fila) => [fila.ordenCompraId, fila._sum.monto?.toString() ?? '0']));
}

/**
 * Compras TERMINADAS (cerradas con faltante o canceladas) que tienen pagos.
 * Si se pagó más de lo que llegó, lo que falta ya no va a llegar: es PLATA A
 * FAVOR, que el proveedor tiene que devolver.
 */
export function comprasTerminadasConPagos(empresaId: string, sucursalIds: readonly string[]) {
  return prisma.ordenCompra.findMany({
    where: {
      empresaId,
      estado: { in: ['CERRADA', 'CANCELADA'] },
      sucursalId: { in: [...sucursalIds] },
      pagos: { some: { anuladoAt: null } },
    },
    orderBy: [{ cerradaAt: 'asc' }, { numero: 'asc' }],
    select: SELECCION_COMPRA,
  });
}

// ===========================================================================
// Historial de una compra (Fase 12c)
// ===========================================================================

const PERSONA = { select: { id: true, nombre: true } } as const;

/** Todo lo que hace falta para armar el historial de una compra. */
export function datosHistorial(empresaId: string, ordenId: string) {
  return prisma.ordenCompra.findFirst({
    where: { id: ordenId, empresaId },
    select: {
      sucursalId: true,
      estado: true,
      createdAt: true,
      pedidaAt: true,
      cerradaAt: true,
      notaCierre: true,
      usuario: PERSONA,
      lineas: { select: { cantidad: true, precioUnitario: true } },
      pagos: {
        select: {
          fecha: true,
          monto: true,
          medio: true,
          nota: true,
          anuladoAt: true,
          motivoAnulacion: true,
          usuario: PERSONA,
          anuladoPor: PERSONA,
          _count: { select: { comprobantes: true } },
        },
      },
      recepciones: {
        select: {
          id: true,
          numero: true,
          fecha: true,
          numeroRemito: true,
          anuladaAt: true,
          motivoAnulacion: true,
          sucursal: { select: { nombre: true } },
          usuario: PERSONA,
          anuladaPor: PERSONA,
          _count: { select: { comprobantes: true } },
          lineas: {
            orderBy: { insumo: { nombre: 'asc' } },
            select: {
              cantidad: true,
              insumo: { select: { nombre: true, unidadBase: { select: { codigo: true } } } },
              presentacion: { select: { nombre: true } },
            },
          },
        },
      },
      anotaciones: { select: { createdAt: true, texto: true, usuario: PERSONA } },
    },
  });
}

/**
 * Las ediciones y el cierre o la cancelación de una compra, que no tienen
 * tabla propia: quedaron en la auditoría (la acción "pedir" también es un
 * ACTUALIZAR, y se distingue porque lleva `accion: 'pedir'`).
 */
export function auditoriaDeCompra(empresaId: string, ordenId: string) {
  return prisma.auditoria.findMany({
    where: {
      empresaId,
      entidad: 'orden_compra',
      entidadId: ordenId,
      accion: { in: ['ACTUALIZAR', 'ANULAR'] },
    },
    orderBy: { createdAt: 'asc' },
    select: { accion: true, createdAt: true, datosDespues: true, usuario: PERSONA },
  });
}
