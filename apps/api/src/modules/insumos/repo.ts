// CAPA 4 — ACCESO A DATOS: consultas. No decide reglas.
import type { Prisma } from '../../generated/prisma/client.js';
import { prisma } from '../../lib/db.js';

/** Lo que el listado necesita. No trae presentaciones ni parámetros. */
const SELECCION_RESUMEN = {
  id: true,
  codigo: true,
  nombre: true,
  activo: true,
  categoria: { select: { id: true, nombre: true } },
  unidadBase: {
    select: { id: true, codigo: true, nombre: true, dimension: true, factorABase: true },
  },
  // Conteo de relaciones FILTRADO: solo las presentaciones activas.
  _count: { select: { presentaciones: { where: { activa: true } } } },
} as const;

export type FiltroListado = {
  empresaId: string;
  busqueda: string | undefined;
  categoriaId: string | undefined;
  incluirInactivos: boolean;
  limite: number;
  desplazamiento: number;
};

function armarWhere(filtro: FiltroListado): Prisma.InsumoWhereInput {
  return {
    // SIEMPRE por empresaId.
    empresaId: filtro.empresaId,
    ...(filtro.incluirInactivos ? {} : { activo: true }),
    ...(filtro.categoriaId === undefined ? {} : { categoriaId: filtro.categoriaId }),
    ...(filtro.busqueda === undefined
      ? {}
      : {
          // mode: 'insensitive' hace la búsqueda sin distinguir mayúsculas.
          OR: [
            { nombre: { contains: filtro.busqueda, mode: 'insensitive' } },
            { codigo: { contains: filtro.busqueda, mode: 'insensitive' } },
          ],
        }),
  };
}

export function listar(filtro: FiltroListado) {
  const where = armarWhere(filtro);
  // Las dos consultas en una transacción: así el total y la página que se
  // devuelve corresponden al MISMO estado de la base. Si alguien crea un
  // insumo entre las dos consultas, no queda un total que no cuadra.
  return prisma.$transaction([
    prisma.insumo.findMany({
      where,
      orderBy: [{ nombre: 'asc' }],
      take: filtro.limite,
      skip: filtro.desplazamiento,
      select: SELECCION_RESUMEN,
    }),
    prisma.insumo.count({ where }),
  ]);
}

export function buscarResumen(empresaId: string, insumoId: string) {
  return prisma.insumo.findFirst({
    where: { id: insumoId, empresaId },
    select: SELECCION_RESUMEN,
  });
}

export function buscarDetalle(empresaId: string, insumoId: string) {
  return prisma.insumo.findFirst({
    where: { id: insumoId, empresaId },
    select: {
      ...SELECCION_RESUMEN,
      presentaciones: {
        orderBy: [{ esDefault: 'desc' }, { cantidadBase: 'asc' }],
        select: {
          id: true,
          nombre: true,
          cantidadBase: true,
          esDefault: true,
          activa: true,
        },
      },
      porSucursal: {
        select: {
          sucursalId: true,
          stockMinimo: true,
          stockMaximo: true,
          ubicacion: true,
          activo: true,
        },
      },
    },
  });
}

/** Busca por nombre ignorando mayúsculas, opcionalmente excluyendo un id. */
export function buscarPorNombre(empresaId: string, nombre: string, excluirId?: string) {
  return prisma.insumo.findFirst({
    where: {
      empresaId,
      nombre: { equals: nombre, mode: 'insensitive' },
      ...(excluirId === undefined ? {} : { id: { not: excluirId } }),
    },
    select: { id: true, nombre: true },
  });
}

export function buscarPorCodigo(empresaId: string, codigo: string, excluirId?: string) {
  return prisma.insumo.findFirst({
    where: {
      empresaId,
      codigo: { equals: codigo, mode: 'insensitive' },
      ...(excluirId === undefined ? {} : { id: { not: excluirId } }),
    },
    select: { id: true, codigo: true },
  });
}

export function contarUnidadEnEmpresa(empresaId: string, unidadId: string) {
  return prisma.unidadMedida.count({ where: { id: unidadId, empresaId, activa: true } });
}

export function contarCategoriaEnEmpresa(empresaId: string, categoriaId: string) {
  return prisma.categoriaInsumo.count({ where: { id: categoriaId, empresaId, activa: true } });
}

/**
 * Las sucursales de la empresa. Se consulta acá y no se reusa el repositorio
 * de otro módulo: que un módulo dependa del acceso a datos de otro los
 * encadena, y después no se puede tocar uno sin romper el otro.
 */
export function sucursalesDeEmpresa(empresaId: string) {
  return prisma.sucursal.findMany({
    where: { empresaId, activa: true },
    orderBy: { codigo: 'asc' },
    select: { id: true, codigo: true, nombre: true },
  });
}

export function buscarPresentacion(insumoId: string, presentacionId: string) {
  return prisma.presentacionInsumo.findFirst({
    where: { id: presentacionId, insumoId },
    select: { id: true, nombre: true, esDefault: true, activa: true },
  });
}

export function buscarPresentacionPorNombre(insumoId: string, nombre: string, excluirId?: string) {
  return prisma.presentacionInsumo.findFirst({
    where: {
      insumoId,
      nombre: { equals: nombre, mode: 'insensitive' },
      ...(excluirId === undefined ? {} : { id: { not: excluirId } }),
    },
    select: { id: true },
  });
}
