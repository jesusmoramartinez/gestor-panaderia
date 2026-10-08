import { CrearCategoriaSchema } from '@panaderia/shared';
import type { Request, Response } from 'express';
import { z } from 'zod';

import { contextoDe } from '../../lib/contexto.js';
import { parsear } from '../../lib/validar.js';
import * as service from './service.js';

const FiltroSchema = z.object({ incluirInactivas: z.stringbool().default(false) });

export async function getCategorias(req: Request, res: Response): Promise<void> {
  const { incluirInactivas } = parsear(FiltroSchema, req.query);
  res.status(200).json(await service.listar(contextoDe(req), incluirInactivas));
}

export async function postCategoria(req: Request, res: Response): Promise<void> {
  const entrada = parsear(CrearCategoriaSchema, req.body);
  res.status(201).json(await service.crear(contextoDe(req), entrada));
}
