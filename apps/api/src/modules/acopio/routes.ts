// CAPA 1 — RUTAS: qué URL existe y qué la atiende. Cero lógica.
import { Router } from 'express';

import { requiereAutenticacion } from '../../middlewares/auth.js';
import { requierePermiso } from '../../middlewares/permisos.js';
import { getLoQueMeDeben } from './controller.js';

export const acopioRouter: Router = Router();

// Lleva el permiso de ver compras: son precios y plata.
acopioRouter.get(
  '/acopio/me-deben',
  requiereAutenticacion,
  requierePermiso('compra:ver'),
  getLoQueMeDeben,
);
