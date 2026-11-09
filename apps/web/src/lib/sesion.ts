import {
  type CambiarEmailInput,
  type CambiarPasswordInput,
  type LoginInput,
  UsuarioSesionSchema,
} from '@panaderia/shared';
import { z } from 'zod';

import { pedirApi } from './api';

/**
 * La clave con la que TanStack Query guarda la sesión en su caché.
 * Es un array porque las claves pueden tener partes (por ejemplo
 * ['insumos', { sucursalId }]); así se pueden invalidar por grupos.
 */
export const CLAVE_SESION = ['sesion'] as const;

export function obtenerSesion() {
  return pedirApi('/api/auth/me', { esquema: UsuarioSesionSchema });
}

export function iniciarSesion(entrada: LoginInput) {
  return pedirApi('/api/auth/login', {
    metodo: 'POST',
    cuerpo: entrada,
    esquema: UsuarioSesionSchema,
  });
}

export function cerrarSesion() {
  // El logout responde 204 sin cuerpo: el esquema que corresponde es "null".
  return pedirApi('/api/auth/logout', { metodo: 'POST', esquema: z.null() });
}

/** Cambia MI contraseña. Responde 204: las otras sesiones quedan cerradas. */
export function cambiarPassword(entrada: CambiarPasswordInput) {
  return pedirApi('/api/auth/password', { metodo: 'POST', cuerpo: entrada, esquema: z.null() });
}

/** Cambia MI email. Devuelve la sesión con el email nuevo. */
export function cambiarEmail(entrada: CambiarEmailInput) {
  return pedirApi('/api/auth/email', {
    metodo: 'POST',
    cuerpo: entrada,
    esquema: UsuarioSesionSchema,
  });
}
