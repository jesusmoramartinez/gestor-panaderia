// CAPA 1 — RUTAS: qué URL existe y qué la atiende. Cero lógica.
import { Router } from 'express';

import { requiereAutenticacion } from '../../middlewares/auth.js';
import { requierePermiso } from '../../middlewares/permisos.js';
import {
  getComprobante,
  postAnularPago,
  postComprobantesDePago,
  postComprobantesDeRecepcion,
  postPago,
} from './controller.js';

export const pagosRouter: Router = Router();

// Pagar es plata que sale: solo el dueño (compra:pagar). Anular, como anular
// una recepción: compra:anular.
pagosRouter.post(
  '/ordenes-compra/:id/pagos',
  requiereAutenticacion,
  requierePermiso('compra:pagar'),
  postPago,
);
pagosRouter.post(
  '/pagos/:id/anular',
  requiereAutenticacion,
  requierePermiso('compra:anular'),
  postAnularPago,
);
pagosRouter.post(
  '/pagos/:id/comprobantes',
  requiereAutenticacion,
  requierePermiso('compra:pagar'),
  postComprobantesDePago,
);
// La foto del remito la puede agregar quien registra entregas.
pagosRouter.post(
  '/recepciones/:id/comprobantes',
  requiereAutenticacion,
  requierePermiso('compra:recibir'),
  postComprobantesDeRecepcion,
);
// Ver un comprobante: quien ve las compras.
pagosRouter.get(
  '/comprobantes/:id',
  requiereAutenticacion,
  requierePermiso('compra:ver'),
  getComprobante,
);
