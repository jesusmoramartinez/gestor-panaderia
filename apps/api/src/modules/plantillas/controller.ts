// CAPA 2 — CONTROLADOR: traduce entre HTTP y el servicio. Sin reglas de negocio.
import { GuardarPlantillaSchema } from '@panaderia/shared';
import type { Request, Response } from 'express';
import { z } from 'zod';

import { contextoDe } from '../../lib/contexto.js';
import { parsear } from '../../lib/validar.js';
import * as service from './service.js';

const ParamsId = z.object({ id: z.uuid('Identificador inválido') });
const FiltroPlantillas = z.object({ incluirInactivas: z.stringbool().default(false) });

export async function getPlantillas(req: Request, res: Response): Promise<void> {
  const { incluirInactivas } = parsear(FiltroPlantillas, req.query);
  res.status(200).json(await service.listar(contextoDe(req), incluirInactivas));
}

export async function getPlantilla(req: Request, res: Response): Promise<void> {
  const { id } = parsear(ParamsId, req.params);
  res.status(200).json(await service.obtener(contextoDe(req), id));
}

export async function postPlantilla(req: Request, res: Response): Promise<void> {
  const entrada = parsear(GuardarPlantillaSchema, req.body);
  res.status(201).json(await service.crear(contextoDe(req), entrada));
}

export async function putPlantilla(req: Request, res: Response): Promise<void> {
  const { id } = parsear(ParamsId, req.params);
  const entrada = parsear(GuardarPlantillaSchema, req.body);
  res.status(200).json(await service.actualizar(contextoDe(req), id, entrada));
}

export async function postActivar(req: Request, res: Response): Promise<void> {
  const { id } = parsear(ParamsId, req.params);
  res.status(200).json(await service.cambiarEstado(contextoDe(req), id, true));
}

export async function postDesactivar(req: Request, res: Response): Promise<void> {
  const { id } = parsear(ParamsId, req.params);
  res.status(200).json(await service.cambiarEstado(contextoDe(req), id, false));
}
