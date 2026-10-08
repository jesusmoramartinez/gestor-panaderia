import type { EventoAuditoria } from '@panaderia/shared';

import type { Contexto } from '../../lib/contexto.js';
import * as repo from './repo.js';

export async function listar(ctx: Contexto, limite: number): Promise<EventoAuditoria[]> {
  const filas = await repo.listarPorEmpresa(ctx.empresaId, limite);

  return filas.map((fila) => ({
    id: fila.id,
    accion: fila.accion,
    entidad: fila.entidad,
    entidadId: fila.entidadId,
    usuario: fila.usuario,
    ip: fila.ip,
    createdAt: fila.createdAt.toISOString(),
    // Los campos jsonb vuelven como `unknown`: son JSON arbitrario, así que
    // TypeScript no puede saber su forma. Van tal cual al frontend, que los
    // muestra como texto.
    datosAntes: fila.datosAntes ?? null,
    datosDespues: fila.datosDespues ?? null,
  }));
}
