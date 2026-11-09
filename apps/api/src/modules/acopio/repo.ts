// CAPA 4 — ACCESO A DATOS: consultas. No decide reglas.
import { prisma } from '../../lib/db.js';

/**
 * Las compras que todavía esperan mercadería (PEDIDA o PARCIAL), con sus
 * renglones. Una CERRADA con faltante ya no espera nada: lo que faltó no va a
 * llegar (si estaba pagado, es plata a favor, y eso lo muestran los reportes).
 */
export function comprasAbiertas(empresaId: string, sucursalIds: readonly string[]) {
  return prisma.ordenCompra.findMany({
    where: {
      empresaId,
      estado: { in: ['PEDIDA', 'PARCIAL'] },
      sucursalId: { in: [...sucursalIds] },
    },
    orderBy: [{ pedidaAt: 'asc' }, { numero: 'asc' }],
    select: {
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
    },
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

/**
 * Lo pagado de cada compra (pagos no anulados).
 *
 * Los pagos llegan en la Fase 12b; hasta entonces ninguna compra tiene pagos,
 * y "lo adelantado sin entregar" da cero.
 */
export function pagadoPorCompra(ordenIds: readonly string[]): Promise<Map<string, string>> {
  return Promise.resolve(new Map(ordenIds.map((id) => [id, '0'])));
}
