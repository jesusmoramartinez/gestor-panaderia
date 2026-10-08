// CAPA 4 — ACCESO A DATOS: consultas. No decide reglas.
import { prisma } from '../../lib/db.js';

export function buscarUsuarioPorEmail(email: string) {
  return prisma.usuario.findUnique({
    where: { email },
    include: { empresa: true },
  });
}

export function buscarSesionPorTokenHash(tokenHash: string) {
  return prisma.sesion.findUnique({
    where: { tokenHash },
    include: {
      usuario: {
        include: {
          empresa: true,
          sucursales: { include: { sucursal: true } },
        },
      },
    },
  });
}

/** Todas las sucursales activas de una empresa (las que ve el DUEÑO). */
export function sucursalesDeEmpresa(empresaId: string) {
  return prisma.sucursal.findMany({
    where: { empresaId, activa: true },
    orderBy: { codigo: 'asc' },
    select: { id: true, codigo: true, nombre: true, esCentral: true },
  });
}

export function crearSesion(datos: {
  usuarioId: string;
  tokenHash: string;
  expiraAt: Date;
  ip: string | null;
  userAgent: string | null;
}) {
  return prisma.sesion.create({ data: datos });
}

export function revocarSesion(sesionId: string, cuando: Date) {
  return prisma.sesion.updateMany({
    // updateMany con revocadaAt: null para que revocar dos veces no cambie la
    // fecha original del primer logout.
    where: { id: sesionId, revocadaAt: null },
    data: { revocadaAt: cuando },
  });
}

export function tocarSesion(sesionId: string, datos: { ultimoUsoAt: Date; expiraAt?: Date }) {
  return prisma.sesion.update({ where: { id: sesionId }, data: datos });
}

export function marcarUltimoAcceso(usuarioId: string, cuando: Date) {
  return prisma.usuario.update({
    where: { id: usuarioId },
    data: { ultimoAccesoAt: cuando },
  });
}
