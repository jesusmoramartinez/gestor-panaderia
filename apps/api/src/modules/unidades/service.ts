import type { UnidadMedida } from '@panaderia/shared';

import type { Contexto } from '../../lib/contexto.js';
import * as repo from './repo.js';

export async function listar(ctx: Contexto): Promise<UnidadMedida[]> {
  const filas = await repo.listarPorEmpresa(ctx.empresaId);

  return filas.map((fila) => ({
    id: fila.id,
    codigo: fila.codigo,
    nombre: fila.nombre,
    dimension: fila.dimension,
    // El factor sale como TEXTO. Prisma lo devuelve como Decimal (su propia
    // copia de decimal.js) y toString() da el valor exacto; mandarlo como
    // number lo convertiría en float y perdería precisión en el camino.
    factorABase: fila.factorABase.toString(),
    esBase: fila.esBase,
  }));
}
