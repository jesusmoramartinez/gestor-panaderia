// CAPA 1 — RUTAS: qué URL existe y qué la atiende. Cero lógica.
import { Router } from 'express';

import { requiereAutenticacion } from '../../middlewares/auth.js';
import {
  getMe,
  postCambiarEmail,
  postCambiarPassword,
  postLogin,
  postLogout,
} from './controller.js';

export const authRouter: Router = Router();

// Pública: es justamente la puerta de entrada.
authRouter.post('/auth/login', postLogin);

// Protegidas: sin sesión válida no se llega al controlador.
authRouter.post('/auth/logout', requiereAutenticacion, postLogout);
authRouter.get('/auth/me', requiereAutenticacion, getMe);

// Mi cuenta: cualquiera logueado cambia lo SUYO (no hace falta permiso:
// el usuario sale de la sesión, nunca del cuerpo del pedido).
authRouter.post('/auth/password', requiereAutenticacion, postCambiarPassword);
authRouter.post('/auth/email', requiereAutenticacion, postCambiarEmail);
