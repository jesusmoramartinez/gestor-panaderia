import { Router } from 'express';

import { requiereAutenticacion } from '../../middlewares/auth.js';
import { requierePermiso } from '../../middlewares/permisos.js';
import { getUsuarios, postUsuario } from './controller.js';

export const usuariosRouter: Router = Router();

// El orden importa: primero hay que saber QUIÉN es (autenticación), después
// si PUEDE (permiso).
usuariosRouter.get('/usuarios', requiereAutenticacion, requierePermiso('usuario:ver'), getUsuarios);

usuariosRouter.post(
  '/usuarios',
  requiereAutenticacion,
  requierePermiso('usuario:crear'),
  postUsuario,
);
