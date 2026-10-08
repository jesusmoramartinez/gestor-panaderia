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

/**
 * Extrae un parámetro de la URL para pasárselo a requiereSucursal.
 *
 * Existe porque Express tipa `req.params[x]` como `string | string[]`: con
 * ciertos patrones de ruta un parámetro puede repetirse y llegar como lista.
 * Acá nos quedamos solo con el caso de un valor único; cualquier otra cosa se
 * trata como "no vino", y el middleware responde 400.
 */
export function paramDeRuta(nombre: string): (req: Request) => string | undefined {
  return (req) => {
    const valor = req.params[nombre];
    return typeof valor === 'string' ? valor : undefined;
  };
}

/**
 * Lo mismo, pero leyendo del CUERPO del pedido (un POST de consumo manda la
 * sucursal en el body) y del QUERY STRING (un GET la manda en la URL).
 *
 * OJO con la diferencia respecto del empresaId: la SUCURSAL sí puede venir del
 * cliente, porque el usuario elige en qué sucursal trabaja. Lo que no se
 * negocia es que el servidor verifique que esa sucursal esté entre las que
 * tiene habilitadas, y eso es exactamente lo que hace requiereSucursal. El
 * empresaId, en cambio, NUNCA viene del cliente: sale de la sesión.
 */
export function campoDeCuerpo(nombre: string): (req: Request) => string | undefined {
  return (req) => {
    const cuerpo: unknown = req.body;
    if (typeof cuerpo !== 'object' || cuerpo === null) return undefined;
    const valor = (cuerpo as Record<string, unknown>)[nombre];
    return typeof valor === 'string' ? valor : undefined;
  };
}

export function campoDeQuery(nombre: string): (req: Request) => string | undefined {
  return (req) => {
    const valor = req.query[nombre];
    return typeof valor === 'string' ? valor : undefined;
  };
}
