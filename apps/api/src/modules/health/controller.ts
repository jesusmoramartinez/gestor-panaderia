// CAPA 2 — CONTROLADOR: traduce entre HTTP y el servicio. Sin reglas de negocio.
import type { Request, Response } from 'express';

import { obtenerEstado } from './service.js';

export async function getSalud(_req: Request, res: Response): Promise<void> {
  const estado = await obtenerEstado();

  // 503 = Service Unavailable. Importa que el CÓDIGO diga la verdad y no solo
  // el cuerpo: un monitor externo (o el deploy) mira el código de estado.
  res.status(estado.db === 'ok' ? 200 : 503).json(estado);
}
