// CAPA 2 — CONTROLADOR: traduce entre HTTP y el servicio. Sin reglas de negocio.
import {
  ActualizarInsumoSchema,
  ActualizarPresentacionSchema,
  CrearInsumoSchema,
  CrearPresentacionSchema,
  FiltroInsumosSchema,
  ParametrosSucursalSchema,
} from '@panaderia/shared';
import type { Request, Response } from 'express';
import { z } from 'zod';

import { contextoDe } from '../../lib/contexto.js';
import { parsear } from '../../lib/validar.js';
import * as service from './service.js';

/**
 * Los parámetros de la URL también se validan.
 *
 * Si no, un id mal formado llegaría a Prisma y la base devolvería un error de
 * sintaxis de UUID: un 500 feo en lugar de un 400 que explica el problema.
 */
const ParamsInsumo = z.object({ id: z.uuid('Identificador inválido') });
const ParamsPresentacion = ParamsInsumo.extend({ presentacionId: z.uuid() });
const ParamsSucursal = ParamsInsumo.extend({ sucursalId: z.uuid() });

export async function getInsumos(req: Request, res: Response): Promise<void> {
  const filtro = parsear(FiltroInsumosSchema, req.query);
  res.status(200).json(await service.listar(contextoDe(req), filtro));
}

export async function getInsumo(req: Request, res: Response): Promise<void> {
  const { id } = parsear(ParamsInsumo, req.params);
  res.status(200).json(await service.obtenerDetalle(contextoDe(req), id));
}

export async function postInsumo(req: Request, res: Response): Promise<void> {
  const entrada = parsear(CrearInsumoSchema, req.body);
  res.status(201).json(await service.crear(contextoDe(req), entrada));
}

export async function patchInsumo(req: Request, res: Response): Promise<void> {
  const { id } = parsear(ParamsInsumo, req.params);
  const entrada = parsear(ActualizarInsumoSchema, req.body);
  res.status(200).json(await service.actualizar(contextoDe(req), id, entrada));
}

export async function postActivar(req: Request, res: Response): Promise<void> {
  const { id } = parsear(ParamsInsumo, req.params);
  res.status(200).json(await service.cambiarEstado(contextoDe(req), id, true));
}

export async function postDesactivar(req: Request, res: Response): Promise<void> {
  const { id } = parsear(ParamsInsumo, req.params);
  res.status(200).json(await service.cambiarEstado(contextoDe(req), id, false));
}

export async function postPresentacion(req: Request, res: Response): Promise<void> {
  const { id } = parsear(ParamsInsumo, req.params);
  const entrada = parsear(CrearPresentacionSchema, req.body);
  res.status(201).json(await service.crearPresentacion(contextoDe(req), id, entrada));
}

export async function patchPresentacion(req: Request, res: Response): Promise<void> {
  const { id, presentacionId } = parsear(ParamsPresentacion, req.params);
  const entrada = parsear(ActualizarPresentacionSchema, req.body);
  res
    .status(200)
    .json(await service.actualizarPresentacion(contextoDe(req), id, presentacionId, entrada));
}

export async function putParametrosSucursal(req: Request, res: Response): Promise<void> {
  const { id, sucursalId } = parsear(ParamsSucursal, req.params);
  const entrada = parsear(ParametrosSucursalSchema, req.body);
  res
    .status(200)
    .json(await service.definirParametrosSucursal(contextoDe(req), id, sucursalId, entrada));
}
