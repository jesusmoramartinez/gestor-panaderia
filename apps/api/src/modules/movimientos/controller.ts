// CAPA 2 — CONTROLADOR: traduce entre HTTP y el servicio. Sin reglas de negocio.
import {
  AnularMovimientoSchema,
  CargarConsumoSchema,
  CargarMermaSchema,
  CargarSaldoInicialSchema,
  FiltroHistorialSchema,
  FiltroStockSchema,
} from '@panaderia/shared';
import type { Request, Response } from 'express';
import { z } from 'zod';

import { contextoDe } from '../../lib/contexto.js';
import { parsear } from '../../lib/validar.js';
import * as service from './service.js';

const ParamsMovimiento = z.object({ id: z.uuid('Identificador inválido') });
const ParamsInsumo = z.object({ insumoId: z.uuid('Identificador inválido') });
const FiltroMotivos = z.object({ tipo: z.enum(['MERMA', 'AJUSTE', 'CONSUMO']).optional() });

export async function postSaldoInicial(req: Request, res: Response): Promise<void> {
  const entrada = parsear(CargarSaldoInicialSchema, req.body);
  res.status(201).json(await service.cargarSaldoInicial(contextoDe(req), entrada));
}

export async function postConsumo(req: Request, res: Response): Promise<void> {
  const entrada = parsear(CargarConsumoSchema, req.body);
  res.status(201).json(await service.cargarConsumo(contextoDe(req), entrada));
}

export async function postMerma(req: Request, res: Response): Promise<void> {
  const entrada = parsear(CargarMermaSchema, req.body);
  res.status(201).json(await service.cargarMerma(contextoDe(req), entrada));
}

export async function postReversa(req: Request, res: Response): Promise<void> {
  const { id } = parsear(ParamsMovimiento, req.params);
  const entrada = parsear(AnularMovimientoSchema, req.body);
  res.status(201).json(await service.anular(contextoDe(req), id, entrada));
}

export async function getStock(req: Request, res: Response): Promise<void> {
  const filtro = parsear(FiltroStockSchema, req.query);
  res.status(200).json(await service.obtenerStock(contextoDe(req), filtro));
}

export async function getHistorial(req: Request, res: Response): Promise<void> {
  const { insumoId } = parsear(ParamsInsumo, req.params);
  const filtro = parsear(FiltroHistorialSchema, req.query);
  res.status(200).json(await service.obtenerHistorial(contextoDe(req), insumoId, filtro));
}

export async function getMotivos(req: Request, res: Response): Promise<void> {
  const { tipo } = parsear(FiltroMotivos, req.query);
  res.status(200).json(await service.listarMotivos(contextoDe(req), tipo));
}
