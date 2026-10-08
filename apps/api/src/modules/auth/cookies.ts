import type { CookieOptions } from 'express';

import { env } from '../../config/env.js';

export const NOMBRE_COOKIE_SESION = 'panaderia_sesion';

/**
 * Las opciones de la cookie de sesión. Cada una está por un motivo:
 *
 * httpOnly: el JavaScript de la página NO puede leerla (document.cookie no la
 *   muestra). Si alguien logra inyectar un script en el sitio (un ataque XSS),
 *   no se puede robar la sesión. Es la razón principal por la que elegimos
 *   cookie en lugar de guardar un token en localStorage.
 *
 * sameSite 'lax': el navegador manda la cookie en la navegación normal, pero
 *   NO en pedidos POST que vengan de otro sitio. Eso corta los ataques CSRF,
 *   donde una página maliciosa hace que tu navegador envíe un pedido a nuestra
 *   API aprovechando que la cookie viaja sola.
 *
 * secure: en producción la cookie viaja solo por HTTPS. En desarrollo tiene
 *   que ser false, porque trabajamos en http://localhost.
 *
 * expires: hasta cuándo vale. El navegador la borra sola al vencer. Igual el
 *   servidor NO confía en esto: la fecha de verdad está en la tabla `sesion`,
 *   porque todo lo que vive en el navegador lo puede modificar el usuario.
 */
export function opcionesCookieSesion(expiraAt: Date): CookieOptions {
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure: env.NODE_ENV === 'production',
    path: '/',
    expires: expiraAt,
  };
}

/** Las mismas opciones, sin fecha, para borrarla en el logout. */
export function opcionesBorrarCookie(): CookieOptions {
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure: env.NODE_ENV === 'production',
    path: '/',
  };
}
