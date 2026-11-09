// CAPA 2 — CONTROLADOR: traduce entre HTTP y el servicio. Sin reglas de negocio.
import type { Request, Response } from 'express';

import { contextoDe } from '../../lib/contexto.js';
import * as service from './service.js';

export async function getLoQueMeDeben(req: Request, res: Response): Promise<void> {
  res.status(200).json(await service.loQueMeDeben(contextoDe(req)));
}
