// CAPA 1 — RUTAS: qué URL existe y qué la atiende. Cero lógica.
import { Router } from 'express';

import { getSalud } from './controller.js';

export const healthRouter: Router = Router();

healthRouter.get('/health', getSalud);
