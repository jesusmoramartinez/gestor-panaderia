// CAPA 2 — CONTROLADOR: traduce entre HTTP y el servicio. Sin reglas de negocio.
import { AgregarNotaSchema } from '@panaderia/shared';
import type { Request, Response } from 'express';
import { z } from 'zod';

import { contextoDe } from '../../lib/contexto.js';
import { parsear } from '../../lib/validar.js';
import * as historial from './historial.js';
import * as service from './service.js';

export async function getLoQueMeDeben(req: Request, res: Response): Promise<void> {
  res.status(200).json(await service.loQueMeDeben(contextoDe(req)));
}

const ParamsId = z.object({ id: z.uuid('Identificador inválido') });

export async function getHistorial(req: Request, res: Response): Promise<void> {
  const { id } = parsear(ParamsId, req.params);
  res.status(200).json(await historial.historialDeCompra(contextoDe(req), id));
}

export async function postNota(req: Request, res: Response): Promise<void> {
  const { id } = parsear(ParamsId, req.params);
  const entrada = parsear(AgregarNotaSchema, req.body);
  res.status(201).json(await historial.agregarNota(contextoDe(req), id, entrada));
}
