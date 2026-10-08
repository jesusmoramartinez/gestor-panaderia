import { ErrorApiSchema } from '@panaderia/shared';
import type { z } from 'zod';

/** La API respondió con un error que ELLA generó a propósito (401, 403, 409...). */
export class ErrorDeApi extends Error {
  override readonly name = 'ErrorDeApi';

  constructor(
    readonly status: number,
    readonly codigo: string,
    readonly mensaje: string,
    readonly detalles: unknown,
  ) {
    super(mensaje);
  }
}

/** La API no contestó: está apagada, o el proxy de Vite no la encuentra. */
export class ErrorDeRed extends Error {
  override readonly name = 'ErrorDeRed';
}

/** La API contestó, pero con una forma que el front no entiende. */
export class ErrorDeContrato extends Error {
  override readonly name = 'ErrorDeContrato';
}

type Opciones<S extends z.ZodType> = {
  metodo?: 'GET' | 'POST';
  cuerpo?: unknown;
  /** Con qué esquema validar la respuesta. Es obligatorio a propósito. */
  esquema: S;
};

/**
 * Único punto por el que el frontend habla con la API.
 *
 * Tres cosas que hace y conviene notar:
 *
 * 1. Las rutas son RELATIVAS ('/api/...'). En desarrollo el proxy de Vite las
 *    reenvía al puerto 3000; en producción front y API comparten dominio. El
 *    código es el mismo en los dos casos.
 *
 * 2. No configura `credentials`: el valor por defecto de fetch ya manda las
 *    cookies cuando el pedido es al mismo origen, y gracias al proxy todo es
 *    el mismo origen. La cookie de sesión viaja sola.
 *
 * 3. VALIDA la respuesta con el mismo esquema Zod que usa el backend. Si
 *    alguien cambia la forma de un endpoint y se olvida de un lado, el error
 *    aparece acá con un mensaje claro en lugar de un `undefined` tres
 *    componentes más abajo.
 */
export async function pedirApi<S extends z.ZodType>(
  ruta: string,
  opciones: Opciones<S>,
): Promise<z.infer<S>> {
  let respuesta: Response;
  try {
    respuesta = await fetch(ruta, {
      method: opciones.metodo ?? 'GET',
      headers: opciones.cuerpo === undefined ? undefined : { 'content-type': 'application/json' },
      body: opciones.cuerpo === undefined ? undefined : JSON.stringify(opciones.cuerpo),
    });
  } catch {
    throw new ErrorDeRed('No se pudo contactar la API. ¿Está corriendo "pnpm dev"?');
  }

  const texto = await respuesta.text();
  let cuerpo: unknown = null;
  if (texto.length > 0) {
    try {
      cuerpo = JSON.parse(texto);
    } catch {
      throw new ErrorDeContrato('La API respondió algo que no es JSON.');
    }
  }

  if (!respuesta.ok) {
    const error = ErrorApiSchema.safeParse(cuerpo);
    if (error.success) {
      throw new ErrorDeApi(
        respuesta.status,
        error.data.codigo,
        error.data.mensaje,
        error.data.detalles,
      );
    }
    throw new ErrorDeApi(
      respuesta.status,
      'ERROR_DESCONOCIDO',
      'La API respondió con un error que no pude interpretar.',
      null,
    );
  }

  const validado = opciones.esquema.safeParse(cuerpo);
  if (!validado.success) {
    throw new ErrorDeContrato(
      'La API respondió con un formato inesperado (front y back desfasados).',
    );
  }
  return validado.data;
}

/**
 * Saca del error los mensajes por campo, para marcar los inputs en rojo.
 * Devuelve un objeto vacío si el error no trae detalles por campo.
 */
export function detallesPorCampo(error: unknown): Record<string, string> {
  if (!(error instanceof ErrorDeApi)) return {};
  const detalles = error.detalles;
  if (typeof detalles !== 'object' || detalles === null) return {};

  const salida: Record<string, string> = {};
  for (const [campo, mensaje] of Object.entries(detalles)) {
    if (typeof mensaje === 'string') salida[campo] = mensaje;
  }
  return salida;
}
