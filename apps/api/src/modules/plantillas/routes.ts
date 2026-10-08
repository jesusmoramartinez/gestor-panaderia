// CAPA 1 — RUTAS: qué URL existe y qué la atiende. Cero lógica.
import { Router } from 'express';

import { requiereAutenticacion } from '../../middlewares/auth.js';
import { campoDeCuerpo, requierePermiso, requiereSucursal } from '../../middlewares/permisos.js';
import {
  getPlantilla,
  getPlantillas,
  postActivar,
  postDesactivar,
  postPlantilla,
  putPlantilla,
} from './controller.js';

export const plantillasRouter: Router = Router();

// Ver, como el resto de compras. Administrarlas es parte de PEDIR: solo el dueño.
const puedeVer = [requiereAutenticacion, requierePermiso('compra:ver')] as const;
const puedePedir = [requiereAutenticacion, requierePermiso('compra:pedir')] as const;
const enSucursalDelCuerpo = requiereSucursal(campoDeCuerpo('sucursalId'));

plantillasRouter.get('/plantillas-pedido', ...puedeVer, getPlantillas);
plantillasRouter.get('/plantillas-pedido/:id', ...puedeVer, getPlantilla);
plantillasRouter.post('/plantillas-pedido', ...puedePedir, enSucursalDelCuerpo, postPlantilla);
plantillasRouter.put('/plantillas-pedido/:id', ...puedePedir, enSucursalDelCuerpo, putPlantilla);
plantillasRouter.post('/plantillas-pedido/:id/activar', ...puedePedir, postActivar);
plantillasRouter.post('/plantillas-pedido/:id/desactivar', ...puedePedir, postDesactivar);
