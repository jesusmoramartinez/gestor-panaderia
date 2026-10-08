import { useQuery } from '@tanstack/react-query';

import { CLAVE_SESION, obtenerSesion } from '../lib/sesion';

/**
 * Lee la sesión actual preguntándole al servidor.
 *
 * Fijate que el frontend NO decide si estás logueado: lo pregunta. No puede
 * hacer otra cosa, porque la cookie es httpOnly y el JavaScript no la ve. Eso
 * es exactamente lo que queremos: la única fuente de verdad es el servidor.
 */
export function useSesion() {
  return useQuery({
    queryKey: CLAVE_SESION,
    queryFn: obtenerSesion,
    // Un 401 no se reintenta: la respuesta no va a cambiar por insistir.
    retry: false,
    staleTime: 5 * 60 * 1000,
  });
}
