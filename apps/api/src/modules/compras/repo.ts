// CAPA 4 — ACCESO A DATOS: consultas. No decide reglas.
import type { Prisma } from '../../generated/prisma/client.js';
import type { EstadoOrdenCompra } from '../../generated/prisma/enums.js';
import { prisma } from '../../lib/db.js';
import type { Tx } from '../movimientos/motor.js';

/**
 * Un cliente que puede ser `prisma` o el `tx` de una transacción. Las
 * consultas que se usan ADENTRO de una transacción lo reciben como parámetro:
 * la respuesta solo es confiable si se pregunta con el candado tomado.
 */
type Cliente = Tx | typeof prisma;

// ===========================================================================
// Datos de referencia
// ===========================================================================

export function buscarProveedor(empresaId: string, proveedorId: string) {
  return prisma.proveedor.findFirst({
    where: { id: proveedorId, empresaId },
    select: { id: true, nombre: true, activo: true },
  });
}

export function buscarSucursal(empresaId: string, sucursalId: string) {
  return prisma.sucursal.findFirst({
    where: { id: sucursalId, empresaId },
    select: { id: true, codigo: true, nombre: true },
  });
}

/** Los insumos de las líneas, con sus presentaciones, para validarlas. */
export function insumosConPresentaciones(empresaId: string, insumoIds: readonly string[]) {
  return prisma.insumo.findMany({
    where: { id: { in: [...insumoIds] }, empresaId },
    select: {
      id: true,
      nombre: true,
      activo: true,
      unidadBase: { select: { codigo: true } },
      presentaciones: { select: { id: true, nombre: true, cantidadBase: true, activa: true } },
    },
  });
}

// ===========================================================================
// Candados
// ===========================================================================

/**
 * Bloquea la orden hasta el fin de la transacción.
 *
 * Todo lo que cambia una orden pasa por acá primero: editar, pedir, cancelar,
 * cerrar, recibir y anular una recepción. Así dos recepciones simultáneas de
 * la misma orden no pueden leer el mismo "faltan 6" y recibir 6 cada una.
 */
export async function bloquearOrden(tx: Tx, empresaId: string, ordenId: string): Promise<boolean> {
  const filas = await tx.$queryRaw<{ id: string }[]>`
    SELECT id FROM orden_compra
    WHERE id = ${ordenId}::uuid AND empresa_id = ${empresaId}::uuid
    FOR UPDATE`;
  return filas.length === 1;
}

/** Bloquea la recepción: dos anulaciones simultáneas no pueden pasar las dos. */
export async function bloquearRecepcion(
  tx: Tx,
  empresaId: string,
  recepcionId: string,
): Promise<boolean> {
  const filas = await tx.$queryRaw<{ id: string }[]>`
    SELECT id FROM recepcion_compra
    WHERE id = ${recepcionId}::uuid AND empresa_id = ${empresaId}::uuid
    FOR UPDATE`;
  return filas.length === 1;
}

// ===========================================================================
// Órdenes
// ===========================================================================

/** Los datos de la orden SIN relaciones: es la versión que se lee en la transacción. */
export function ordenPlana(cliente: Cliente, empresaId: string, ordenId: string) {
  return cliente.ordenCompra.findFirst({
    where: { id: ordenId, empresaId },
    select: {
      id: true,
      numero: true,
      estado: true,
      sucursalId: true,
      proveedorId: true,
      fechaEntregaEstimada: true,
      notas: true,
    },
  });
}

export function lineasDeOrden(cliente: Cliente, ordenId: string) {
  return cliente.lineaOrdenCompra.findMany({
    where: { ordenCompraId: ordenId },
    select: {
      id: true,
      insumoId: true,
      presentacionId: true,
      cantidad: true,
      factorConversion: true,
      cantidadBase: true,
      precioUnitario: true,
    },
  });
}

/**
 * Cuánto llegó de cada línea de una orden: la suma de las recepciones
 * CONFIRMADAS. Las anuladas no cuentan, y eso es todo lo que hace falta para
 * que anular una recepción "reabra" la orden.
 *
 * `groupBy` es UNA consulta (GROUP BY linea_orden_compra_id), así que se puede
 * usar adentro de la transacción.
 */
export async function recibidoPorLinea(
  cliente: Cliente,
  ordenId: string,
): Promise<Map<string, string>> {
  const filas = await cliente.lineaRecepcionCompra.groupBy({
    by: ['lineaOrdenCompraId'],
    where: {
      lineaOrden: { ordenCompraId: ordenId },
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

export function contarRecepcionesDeOrden(cliente: Cliente, ordenId: string) {
  return cliente.recepcionCompra.count({ where: { ordenCompraId: ordenId } });
}

const SELECCION_ORDEN_RESUMEN = {
  id: true,
  numero: true,
  estado: true,
  fechaEntregaEstimada: true,
  createdAt: true,
  pedidaAt: true,
  sucursal: { select: { id: true, codigo: true, nombre: true } },
  proveedor: { select: { id: true, nombre: true } },
  usuario: { select: { id: true, nombre: true } },
  lineas: { select: { cantidad: true, precioUnitario: true } },
} as const;

export type FilaOrdenResumen = Prisma.OrdenCompraGetPayload<{
  select: typeof SELECCION_ORDEN_RESUMEN;
}>;

export type FiltroListaOrdenes = {
  empresaId: string;
  sucursalIds: readonly string[];
  estados: readonly EstadoOrdenCompra[] | undefined;
  proveedorId: string | undefined;
  limite: number;
  desplazamiento: number;
};

function whereOrdenes(filtro: FiltroListaOrdenes): Prisma.OrdenCompraWhereInput {
  return {
    empresaId: filtro.empresaId,
    sucursalId: { in: [...filtro.sucursalIds] },
    ...(filtro.estados === undefined ? {} : { estado: { in: [...filtro.estados] } }),
    ...(filtro.proveedorId === undefined ? {} : { proveedorId: filtro.proveedorId }),
  };
}

export function listarOrdenes(filtro: FiltroListaOrdenes) {
  return prisma.ordenCompra.findMany({
    where: whereOrdenes(filtro),
    orderBy: { numero: 'desc' },
    take: filtro.limite,
    skip: filtro.desplazamiento,
    select: SELECCION_ORDEN_RESUMEN,
  });
}

export function contarOrdenes(filtro: FiltroListaOrdenes) {
  return prisma.ordenCompra.count({ where: whereOrdenes(filtro) });
}

export function ordenDetalle(empresaId: string, ordenId: string) {
  return prisma.ordenCompra.findFirst({
    where: { id: ordenId, empresaId },
    select: {
      ...SELECCION_ORDEN_RESUMEN,
      sucursalId: true,
      notas: true,
      notaCierre: true,
      cerradaAt: true,
      lineas: {
        orderBy: { insumo: { nombre: 'asc' } },
        select: {
          id: true,
          cantidad: true,
          factorConversion: true,
          cantidadBase: true,
          precioUnitario: true,
          insumo: { select: { id: true, nombre: true, unidadBase: { select: { codigo: true } } } },
          presentacion: { select: { id: true, nombre: true } },
        },
      },
    },
  });
}

// ===========================================================================
// Recepciones
// ===========================================================================

export function recepcionPlana(cliente: Cliente, empresaId: string, recepcionId: string) {
  return cliente.recepcionCompra.findFirst({
    where: { id: recepcionId, empresaId },
    select: {
      id: true,
      numero: true,
      estado: true,
      fecha: true,
      sucursalId: true,
      proveedorId: true,
      ordenCompraId: true,
    },
  });
}

/** Los movimientos COMPRA que escribió una recepción: los que hay que revertir. */
export function comprasDeRecepcion(tx: Tx, empresaId: string, recepcionId: string) {
  return tx.movimientoStock.findMany({
    where: { empresaId, recepcionCompraId: recepcionId, tipo: 'COMPRA' },
    orderBy: { insumoId: 'asc' },
    select: {
      id: true,
      sucursalId: true,
      insumoId: true,
      cantidadBase: true,
      costoUnitario: true,
    },
  });
}

export function lineasDeRecepcion(cliente: Cliente, recepcionId: string) {
  return cliente.lineaRecepcionCompra.findMany({
    where: { recepcionCompraId: recepcionId },
    orderBy: { insumoId: 'asc' },
    select: { insumoId: true, presentacionId: true, precioUnitario: true, costoUnitarioBase: true },
  });
}

const SELECCION_RECEPCION_RESUMEN = {
  id: true,
  numero: true,
  estado: true,
  fecha: true,
  numeroRemito: true,
  numeroFactura: true,
  anuladaAt: true,
  sucursal: { select: { id: true, codigo: true, nombre: true } },
  proveedor: { select: { id: true, nombre: true } },
  orden: { select: { id: true, numero: true } },
  usuario: { select: { id: true, nombre: true } },
  lineas: { select: { cantidad: true, precioUnitario: true } },
} as const;

export type FilaRecepcionResumen = Prisma.RecepcionCompraGetPayload<{
  select: typeof SELECCION_RECEPCION_RESUMEN;
}>;

export type FiltroListaRecepciones = {
  empresaId: string;
  sucursalIds: readonly string[];
  proveedorId: string | undefined;
  ordenCompraId?: string;
  limite: number;
  desplazamiento: number;
};

function whereRecepciones(filtro: FiltroListaRecepciones): Prisma.RecepcionCompraWhereInput {
  return {
    empresaId: filtro.empresaId,
    sucursalId: { in: [...filtro.sucursalIds] },
    ...(filtro.proveedorId === undefined ? {} : { proveedorId: filtro.proveedorId }),
    ...(filtro.ordenCompraId === undefined ? {} : { ordenCompraId: filtro.ordenCompraId }),
  };
}

export function listarRecepciones(filtro: FiltroListaRecepciones) {
  return prisma.recepcionCompra.findMany({
    where: whereRecepciones(filtro),
    orderBy: [{ fecha: 'desc' }, { numero: 'desc' }],
    take: filtro.limite,
    skip: filtro.desplazamiento,
    select: SELECCION_RECEPCION_RESUMEN,
  });
}

export function contarRecepciones(filtro: FiltroListaRecepciones) {
  return prisma.recepcionCompra.count({ where: whereRecepciones(filtro) });
}

export function recepcionDetalle(empresaId: string, recepcionId: string) {
  return prisma.recepcionCompra.findFirst({
    where: { id: recepcionId, empresaId },
    select: {
      ...SELECCION_RECEPCION_RESUMEN,
      sucursalId: true,
      notas: true,
      operacionId: true,
      motivoAnulacion: true,
      anuladaPor: { select: { id: true, nombre: true } },
      lineas: {
        orderBy: { insumo: { nombre: 'asc' } },
        select: {
          id: true,
          lineaOrdenCompraId: true,
          cantidad: true,
          factorConversion: true,
          cantidadBase: true,
          precioUnitario: true,
          costoUnitarioBase: true,
          insumo: {
            select: {
              id: true,
              nombre: true,
              costoPromedio: true,
              unidadBase: { select: { codigo: true } },
            },
          },
          presentacion: { select: { id: true, nombre: true } },
        },
      },
    },
  });
}

// ===========================================================================
// Último precio del proveedor
// ===========================================================================

export function asociacion(tx: Tx, proveedorId: string, insumoId: string) {
  return tx.proveedorInsumo.findUnique({
    where: { proveedorId_insumoId: { proveedorId, insumoId } },
    select: { id: true, presentacionId: true, ultimoPrecioAt: true },
  });
}

export function cantidadBaseDePresentacion(tx: Tx, presentacionId: string) {
  return tx.presentacionInsumo.findUnique({
    where: { id: presentacionId },
    select: { cantidadBase: true },
  });
}

/**
 * La última recepción CONFIRMADA de un insumo a un proveedor: de ahí sale el
 * "último precio" cuando se anula la recepción que lo había puesto.
 */
export function ultimaRecepcionConfirmada(
  tx: Tx,
  empresaId: string,
  proveedorId: string,
  insumoId: string,
) {
  return tx.recepcionCompra.findFirst({
    where: { empresaId, proveedorId, estado: 'CONFIRMADA', lineas: { some: { insumoId } } },
    orderBy: [{ fecha: 'desc' }, { createdAt: 'desc' }],
    select: { id: true, fecha: true },
  });
}

export function lineaDeRecepcion(tx: Tx, recepcionId: string, insumoId: string) {
  return tx.lineaRecepcionCompra.findUnique({
    where: { recepcionCompraId_insumoId: { recepcionCompraId: recepcionId, insumoId } },
    select: { presentacionId: true, precioUnitario: true, costoUnitarioBase: true },
  });
}

export function costoDeInsumo(empresaId: string, insumoId: string) {
  return prisma.insumo.findFirst({
    where: { id: insumoId, empresaId },
    select: { id: true, costoPromedio: true, unidadBase: { select: { codigo: true } } },
  });
}
