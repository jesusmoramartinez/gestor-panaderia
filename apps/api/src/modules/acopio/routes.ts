// CAPA 1 — RUTAS: qué URL existe y qué la atiende. Cero lógica.
import { Router } from 'express';

import { requiereAutenticacion } from '../../middlewares/auth.js';
import { requierePermiso } from '../../middlewares/permisos.js';
import { getHistorial, getLoQueMeDeben, postNota } from './controller.js';

export const acopioRouter: Router = Router();

// Lleva el permiso de ver compras: son precios y plata.
acopioRouter.get(
  '/acopio/me-deben',
  requiereAutenticacion,
  requierePermiso('compra:ver'),
  getLoQueMeDeben,
);

// El historial de una compra: quien ve compras. Una nota la puede dejar
// quien registra entregas (el dueño, y el encargado si algún día lo hay).
acopioRouter.get(
  '/ordenes-compra/:id/historial',
  requiereAutenticacion,
  requierePermiso('compra:ver'),
  getHistorial,
);
acopioRouter.post(
  '/ordenes-compra/:id/notas',
  requiereAutenticacion,
  requierePermiso('compra:recibir'),
  postNota,
);
