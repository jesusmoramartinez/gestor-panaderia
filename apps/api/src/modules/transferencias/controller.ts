// CAPA 2 — CONTROLADOR: traduce entre HTTP y el servicio. Sin reglas de negocio.
import {
  AnularTransferenciaSchema,
  EnviarTransferenciaSchema,
  FiltroTransferenciasSchema,
  RecibirTransferenciaSchema,
} from '@panaderia/shared';
import type { Request, Response } from 'express';
import { z } from 'zod';

import { contextoDe } from '../../lib/contexto.js';
import { parsear } from '../../lib/validar.js';
import * as service from './service.js';

const ParamsId = z.object({ id: z.uuid('Identificador inválido') });

export async function getTransferencias(req: Request, res: Response): Promise<void> {
  const filtro = parsear(FiltroTransferenciasSchema, req.query);
  res.status(200).json(await service.listar(contextoDe(req), filtro));
}

export async function getTransferencia(req: Request, res: Response): Promise<void> {
  const { id } = parsear(ParamsId, req.params);
  res.status(200).json(await service.obtener(contextoDe(req), id));
}

export async function postTransferencia(req: Request, res: Response): Promise<void> {
  const entrada = parsear(EnviarTransferenciaSchema, req.body);
  res.status(201).json(await service.enviar(contextoDe(req), entrada));
}

export async function postRecibir(req: Request, res: Response): Promise<void> {
  const { id } = parsear(ParamsId, req.params);
  const entrada = parsear(RecibirTransferenciaSchema, req.body);
  res.status(200).json(await service.recibir(contextoDe(req), id, entrada));
}

export async function postAnular(req: Request, res: Response): Promise<void> {
  const { id } = parsear(ParamsId, req.params);
  const entrada = parsear(AnularTransferenciaSchema, req.body);
  res.status(200).json(await service.anular(contextoDe(req), id, entrada));
}
