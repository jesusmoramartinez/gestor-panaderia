// CAPA 1 — RUTAS: qué URL existe y qué la atiende. Cero lógica.
import { Router } from 'express';

import { requiereAutenticacion } from '../../middlewares/auth.js';
import { requierePermiso } from '../../middlewares/permisos.js';
import { getReportes } from './controller.js';

export const reportesRouter: Router = Router();

// Son precios y plata: quien ve las compras.
reportesRouter.get('/reportes', requiereAutenticacion, requierePermiso('compra:ver'), getReportes);
