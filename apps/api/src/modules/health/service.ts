// CAPA 3 — SERVICIO: la lógica. No sabe que existe HTTP (no toca req ni res).
import {
  formatearFechaArgentina,
  NOMBRE_SISTEMA,
  VERSION,
  type EstadoSalud,
} from '@panaderia/shared';

import { describirError } from '../../lib/errores.js';
import { verificarConexion } from './repo.js';

export async function obtenerEstado(): Promise<EstadoSalud> {
  const ahora = new Date();

  const base = {
    api: 'ok',
    version: VERSION,
    sistema: NOMBRE_SISTEMA,
    // Por la red siempre viaja UTC (ISO 8601, termina en "Z").
    ahoraUtc: ahora.toISOString(),
    // Y además el mismo instante listo para mostrar en hora de Argentina.
    ahoraArgentina: formatearFechaArgentina(ahora),
  } as const;

  try {
    await verificarConexion();
    return { ...base, db: 'ok' };
  } catch (error) {
    // Un health check NO debe explotar cuando la base está caída: su trabajo
    // es justamente reportar que está caída.
    return {
      ...base,
      db: 'error',
      detalleError: describirError(error),
    };
  }
}
