import { Router } from 'express';

import { requiereAutenticacion } from '../../middlewares/auth.js';
import { requierePermiso } from '../../middlewares/permisos.js';
import { getCategorias, postCategoria } from './controller.js';

export const categoriasRouter: Router = Router();

// Ver el catálogo no lleva permiso: lo necesita cualquiera que cargue stock.
categoriasRouter.get('/categorias', requiereAutenticacion, getCategorias);

categoriasRouter.post(
  '/categorias',
  requiereAutenticacion,
  requierePermiso('insumo:editar'),
  postCategoria,
);
