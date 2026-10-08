import { EstadoSaludSchema, type EstadoSalud } from '@panaderia/shared';

/** La API no contestó: está apagada, o el proxy de Vite no la encuentra. */
export class ErrorDeRed extends Error {
  override readonly name = 'ErrorDeRed';
}

/** La API contestó, pero con una forma que el front no entiende. */
export class ErrorDeContrato extends Error {
  override readonly name = 'ErrorDeContrato';
}

export async function obtenerSalud(): Promise<EstadoSalud> {
  let respuesta: Response;

  try {
    respuesta = await fetch('/api/health');
  } catch {
    throw new ErrorDeRed('No se pudo contactar la API. ¿Está corriendo "pnpm dev"?');
  }

  // Ojo: NO cortamos si el código no es 200. El endpoint responde 503 cuando
  // la base está caída, y ese cuerpo es exactamente lo que queremos mostrar.
  const cuerpo: unknown = await respuesta.json().catch(() => null);

  // Validamos con el MISMO esquema Zod que usa el backend. Si alguien cambia
  // la forma de la respuesta y se olvida de un lado, esto falla con un
  // mensaje claro en lugar de pintar "undefined" en la pantalla.
  const resultado = EstadoSaludSchema.safeParse(cuerpo);
  if (!resultado.success) {
    throw new ErrorDeContrato(
      'La API respondió con un formato inesperado (front y back desfasados).',
    );
  }

  return resultado.data;
}
