import type { Request, Response } from 'express';

import { contextoDe } from '../../lib/contexto.js';
import * as service from './service.js';

export async function getUnidades(req: Request, res: Response): Promise<void> {
  res.status(200).json(await service.listar(contextoDe(req)));
}
