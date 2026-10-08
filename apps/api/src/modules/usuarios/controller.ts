import { CrearUsuarioSchema } from '@panaderia/shared';
import type { Request, Response } from 'express';

import { contextoDe } from '../../lib/contexto.js';
import { parsear } from '../../lib/validar.js';
import * as service from './service.js';

export async function getUsuarios(req: Request, res: Response): Promise<void> {
  res.status(200).json(await service.listar(contextoDe(req)));
}

export async function postUsuario(req: Request, res: Response): Promise<void> {
  const entrada = parsear(CrearUsuarioSchema, req.body);
  const creado = await service.crear(contextoDe(req), entrada);
  res.status(201).json(creado);
}
