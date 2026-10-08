import { prisma } from '../../lib/db.js';

export function listarPorEmpresa(empresaId: string, limite: number) {
  return prisma.auditoria.findMany({
    where: { empresaId },
    // Usa el índice (empresa_id, created_at).
    orderBy: { createdAt: 'desc' },
    take: limite,
    select: {
      id: true,
      accion: true,
      entidad: true,
      entidadId: true,
      ip: true,
      createdAt: true,
      datosAntes: true,
      datosDespues: true,
      usuario: { select: { id: true, nombre: true, email: true } },
    },
  });
}
