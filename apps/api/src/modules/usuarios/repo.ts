import { prisma } from '../../lib/db.js';

/** Qué campos se traen de la base. No incluye passwordHash a propósito. */
const SELECCION = {
  id: true,
  email: true,
  nombre: true,
  rol: true,
  activo: true,
  ultimoAccesoAt: true,
  sucursales: {
    select: { sucursal: { select: { id: true, codigo: true, nombre: true, esCentral: true } } },
    orderBy: { sucursal: { codigo: 'asc' } },
  },
} as const;

export function listarPorEmpresa(empresaId: string) {
  return prisma.usuario.findMany({
    // SIEMPRE filtrado por empresaId: es la regla que impide ver datos de otra
    // panadería.
    where: { empresaId },
    orderBy: [{ rol: 'asc' }, { email: 'asc' }],
    select: SELECCION,
  });
}

export function buscarPorEmail(email: string) {
  // Sin empresaId a propósito: el email es único a nivel GLOBAL, así que para
  // saber si está libre hay que mirar todas las empresas. Es la única consulta
  // del sistema que no filtra por empresa, y por eso solo devuelve el id.
  return prisma.usuario.findUnique({ where: { email }, select: { id: true } });
}

export function contarSucursalesDeEmpresa(empresaId: string, sucursalIds: readonly string[]) {
  return prisma.sucursal.count({
    where: { empresaId, id: { in: [...sucursalIds] } },
  });
}

export function buscarEnEmpresa(empresaId: string, usuarioId: string) {
  return prisma.usuario.findFirst({
    where: { id: usuarioId, empresaId },
    select: SELECCION,
  });
}
