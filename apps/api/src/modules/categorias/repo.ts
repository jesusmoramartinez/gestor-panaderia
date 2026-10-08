import { prisma } from '../../lib/db.js';

const SELECCION = { id: true, nombre: true, activa: true } as const;

export function listarPorEmpresa(empresaId: string, incluirInactivas: boolean) {
  return prisma.categoriaInsumo.findMany({
    where: { empresaId, ...(incluirInactivas ? {} : { activa: true }) },
    orderBy: { nombre: 'asc' },
    select: SELECCION,
  });
}

/**
 * Busca por nombre ignorando mayúsculas.
 *
 * El índice único de la base distingue mayúsculas, así que "Harinas" y
 * "harinas" podrían convivir aunque para una persona sean lo mismo. Este
 * chequeo lo evita antes de llegar a la base.
 */
export function buscarPorNombre(empresaId: string, nombre: string) {
  return prisma.categoriaInsumo.findFirst({
    where: { empresaId, nombre: { equals: nombre, mode: 'insensitive' } },
    select: { id: true, nombre: true },
  });
}

export function existeEnEmpresa(empresaId: string, categoriaId: string) {
  return prisma.categoriaInsumo.count({ where: { id: categoriaId, empresaId, activa: true } });
}
