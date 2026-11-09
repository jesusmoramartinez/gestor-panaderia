// CAPA 2 — CONTROLADOR: traduce entre HTTP y el servicio. Sin reglas de negocio.
import {
  AgregarComprobantesSchema,
  AnularPagoSchema,
  RegistrarPagoSchema,
} from '@panaderia/shared';
import type { Request, Response } from 'express';
import { z } from 'zod';

import { contextoDe } from '../../lib/contexto.js';
import { parsear } from '../../lib/validar.js';
import * as service from './service.js';

const ParamsId = z.object({ id: z.uuid('Identificador inválido') });

export async function postPago(req: Request, res: Response): Promise<void> {
  const { id } = parsear(ParamsId, req.params);
  const entrada = parsear(RegistrarPagoSchema, req.body);
  res.status(201).json(await service.registrarPago(contextoDe(req), id, entrada));
}

export async function postAnularPago(req: Request, res: Response): Promise<void> {
  const { id } = parsear(ParamsId, req.params);
  const entrada = parsear(AnularPagoSchema, req.body);
  res.status(200).json(await service.anularPago(contextoDe(req), id, entrada));
}

export async function postComprobantesDePago(req: Request, res: Response): Promise<void> {
  const { id } = parsear(ParamsId, req.params);
  const entrada = parsear(AgregarComprobantesSchema, req.body);
  res.status(201).json(await service.agregarComprobantesAPago(contextoDe(req), id, entrada));
}

export async function postComprobantesDeRecepcion(req: Request, res: Response): Promise<void> {
  const { id } = parsear(ParamsId, req.params);
  const entrada = parsear(AgregarComprobantesSchema, req.body);
  res.status(201).json(await service.agregarComprobantesARecepcion(contextoDe(req), id, entrada));
}

/**
 * La imagen de un comprobante, tal cual.
 *
 * - Content-Type: el que salió de mirar sus bytes al guardarla, nunca uno que
 *   mandó alguien. Con `nosniff` (helmet), el navegador no lo "adivina".
 * - Cache privada y larga: un comprobante nunca cambia, y es de esta sesión
 *   (no lo guarda ningún intermediario).
 */
export async function getComprobante(req: Request, res: Response): Promise<void> {
  const { id } = parsear(ParamsId, req.params);
  const { tipo, datos } = await service.obtenerComprobante(contextoDe(req), id);
  res.setHeader('Content-Type', tipo);
  res.setHeader('Cache-Control', 'private, max-age=31536000, immutable');
  res.setHeader('Content-Disposition', `inline; filename="comprobante-${id}"`);
  res.status(200).send(Buffer.from(datos));
}
