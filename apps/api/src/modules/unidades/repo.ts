import { prisma } from '../../lib/db.js';

export function listarPorEmpresa(empresaId: string) {
  return prisma.unidadMedida.findMany({
    // SIEMPRE filtrado por empresaId.
    where: { empresaId, activa: true },
    // Agrupadas por dimensión, con la unidad base primero: es el orden en que
    // tiene sentido mostrarlas en un selector.
    orderBy: [{ dimension: 'asc' }, { esBase: 'desc' }, { codigo: 'asc' }],
    select: {
      id: true,
      codigo: true,
      nombre: true,
      dimension: true,
      factorABase: true,
      esBase: true,
    },
  });
}
