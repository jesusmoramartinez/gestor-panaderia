// CAPA 1 — RUTAS: qué URL existe y qué la atiende. Cero lógica.
import { Router } from 'express';

import { requiereAutenticacion } from '../../middlewares/auth.js';
import { requierePermiso } from '../../middlewares/permisos.js';
import {
  getProveedor,
  getProveedores,
  getProveedoresDeInsumo,
  patchAsociacion,
  patchProveedor,
  postActivar,
  postAsociacion,
  postDesactivar,
  postProveedor,
} from './controller.js';

export const proveedoresRouter: Router = Router();

// A diferencia de los otros catálogos, VER proveedores lleva permiso: estas
// respuestas incluyen el último precio de compra. Ver permisos.ts.
const puedeVer = [requiereAutenticacion, requierePermiso('proveedor:ver')] as const;
const puedeEditar = [requiereAutenticacion, requierePermiso('proveedor:editar')] as const;

proveedoresRouter.get('/proveedores', ...puedeVer, getProveedores);
proveedoresRouter.get('/proveedores/:id', ...puedeVer, getProveedor);

proveedoresRouter.post('/proveedores', ...puedeEditar, postProveedor);
proveedoresRouter.patch('/proveedores/:id', ...puedeEditar, patchProveedor);

// Activar y desactivar son endpoints propios, no un campo del PATCH: la
// intención queda explícita en la URL y en la auditoría (DESACTIVAR).
proveedoresRouter.post('/proveedores/:id/activar', ...puedeEditar, postActivar);
proveedoresRouter.post('/proveedores/:id/desactivar', ...puedeEditar, postDesactivar);

proveedoresRouter.post('/proveedores/:id/insumos', ...puedeEditar, postAsociacion);
proveedoresRouter.patch('/proveedores/:id/insumos/:asociacionId', ...puedeEditar, patchAsociacion);

// LA VISTA ESPEJO. La misma tabla puente, leída desde la otra punta: "¿quién
// me provee este insumo?". Cuelga de /insumos y no de /proveedores porque la
// URL tiene que decir de qué habla el recurso, y acá el recurso es el insumo.
proveedoresRouter.get('/insumos/:insumoId/proveedores', ...puedeVer, getProveedoresDeInsumo);
