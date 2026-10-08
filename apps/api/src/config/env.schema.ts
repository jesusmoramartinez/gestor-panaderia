import { z } from 'zod';

/**
 * Esquema de las variables de entorno que la API necesita para arrancar.
 *
 * ¿Por qué validar esto? Porque sin validación, un DATABASE_URL mal escrito
 * no da error al arrancar: el servidor levanta igual y falla recién cuando
 * alguien usa una pantalla, con un mensaje incomprensible. Validando acá,
 * el proceso NO arranca y te dice exactamente qué variable está mal.
 *
 * Este archivo es a propósito PURO (no lee process.env, no imprime, no
 * termina el proceso): solo transforma datos. Por eso se puede testear.
 * El efecto de verdad está en env.ts.
 */
export const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),

  // En process.env TODO es texto: PORT llega como "3000", no como 3000.
  // z.coerce.number() lo convierte antes de validar.
  PORT: z.coerce.number().int().positive().max(65535).default(3000),

  DATABASE_URL: z
    .string()
    .min(1)
    .refine(
      (valor) => valor.startsWith('postgresql://') || valor.startsWith('postgres://'),
      'debe ser una cadena de conexión de PostgreSQL (postgresql://usuario:clave@host:puerto/base)',
    ),
});

// El tipo se DERIVA del esquema: una sola fuente de verdad.
export type Env = z.infer<typeof EnvSchema>;

export class EnvInvalidoError extends Error {
  override readonly name = 'EnvInvalidoError';
}

export function validarEnv(crudo: Record<string, string | undefined>): Env {
  // safeParse no lanza: devuelve { success: true, data } o { success: false, error }.
  const resultado = EnvSchema.safeParse(crudo);

  if (!resultado.success) {
    const detalle = resultado.error.issues
      .map((problema) => `  - ${problema.path.join('.') || '(raíz)'}: ${problema.message}`)
      .join('\n');
    throw new EnvInvalidoError(
      `Variables de entorno inválidas:\n${detalle}\n\n` +
        'Revisá el archivo .env en la raíz del repositorio (podés copiar .env.example).',
    );
  }

  return resultado.data;
}
