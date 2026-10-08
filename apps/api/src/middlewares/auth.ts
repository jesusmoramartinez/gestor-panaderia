import type { RequestHandler } from 'express';

import { errores } from '../lib/errores.js';
import { NOMBRE_COOKIE_SESION } from '../modules/auth/cookies.js';
import { resolverContexto } from '../modules/auth/service.js';

/**
 * Convierte la cookie de sesión en `req.ctx`, o corta el pedido con un 401.
 *
 * Acá se decide el `empresaId` de todo el pedido, y sale de la SESIÓN. Es la
 * regla de seguridad más importante del sistema: si el empresaId viniera del
 * body o del query, cambiar un UUID alcanzaría para leer los datos de otra
 * panadería.
 */
export const requiereAutenticacion: RequestHandler = async (req, _res, next) => {
  // req.cookies lo llena cookie-parser y viene sin tipar; lo acotamos acá para
  // que no se escape un `any` al resto del código.
  const cookies = req.cookies as Record<string, string | undefined> | undefined;
  const token = cookies?.[NOMBRE_COOKIE_SESION];

  if (typeof token !== 'string' || token.length === 0) {
    next(errores.noAutenticado());
    return;
  }

  const ctx = await resolverContexto(token, req.ip);
  if (!ctx) {
    // Token inexistente, revocado, vencido o usuario desactivado: desde afuera
    // los cuatro casos se ven igual. No hay que dar pistas.
    next(errores.noAutenticado());
    return;
  }

  req.ctx = ctx;
  next();
};
