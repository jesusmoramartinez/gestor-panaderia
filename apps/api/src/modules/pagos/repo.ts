// CAPA 4 — ACCESO A DATOS: consultas. No decide reglas.
import { prisma } from '../../lib/db.js';
import type { Tx } from '../movimientos/motor.js';

type Cliente = Tx | typeof prisma;

export function pagoPlano(cliente: Cliente, empresaId: string, pagoId: string) {
  return cliente.pago.findFirst({
    where: { id: pagoId, empresaId },
    select: {
      id: true,
      ordenCompraId: true,
      monto: true,
      medio: true,
      anuladoAt: true,
      orden: { select: { sucursalId: true } },
    },
  });
}

/**
 * El candado de un pago. FOR NO KEY UPDATE y no FOR UPDATE (regla 19): el
 * comprobante tiene una clave foránea a pago, y agregarle una foto le pone
 * al pago un candado FOR KEY SHARE que FOR UPDATE no dejaría convivir.
 */
export async function bloquearPago(tx: Tx, empresaId: string, pagoId: string): Promise<boolean> {
  const filas = await tx.$queryRaw<{ id: string }[]>`
    SELECT id FROM pago
    WHERE id = ${pagoId}::uuid AND empresa_id = ${empresaId}::uuid
    FOR NO KEY UPDATE`;
  return filas.length === 1;
}

/** Un comprobante CON sus bytes: es el único lugar que los trae. */
export function comprobante(empresaId: string, comprobanteId: string) {
  return prisma.comprobante.findFirst({
    where: { id: comprobanteId, empresaId },
    select: {
      tipo: true,
      datos: true,
      pago: { select: { orden: { select: { sucursalId: true } } } },
      recepcion: { select: { sucursalId: true } },
    },
  });
}
