import { Router } from 'express';

import { requiereAutenticacion } from '../../middlewares/auth.js';
import { getUnidades } from './controller.js';

export const unidadesRouter: Router = Router();

// Sin permiso especial: cualquiera que cargue stock necesita el catálogo de
// unidades para elegir en qué unidad está cargando. Lo que sí hace falta es
// estar autenticado, porque el catálogo es de una empresa.
unidadesRouter.get('/unidades', requiereAutenticacion, getUnidades);
