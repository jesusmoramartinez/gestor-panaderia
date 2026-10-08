import { z } from 'zod';

/**
 * El contrato del endpoint GET /api/health.
 *
 * Este esquema es la razón de ser del paquete compartido: la API lo usa para
 * tipar lo que responde y el frontend lo usa para VALIDAR lo que recibe.
 * Si mañana se le cambia un campo, TypeScript marca el error en los dos lados
 * en el mismo commit.
 */
export const EstadoServicioSchema = z.enum(['ok', 'error']);
export type EstadoServicio = z.infer<typeof EstadoServicioSchema>;

export const EstadoSaludSchema = z.object({
  /** ¿El servidor HTTP responde? Si llegaste a leer esto, sí. */
  api: EstadoServicioSchema,
  /** ¿La API pudo hablar con PostgreSQL? */
  db: EstadoServicioSchema,
  /** Versión del contrato compartido, para detectar front y back desfasados. */
  version: z.string(),
  sistema: z.string(),
  /** Instante en UTC, formato ISO 8601. Es lo que viaja por la red. */
  ahoraUtc: z.string(),
  /** El mismo instante ya formateado en hora de Argentina, para mostrar. */
  ahoraArgentina: z.string(),
  /** Solo viene cuando db === 'error'. */
  detalleError: z.string().optional(),
});

// z.infer DERIVA el tipo de TypeScript a partir del esquema: se escribe una
// sola vez. Si agregás un campo al esquema, el tipo se actualiza solo.
export type EstadoSalud = z.infer<typeof EstadoSaludSchema>;
