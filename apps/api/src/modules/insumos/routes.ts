// CAPA 1 — RUTAS: qué URL existe y qué la atiende. Cero lógica.
import { Router } from 'express';

import { requiereAutenticacion } from '../../middlewares/auth.js';
import { paramDeRuta, requierePermiso, requiereSucursal } from '../../middlewares/permisos.js';
import {
  getInsumo,
  getInsumos,
  patchInsumo,
  patchPresentacion,
  postActivar,
  postDesactivar,
  postInsumo,
  postPresentacion,
  putParametrosSucursal,
} from './controller.js';

export const insumosRouter: Router = Router();

// Para no repetir la pareja en cada ruta que modifica el catálogo.
const puedeEditar = [requiereAutenticacion, requierePermiso('insumo:editar')] as const;

// --- Consultas: cualquiera autenticado. Quien carga un consumo necesita el
// --- catálogo para elegir el insumo.
insumosRouter.get('/insumos', requiereAutenticacion, getInsumos);
insumosRouter.get('/insumos/:id', requiereAutenticacion, getInsumo);

// --- Modificaciones: solo dueño y encargado.
insumosRouter.post('/insumos', ...puedeEditar, postInsumo);
insumosRouter.patch('/insumos/:id', ...puedeEditar, patchInsumo);

// Activar y desactivar son endpoints propios, no un campo del PATCH: la
// intención queda explícita en la URL y en la auditoría (DESACTIVAR).
insumosRouter.post('/insumos/:id/activar', ...puedeEditar, postActivar);
insumosRouter.post('/insumos/:id/desactivar', ...puedeEditar, postDesactivar);

insumosRouter.post('/insumos/:id/presentaciones', ...puedeEditar, postPresentacion);
insumosRouter.patch(
  '/insumos/:id/presentaciones/:presentacionId',
  ...puedeEditar,
  patchPresentacion,
);

// El mínimo de una sucursal lo configura quien puede operar EN esa sucursal:
// un encargado de Laferrere no define el mínimo de la Central. Este es el
// primer consumidor real de requiereSucursal, escrito en la Fase 2.
insumosRouter.put(
  '/insumos/:id/sucursales/:sucursalId',
  ...puedeEditar,
  requiereSucursal(paramDeRuta('sucursalId')),
  putParametrosSucursal,
);
