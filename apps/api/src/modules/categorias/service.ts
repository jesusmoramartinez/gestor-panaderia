import type { Categoria, CrearCategoriaInput } from '@panaderia/shared';

import { registrarAuditoria } from '../../lib/auditoria.js';
import type { Contexto } from '../../lib/contexto.js';
import { prisma } from '../../lib/db.js';
import { errores } from '../../lib/errores.js';
import * as repo from './repo.js';

export function listar(ctx: Contexto, incluirInactivas: boolean): Promise<Categoria[]> {
  return repo.listarPorEmpresa(ctx.empresaId, incluirInactivas);
}

export async function crear(ctx: Contexto, entrada: CrearCategoriaInput): Promise<Categoria> {
  const existente = await repo.buscarPorNombre(ctx.empresaId, entrada.nombre);
  if (existente) throw errores.nombreDuplicado(`la categoría "${existente.nombre}"`);

  return prisma.$transaction(async (tx) => {
    const categoria = await tx.categoriaInsumo.create({
      data: { empresaId: ctx.empresaId, nombre: entrada.nombre },
      select: { id: true, nombre: true, activa: true },
    });

    await registrarAuditoria(tx, {
      empresaId: ctx.empresaId,
      usuarioId: ctx.usuarioId,
      entidad: 'categoria_insumo',
      entidadId: categoria.id,
      accion: 'CREAR',
      datosDespues: { nombre: categoria.nombre },
      ip: ctx.ip ?? null,
    });

    return categoria;
  });
}
