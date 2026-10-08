// CAPA 1 — RUTAS: qué URL existe y qué la atiende. Cero lógica.
import { Router } from 'express';

import { requiereAutenticacion } from '../../middlewares/auth.js';
import { getMe, postLogin, postLogout } from './controller.js';

export const authRouter: Router = Router();

// Pública: es justamente la puerta de entrada.
authRouter.post('/auth/login', postLogin);

// Protegidas: sin sesión válida no se llega al controlador.
authRouter.post('/auth/logout', requiereAutenticacion, postLogout);
authRouter.get('/auth/me', requiereAutenticacion, getMe);
