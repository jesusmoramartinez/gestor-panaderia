import type { Contexto } from '../lib/contexto.js';

/**
 * "Declaration merging": le agregamos una propiedad al tipo Request de
 * Express sin modificar su código. TypeScript fusiona esta declaración con la
 * original, así `req.ctx` existe y está tipado en todo el proyecto.
 *
 * Es opcional (`?`) porque en las rutas públicas (el login, el health check)
 * todavía no hay sesión. Para leerlo se usa contextoDe(req), que falla con un
 * 401 claro si falta en lugar de devolver undefined.
 */
declare global {
  namespace Express {
    interface Request {
      ctx?: Contexto;
    }
  }
}
