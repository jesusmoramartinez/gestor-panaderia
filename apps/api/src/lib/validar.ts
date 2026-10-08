import type { z } from 'zod';

import { errores } from './errores.js';

/**
 * Valida un valor desconocido contra un esquema Zod y devuelve el dato tipado.
 *
 * Es el único lugar donde entra información del exterior al sistema. Los
 * controladores llaman a esto ANTES de pasarle nada a un servicio: de ahí para
 * adentro, los tipos de TypeScript son verdad garantizada y no suposiciones.
 */
export function parsear<S extends z.ZodType>(esquema: S, valor: unknown): z.infer<S> {
  const resultado = esquema.safeParse(valor);
  if (!resultado.success) {
    throw errores.datosInvalidos(porCampo(resultado.error));
  }
  return resultado.data;
}

/**
 * Convierte los errores de Zod en un objeto campo → mensaje, que es lo que el
 * formulario del frontend necesita para marcar el campo exacto en rojo.
 */
function porCampo(error: z.ZodError): Record<string, string> {
  const salida: Record<string, string> = {};
  for (const problema of error.issues) {
    const campo = problema.path.join('.') || '(raíz)';
    salida[campo] ??= problema.message;
  }
  return salida;
}
