import type { Permiso } from '@panaderia/shared';
import type { Request, RequestHandler } from 'express';

import { contextoDe, puedeOperarEn } from '../lib/contexto.js';
import { errores } from '../lib/errores.js';

/**
 * Exige un permiso concreto. Se monta DESPUÉS de requiereAutenticacion.
 *
 * Es una función que devuelve un middleware (un "factory"): así se puede
 * escribir requierePermiso('usuario:crear') en la definición de la ruta.
 */
export function requierePermiso(permiso: Permiso): RequestHandler {
  return (req, _res, next) => {
    const ctx = contextoDe(req);
    if (!ctx.permisos.includes(permiso)) {
      next(errores.sinPermiso());
      return;
    }
    next();
  };
}

/**
 * Exige que el usuario pueda operar en la sucursal que indica el pedido.
 *
 * El `empresaId` ya lo garantiza la sesión, pero eso no alcanza: un empleado
 * de la sucursal Laferrere no tiene por qué cargar mermas en la Central.
 *
 * Recibe una función que sabe de dónde sacar el id en cada caso (del query en
 * un GET, del body en un POST), porque eso cambia según el endpoint.
 *
 * Su primer consumidor real llega con el stock por sucursal (Fase 4 en
 * adelante); acá queda la pieza y su test.
 */
export function requiereSucursal(
  obtenerSucursalId: (req: Request) => string | undefined,
): RequestHandler {
  return (req, _res, next) => {
    const ctx = contextoDe(req);
    const sucursalId = obtenerSucursalId(req);

    if (typeof sucursalId !== 'string' || sucursalId.length === 0) {
      next(errores.datosInvalidos({ sucursalId: 'Hay que indicar la sucursal.' }));
      return;
    }
    if (!puedeOperarEn(ctx, sucursalId)) {
      next(errores.sucursalNoPermitida());
      return;
    }
    next();
  };
}
