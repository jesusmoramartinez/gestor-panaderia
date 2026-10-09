import { pino } from 'pino';

import { env } from '../config/env.js';

/**
 * EL LOGGER de la API (pino).
 *
 * Escribe UNA línea JSON por evento, en la salida estándar. JSON y no texto
 * libre porque en producción los logs los lee una máquina (el panel de
 * Vercel, una búsqueda): `{"level":50,"idPedido":"…","msg":"…"}` se puede
 * filtrar por campo; "[api] algo falló" no.
 *
 * Y a la salida estándar, no a un archivo: en Vercel (y en cualquier
 * plataforma moderna) el disco de la función es descartable, y lo que se
 * escribe en stdout es lo que la plataforma junta y muestra. Es uno de los
 * principios "12-factor": la aplicación no administra sus logs, los emite.
 */
export const logger = pino({
  level: env.LOG_LEVEL ?? (env.NODE_ENV === 'test' ? 'silent' : 'info'),
  base: { servicio: 'api' },
  timestamp: pino.stdTimeFunctions.isoTime,
  /**
   * REDACCIÓN: lo que nunca tiene que llegar a un log. Un log se comparte
   * ("mirá este error"), se guarda meses y lo leen personas que no deberían
   * poder entrar al sistema. La cookie de sesión ES una sesión: quien la ve,
   * entra como esa persona.
   */
  redact: {
    paths: [
      'req.headers.cookie',
      'req.headers.authorization',
      'res.headers["set-cookie"]',
      '*.password',
      '*.passwordHash',
      '*.token',
    ],
    censor: '[oculto]',
  },
});
