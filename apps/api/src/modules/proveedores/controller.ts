// CAPA 2 — CONTROLADOR: traduce entre HTTP y el servicio. Sin reglas de negocio.
import {
  ActualizarProveedorInsumoSchema,
  ActualizarProveedorSchema,
  CrearProveedorInsumoSchema,
  CrearProveedorSchema,
  FiltroProveedoresSchema,
} from '@panaderia/shared';
import type { Request, Response } from 'express';
import { z } from 'zod';

import { contextoDe } from '../../lib/contexto.js';
import { parsear } from '../../lib/validar.js';
import * as service from './service.js';

// Los parámetros de la URL también se validan: un id mal formado llegaría a
// Prisma y la base devolvería un error de sintaxis de UUID (un 500 feo).
const ParamsProveedor = z.object({ id: z.uuid('Identificador inválido') });
const ParamsAsociacion = ParamsProveedor.extend({ asociacionId: z.uuid() });
const ParamsInsumo = z.object({ insumoId: z.uuid('Identificador inválido') });

export async function getProveedores(req: Request, res: Response): Promise<void> {
  const filtro = parsear(FiltroProveedoresSchema, req.query);
  res.status(200).json(await service.listar(contextoDe(req), filtro));
}

export async function getProveedor(req: Request, res: Response): Promise<void> {
  const { id } = parsear(ParamsProveedor, req.params);
  res.status(200).json(await service.obtenerDetalle(contextoDe(req), id));
}

export async function postProveedor(req: Request, res: Response): Promise<void> {
  const entrada = parsear(CrearProveedorSchema, req.body);
  res.status(201).json(await service.crear(contextoDe(req), entrada));
}

export async function patchProveedor(req: Request, res: Response): Promise<void> {
  const { id } = parsear(ParamsProveedor, req.params);
  const entrada = parsear(ActualizarProveedorSchema, req.body);
  res.status(200).json(await service.actualizar(contextoDe(req), id, entrada));
}

export async function postActivar(req: Request, res: Response): Promise<void> {
  const { id } = parsear(ParamsProveedor, req.params);
  res.status(200).json(await service.cambiarEstado(contextoDe(req), id, true));
}

export async function postDesactivar(req: Request, res: Response): Promise<void> {
  const { id } = parsear(ParamsProveedor, req.params);
  res.status(200).json(await service.cambiarEstado(contextoDe(req), id, false));
}

export async function postAsociacion(req: Request, res: Response): Promise<void> {
  const { id } = parsear(ParamsProveedor, req.params);
  const entrada = parsear(CrearProveedorInsumoSchema, req.body);
  res.status(201).json(await service.crearAsociacion(contextoDe(req), id, entrada));
}

export async function patchAsociacion(req: Request, res: Response): Promise<void> {
  const { id, asociacionId } = parsear(ParamsAsociacion, req.params);
  const entrada = parsear(ActualizarProveedorInsumoSchema, req.body);
  res
    .status(200)
    .json(await service.actualizarAsociacion(contextoDe(req), id, asociacionId, entrada));
}

/** La vista espejo: los proveedores de un insumo, para la ficha del insumo. */
export async function getProveedoresDeInsumo(req: Request, res: Response): Promise<void> {
  const { insumoId } = parsear(ParamsInsumo, req.params);
  res.status(200).json(await service.listarDeInsumo(contextoDe(req), insumoId));
}
