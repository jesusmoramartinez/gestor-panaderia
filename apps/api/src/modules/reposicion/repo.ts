// CAPA 4 — ACCESO A DATOS: consultas. No decide reglas.
import { prisma } from '../../lib/db.js';

/**
 * Las consultas de la reposición van en SQL a mano ($queryRaw) y no con el
 * cliente de Prisma, por dos razones:
 *
 *   1. usan la vista `v_stock_actual`, que Prisma no conoce (no está en el
 *      schema: es SQL de la migración);
 *   2. son JOIN y agregaciones que en Prisma serían varias consultas más un
 *      cruce en JavaScript, que es justo lo que la vista vino a evitar.
 *
 * Los decimales vuelven como TEXTO (`::text`): así no pasan nunca por un
 * number de JavaScript (ver docs/aprendizaje/04).
 *
 * Y TODAS filtran por empresa_id, como siempre: el SQL a mano no es excusa.
 */

/** Saldo, mínimo y máximo de cada insumo activo en cada sucursal activa. */
export function situaciones(empresaId: string) {
  return prisma.$queryRaw<
    {
      sucursal_id: string;
      insumo_id: string;
      saldo: string;
      stock_minimo: string;
      stock_maximo: string | null;
    }[]
  >`
    SELECT s.id                          AS sucursal_id,
           i.id                          AS insumo_id,
           COALESCE(v.saldo, 0)::text    AS saldo,
           COALESCE(p.stock_minimo, 0)::text AS stock_minimo,
           p.stock_maximo::text          AS stock_maximo
    FROM insumo i
    JOIN sucursal s
      ON s.empresa_id = i.empresa_id AND s.activa
    LEFT JOIN insumo_sucursal p
      ON p.insumo_id = i.id AND p.sucursal_id = s.id
    LEFT JOIN v_stock_actual v
      ON v.empresa_id = i.empresa_id AND v.sucursal_id = s.id AND v.insumo_id = i.id
    WHERE i.empresa_id = ${empresaId}::uuid
      AND i.activo
      -- Un insumo marcado "no se usa en esta sucursal" no se repone ahí.
      AND COALESCE(p.activo, true)
    ORDER BY s.nombre, i.nombre`;
}

/**
 * Lo que falta llegar de órdenes PEDIDAS o PARCIALES, por sucursal e insumo.
 * Lo pendiente de cada línea es lo pedido menos lo recibido en recepciones
 * CONFIRMADAS (la misma cuenta que la Fase 8, ahora en SQL).
 */
export function yaPedido(empresaId: string) {
  return prisma.$queryRaw<{ sucursal_id: string; insumo_id: string; cantidad: string }[]>`
    SELECT oc.sucursal_id,
           l.insumo_id,
           SUM(GREATEST(l.cantidad_base - COALESCE(r.recibido, 0), 0))::text AS cantidad
    FROM linea_orden_compra l
    JOIN orden_compra oc ON oc.id = l.orden_compra_id
    LEFT JOIN (
      SELECT lr.linea_orden_compra_id, SUM(lr.cantidad_base) AS recibido
      FROM linea_recepcion_compra lr
      JOIN recepcion_compra rc ON rc.id = lr.recepcion_compra_id
      WHERE rc.empresa_id = ${empresaId}::uuid AND rc.estado = 'CONFIRMADA'
      GROUP BY lr.linea_orden_compra_id
    ) r ON r.linea_orden_compra_id = l.id
    WHERE oc.empresa_id = ${empresaId}::uuid
      AND oc.estado IN ('PEDIDA', 'PARCIAL')
    GROUP BY oc.sucursal_id, l.insumo_id`;
}

/** Lo que viene en transferencias en tránsito, por sucursal de destino. */
export function enCamino(empresaId: string) {
  return prisma.$queryRaw<{ sucursal_id: string; insumo_id: string; cantidad: string }[]>`
    SELECT t.sucursal_destino_id AS sucursal_id,
           lt.insumo_id,
           SUM(lt.cantidad_base_enviada)::text AS cantidad
    FROM linea_transferencia lt
    JOIN transferencia t ON t.id = lt.transferencia_id
    WHERE t.empresa_id = ${empresaId}::uuid AND t.estado = 'ENVIADA'
    GROUP BY t.sucursal_destino_id, lt.insumo_id`;
}

/** El proveedor preferido (activo) de cada insumo, con su presentación y precio. */
export function preferidos(empresaId: string) {
  return prisma.proveedorInsumo.findMany({
    where: { empresaId, esPreferido: true, activo: true, proveedor: { activo: true } },
    select: {
      insumoId: true,
      ultimoPrecio: true,
      ultimoPrecioAt: true,
      presentacion: { select: { id: true, nombre: true, cantidadBase: true } },
      proveedor: { select: { id: true, nombre: true, diasEntrega: true } },
    },
  });
}

export function insumos(empresaId: string) {
  return prisma.insumo.findMany({
    where: { empresaId },
    select: { id: true, nombre: true, unidadBase: { select: { codigo: true } } },
  });
}

export function sucursales(empresaId: string) {
  return prisma.sucursal.findMany({
    where: { empresaId, activa: true },
    orderBy: { nombre: 'asc' },
    select: { id: true, codigo: true, nombre: true, esCentral: true },
  });
}

/** Solo lo necesario para el número del menú: mínimo y saldo de UNA sucursal. */
export function alertasDeSucursal(empresaId: string, sucursalId: string) {
  return prisma.$queryRaw<{ saldo: string; stock_minimo: string }[]>`
    SELECT COALESCE(v.saldo, 0)::text AS saldo, p.stock_minimo::text AS stock_minimo
    FROM insumo_sucursal p
    JOIN insumo i ON i.id = p.insumo_id AND i.activo
    LEFT JOIN v_stock_actual v
      ON v.empresa_id = p.empresa_id AND v.sucursal_id = p.sucursal_id AND v.insumo_id = p.insumo_id
    WHERE p.empresa_id = ${empresaId}::uuid
      AND p.sucursal_id = ${sucursalId}::uuid
      AND p.activo
      AND p.stock_minimo > 0`;
}
