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

  // === Producción (Fase 11). Todas tienen un valor por defecto que sirve en
  // desarrollo: en tu máquina no hace falta tocar ninguna. ===

  /**
   * Cuánto detalle escriben los logs. Vacío = 'info', salvo en los tests
   * ('silent': si no, cada test llenaría la consola de JSON).
   */
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).optional(),

  /**
   * Cuántas conexiones a la base abre CADA proceso de la API.
   *
   * En un servidor propio, 10 está bien. En Vercel cada función es un proceso
   * aparte y puede haber decenas a la vez: con 10 cada una se agotan las
   * conexiones de Supabase. Ahí va 1 (y la conexión, por el pooler).
   */
  DB_POOL_MAX: z.coerce.number().int().min(1).max(50).default(10),

  /**
   * Si la API está detrás de un proxy (Vercel, un balanceador): la IP real
   * del usuario viene en la cabecera X-Forwarded-For y hay que creerle al
   * proxy. Sin esto, todos los pedidos parecen venir de la IP del proxy, y el
   * limitador de intentos bloquearía a TODOS los usuarios juntos.
   *
   * Solo se activa detrás de un proxy de confianza: si no, cualquiera podría
   * mandar un X-Forwarded-For falso y esquivar el limitador.
   */
  TRUST_PROXY: z.stringbool().default(false),

  /**
   * Pedidos por minuto que acepta la API desde una misma IP. 0 = sin límite
   * (los tests de integración disparan cientos de pedidos por minuto).
   */
  LIMITE_PEDIDOS_POR_MINUTO: z.coerce.number().int().min(0).default(600),
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
