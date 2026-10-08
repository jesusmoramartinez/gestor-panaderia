import type { FieldValues, UseFormSetError } from 'react-hook-form';

import { detallesPorCampo, ErrorDeApi } from './api';

/**
 * Pasa los errores por campo que devolvió la API al formulario.
 *
 * El backend valida con el mismo esquema Zod que el front, pero tiene reglas
 * que el front no puede conocer: si el nombre ya existe, si la categoría es de
 * otra empresa. Esos errores llegan en `detalles` como {campo: mensaje}, y acá
 * se los damos a React Hook Form para que marque el input exacto.
 *
 * Devuelve el mensaje general cuando el error no es de un campo puntual (un
 * 409 de nombre duplicado, un 403, la API caída), para mostrarlo arriba.
 */
export function aplicarErroresDelServidor<T extends FieldValues>(
  error: unknown,
  setError: UseFormSetError<T>,
): string | null {
  const porCampo = detallesPorCampo(error);
  const campos = Object.entries(porCampo);

  for (const [campo, mensaje] of campos) {
    // El cast es necesario: los nombres de campo vienen del servidor como
    // texto y TypeScript no puede verificar que correspondan al formulario.
    setError(campo as Parameters<UseFormSetError<T>>[0], { message: mensaje });
  }

  if (campos.length > 0) return null;
  if (error instanceof ErrorDeApi) return error.mensaje;
  return 'No se pudo completar la operación. Probá de nuevo.';
}
