// CAPA 2 — CONTROLADOR: traduce entre HTTP y el servicio. Sin reglas de negocio.
import { FiltroReportesSchema } from '@panaderia/shared';
import type { Request, Response } from 'express';

import { contextoDe } from '../../lib/contexto.js';
import { parsear } from '../../lib/validar.js';
import * as service from './service.js';

export async function getReportes(req: Request, res: Response): Promise<void> {
  const filtro = parsear(FiltroReportesSchema, req.query);
  res.status(200).json(await service.reportes(contextoDe(req), filtro));
}
