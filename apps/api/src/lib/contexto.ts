import type { Permiso, Rol } from '@panaderia/shared';
import type { Request } from 'express';

import { errores } from './errores.js';

/**
 * Todo lo que el servidor sabe de "quién está haciendo este pedido".
 *
 * Se arma UNA vez por pedido, en el middleware de autenticación, a partir de
 * la cookie de sesión. De acá sale el empresaId que filtra todas las
 * consultas: ese dato NUNCA viene del body, del query ni de un header, porque
 * todo eso lo controla el cliente.
 */
export type Contexto = {
  usuarioId: string;
  empresaId: string;
  rol: Rol;
  permisos: readonly Permiso[];
  /**
   * Ids de las sucursales donde este usuario puede operar.
   * Para el DUEÑO son TODAS las de su empresa, resueltas al autenticar, así
   * el resto del código no necesita saber que el dueño es un caso especial.
   */
  sucursalesPermitidas: readonly string[];
  sesionId: string;
  ip: string | undefined;
};

/**
 * Lee el contexto del pedido.
 *
 * Si falta, significa que la ruta se montó sin el middleware requireAuth: es
 * un error de programación, y es mejor que falle con un 401 claro que seguir
 * adelante con datos de nadie.
 */
export function contextoDe(req: Request): Contexto {
  const ctx = req.ctx;
  if (!ctx) throw errores.noAutenticado();
  return ctx;
}

export function puedeOperarEn(ctx: Contexto, sucursalId: string): boolean {
  return ctx.sucursalesPermitidas.includes(sucursalId);
}
