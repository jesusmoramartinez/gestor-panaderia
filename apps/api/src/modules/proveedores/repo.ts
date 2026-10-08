// CAPA 4 — ACCESO A DATOS: consultas. No decide reglas.
import type { Prisma } from '../../generated/prisma/client.js';
import { prisma } from '../../lib/db.js';

/** Lo que el listado de proveedores necesita. */
const SELECCION_PROVEEDOR = {
  id: true,
  nombre: true,
  razonSocial: true,
  cuit: true,
  email: true,
  telefono: true,
  direccion: true,
  contactoNombre: true,
  diasEntrega: true,
  notas: true,
  activo: true,
  // Conteo de relaciones FILTRADO: solo las asociaciones activas.
  _count: { select: { insumos: { where: { activo: true } } } },
} as const;

/** Las columnas de la tabla puente, más lo que se muestra de cada punta. */
const SELECCION_ASOCIACION = {
  id: true,
  codigoProveedor: true,
  ultimoPrecio: true,
  ultimoPrecioAt: true,
  esPreferido: true,
  activo: true,
  insumo: {
    select: { id: true, nombre: true, activo: true, unidadBase: { select: { codigo: true } } },
  },
  presentacion: { select: { id: true, nombre: true, cantidadBase: true } },
  proveedor: { select: { id: true, nombre: true, activo: true, diasEntrega: true } },
} as const;

export function listar(empresaId: string, busqueda: string | undefined, incluirInactivos: boolean) {
  const where: Prisma.ProveedorWhereInput = {
    // SIEMPRE por empresaId.
    empresaId,
    ...(incluirInactivos ? {} : { activo: true }),
    ...(busqueda === undefined
      ? {}
      : {
          OR: [
            { nombre: { contains: busqueda, mode: 'insensitive' } },
            { razonSocial: { contains: busqueda, mode: 'insensitive' } },
            { cuit: { contains: busqueda } },
          ],
        }),
  };

  return prisma.proveedor.findMany({
    where,
    orderBy: { nombre: 'asc' },
    select: SELECCION_PROVEEDOR,
  });
}

export function buscar(empresaId: string, proveedorId: string) {
  return prisma.proveedor.findFirst({
    where: { id: proveedorId, empresaId },
    select: SELECCION_PROVEEDOR,
  });
}

/** Las asociaciones de UN proveedor, para su ficha. */
export function asociacionesDeProveedor(empresaId: string, proveedorId: string) {
  return prisma.proveedorInsumo.findMany({
    where: { empresaId, proveedorId },
    orderBy: [{ esPreferido: 'desc' }, { insumo: { nombre: 'asc' } }],
    select: SELECCION_ASOCIACION,
  });
}

/** Las asociaciones de UN insumo, para la ficha del insumo. La vista espejo. */
export function asociacionesDeInsumo(empresaId: string, insumoId: string) {
  return prisma.proveedorInsumo.findMany({
    where: { empresaId, insumoId },
    orderBy: [{ esPreferido: 'desc' }, { proveedor: { nombre: 'asc' } }],
    select: SELECCION_ASOCIACION,
  });
}

export function buscarAsociacion(empresaId: string, proveedorId: string, asociacionId: string) {
  return prisma.proveedorInsumo.findFirst({
    where: { id: asociacionId, proveedorId, empresaId },
    select: SELECCION_ASOCIACION,
  });
}

/** Busca por nombre ignorando mayúsculas, opcionalmente excluyendo un id. */
export function buscarPorNombre(empresaId: string, nombre: string, excluirId?: string) {
  return prisma.proveedor.findFirst({
    where: {
      empresaId,
      nombre: { equals: nombre, mode: 'insensitive' },
      ...(excluirId === undefined ? {} : { id: { not: excluirId } }),
    },
    select: { id: true, nombre: true },
  });
}

export function buscarPorCuit(empresaId: string, cuit: string, excluirId?: string) {
  return prisma.proveedor.findFirst({
    where: {
      empresaId,
      cuit,
      ...(excluirId === undefined ? {} : { id: { not: excluirId } }),
    },
    select: { id: true, nombre: true },
  });
}

/**
 * El insumo con sus presentaciones, para las dos validaciones cruzadas:
 * que sea de la empresa y que la presentación elegida sea DE ÉL.
 */
export function buscarInsumoConPresentaciones(empresaId: string, insumoId: string) {
  return prisma.insumo.findFirst({
    where: { id: insumoId, empresaId },
    select: {
      id: true,
      nombre: true,
      activo: true,
      presentaciones: { select: { id: true, nombre: true, activa: true } },
    },
  });
}

/** ¿Este proveedor ya tiene este insumo asociado? */
export function buscarAsociacionPorPar(proveedorId: string, insumoId: string) {
  return prisma.proveedorInsumo.findFirst({
    where: { proveedorId, insumoId },
    select: { id: true, activo: true, proveedor: { select: { nombre: true } } },
  });
}
