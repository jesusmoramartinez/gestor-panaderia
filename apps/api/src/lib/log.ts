import { pino } from 'pino';

import { env } from '../config/env.js';

/**
 * EL LOGGER de la API (pino).
 *
 * Escribe UNA línea JSON por evento, en la salida estándar. JSON y no texto
 * libre porque en producción los logs los lee una máquina (`docker compose
 * logs` filtrado, una búsqueda): `{"level":50,"idPedido":"…","msg":"…"}` se puede
 * filtrar por campo; "[api] algo falló" no.
 *
 * Y a la salida estándar, no a un archivo: el disco de un contenedor es
 * descartable (se borra con cada deploy), y lo que se escribe en stdout es
 * lo que Docker junta y rota solo (10 MB × 3 por contenedor en el VPS). Es uno de los
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
