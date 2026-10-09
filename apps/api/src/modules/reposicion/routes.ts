// CAPA 1 y 2 — RUTAS y CONTROLADOR. Dos consultas sin cuerpo: no justifican
// un controller aparte.
import { FiltroReposicionSchema } from '@panaderia/shared';
import { type Request, type Response, Router } from 'express';
import { z } from 'zod';

import { contextoDe } from '../../lib/contexto.js';
import { parsear } from '../../lib/validar.js';
import { requiereAutenticacion } from '../../middlewares/auth.js';
import { campoDeQuery, requierePermiso, requiereSucursal } from '../../middlewares/permisos.js';
import * as service from './service.js';

export const reposicionRouter: Router = Router();

const FiltroAlertas = z.object({ sucursalId: z.uuid('Hay que elegir una sucursal') });

/**
 * La reposición lleva `compra:ver`: tiene precios y proveedores. El número de
 * alertas no: son cantidades, y el empleado también tiene que verlo.
 */
reposicionRouter.get(
  '/reposicion',
  requiereAutenticacion,
  requierePermiso('compra:ver'),
  async (req: Request, res: Response) => {
    const filtro = parsear(FiltroReposicionSchema, req.query);
    res.status(200).json(await service.obtener(contextoDe(req), filtro));
  },
);

reposicionRouter.get(
  '/alertas',
  requiereAutenticacion,
  requiereSucursal(campoDeQuery('sucursalId')),
  async (req: Request, res: Response) => {
    const { sucursalId } = parsear(FiltroAlertas, req.query);
    res.status(200).json(await service.resumenAlertas(contextoDe(req), sucursalId));
  },
);
