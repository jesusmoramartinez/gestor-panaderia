// CAPA 4 — ACCESO A DATOS: consultas. No decide reglas.
import type { Prisma } from '../../generated/prisma/client.js';
import { prisma } from '../../lib/db.js';

const SELECCION_PLANTILLA = {
  id: true,
  nombre: true,
  notas: true,
  activa: true,
  sucursalId: true,
  proveedor: { select: { id: true, nombre: true } },
  sucursal: { select: { id: true, codigo: true, nombre: true } },
  lineas: {
    orderBy: { insumo: { nombre: 'asc' } },
    select: {
      id: true,
      cantidad: true,
      insumo: { select: { id: true, nombre: true, unidadBase: { select: { codigo: true } } } },
      presentacion: { select: { id: true, nombre: true } },
    },
  },
} as const;

export type FilaPlantilla = Prisma.PlantillaPedidoGetPayload<{
  select: typeof SELECCION_PLANTILLA;
}>;

export function listar(
  empresaId: string,
  sucursalIds: readonly string[],
  incluirInactivas: boolean,
) {
  return prisma.plantillaPedido.findMany({
    where: {
      empresaId,
      sucursalId: { in: [...sucursalIds] },
      ...(incluirInactivas ? {} : { activa: true }),
    },
    orderBy: { nombre: 'asc' },
    select: SELECCION_PLANTILLA,
  });
}

export function buscar(empresaId: string, plantillaId: string) {
  return prisma.plantillaPedido.findFirst({
    where: { id: plantillaId, empresaId },
    select: SELECCION_PLANTILLA,
  });
}

/** Para el control de nombre repetido, que da un mensaje mejor que el UNIQUE. */
export function buscarPorNombre(empresaId: string, nombre: string, excluirId?: string) {
  return prisma.plantillaPedido.findFirst({
    where: {
      empresaId,
      nombre: { equals: nombre, mode: 'insensitive' },
      ...(excluirId === undefined ? {} : { id: { not: excluirId } }),
    },
    select: { id: true, nombre: true },
  });
}
