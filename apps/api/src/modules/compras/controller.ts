// CAPA 2 — CONTROLADOR: traduce entre HTTP y el servicio. Sin reglas de negocio.
import {
  AnularRecepcionSchema,
  CerrarOrdenSchema,
  CrearOrdenSchema,
  EditarOrdenSchema,
  FiltroOrdenesSchema,
  FiltroRecepcionesSchema,
  RecepcionDeOrdenSchema,
  RecepcionDirectaSchema,
} from '@panaderia/shared';
import type { Request, Response } from 'express';
import { z } from 'zod';

import { contextoDe } from '../../lib/contexto.js';
import { parsear } from '../../lib/validar.js';
import * as service from './service.js';

const ParamsId = z.object({ id: z.uuid('Identificador inválido') });
const ParamsInsumo = z.object({ insumoId: z.uuid('Identificador inválido') });

// --- Órdenes ---------------------------------------------------------------

export async function getOrdenes(req: Request, res: Response): Promise<void> {
  const filtro = parsear(FiltroOrdenesSchema, req.query);
  res.status(200).json(await service.listarOrdenes(contextoDe(req), filtro));
}

export async function getOrden(req: Request, res: Response): Promise<void> {
  const { id } = parsear(ParamsId, req.params);
  res.status(200).json(await service.obtenerOrden(contextoDe(req), id));
}

export async function postOrden(req: Request, res: Response): Promise<void> {
  const entrada = parsear(CrearOrdenSchema, req.body);
  res.status(201).json(await service.crearOrden(contextoDe(req), entrada));
}

export async function putOrden(req: Request, res: Response): Promise<void> {
  const { id } = parsear(ParamsId, req.params);
  const entrada = parsear(EditarOrdenSchema, req.body);
  res.status(200).json(await service.editarOrden(contextoDe(req), id, entrada));
}

export async function postPedir(req: Request, res: Response): Promise<void> {
  const { id } = parsear(ParamsId, req.params);
  res.status(200).json(await service.pedirOrden(contextoDe(req), id));
}

export async function postCancelar(req: Request, res: Response): Promise<void> {
  const { id } = parsear(ParamsId, req.params);
  const entrada = parsear(CerrarOrdenSchema, req.body ?? {});
  res.status(200).json(await service.cancelarOrden(contextoDe(req), id, entrada));
}

export async function postCerrar(req: Request, res: Response): Promise<void> {
  const { id } = parsear(ParamsId, req.params);
  const entrada = parsear(CerrarOrdenSchema, req.body ?? {});
  res.status(200).json(await service.cerrarOrden(contextoDe(req), id, entrada));
}

// --- Recepciones -----------------------------------------------------------

export async function getRecepciones(req: Request, res: Response): Promise<void> {
  const filtro = parsear(FiltroRecepcionesSchema, req.query);
  res.status(200).json(await service.listarRecepciones(contextoDe(req), filtro));
}

export async function getRecepcion(req: Request, res: Response): Promise<void> {
  const { id } = parsear(ParamsId, req.params);
  res.status(200).json(await service.obtenerRecepcion(contextoDe(req), id));
}

export async function postRecepcionDirecta(req: Request, res: Response): Promise<void> {
  const entrada = parsear(RecepcionDirectaSchema, req.body);
  res.status(201).json(await service.recibirDirecta(contextoDe(req), entrada));
}

export async function postRecepcionDeOrden(req: Request, res: Response): Promise<void> {
  const { id } = parsear(ParamsId, req.params);
  const entrada = parsear(RecepcionDeOrdenSchema, req.body);
  res.status(201).json(await service.recibirDeOrden(contextoDe(req), id, entrada));
}

export async function postAnularRecepcion(req: Request, res: Response): Promise<void> {
  const { id } = parsear(ParamsId, req.params);
  const entrada = parsear(AnularRecepcionSchema, req.body);
  res.status(200).json(await service.anularRecepcion(contextoDe(req), id, entrada));
}

export async function getCostoInsumo(req: Request, res: Response): Promise<void> {
  const { insumoId } = parsear(ParamsInsumo, req.params);
  res.status(200).json(await service.costoDeInsumo(contextoDe(req), insumoId));
}
