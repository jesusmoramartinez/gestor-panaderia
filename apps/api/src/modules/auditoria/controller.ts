import { PaginacionSchema } from '@panaderia/shared';
import type { Request, Response } from 'express';

import { contextoDe } from '../../lib/contexto.js';
import { parsear } from '../../lib/validar.js';
import * as service from './service.js';

export async function getAuditoria(req: Request, res: Response): Promise<void> {
  const { limite } = parsear(PaginacionSchema, req.query);
  res.status(200).json(await service.listar(contextoDe(req), limite));
}
