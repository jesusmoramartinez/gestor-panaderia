// CAPA 1 — RUTAS: qué URL existe y qué la atiende. Cero lógica.
import { Router } from 'express';

import { requiereAutenticacion } from '../../middlewares/auth.js';
import { campoDeCuerpo, requierePermiso, requiereSucursal } from '../../middlewares/permisos.js';
import {
  getCostoInsumo,
  getOrden,
  getOrdenes,
  getRecepcion,
  getRecepciones,
  postAnularRecepcion,
  postCancelar,
  postCerrar,
  postOrden,
  postPedir,
  postRecepcionDeOrden,
  postRecepcionDirecta,
  putOrden,
} from './controller.js';

export const comprasRouter: Router = Router();

// Ver lleva permiso: órdenes y recepciones tienen precios.
const puedeVer = [requiereAutenticacion, requierePermiso('compra:ver')] as const;
// Pedir es solo del dueño (C-13); recibir, también del encargado.
const puedePedir = [requiereAutenticacion, requierePermiso('compra:pedir')] as const;
const puedeRecibir = [requiereAutenticacion, requierePermiso('compra:recibir')] as const;
const enSucursalDelCuerpo = requiereSucursal(campoDeCuerpo('sucursalId'));

// --- Órdenes de compra.
comprasRouter.get('/ordenes-compra', ...puedeVer, getOrdenes);
comprasRouter.get('/ordenes-compra/:id', ...puedeVer, getOrden);
comprasRouter.post('/ordenes-compra', ...puedePedir, enSucursalDelCuerpo, postOrden);
comprasRouter.put('/ordenes-compra/:id', ...puedePedir, enSucursalDelCuerpo, putOrden);

// Las transiciones son endpoints propios, igual que activar/desactivar: la
// intención queda en la URL ("cerrar") y no escondida en un PATCH del estado.
// Un PATCH { estado: 'RECIBIDA' } permitiría saltarse la máquina de estados.
comprasRouter.post('/ordenes-compra/:id/pedir', ...puedePedir, postPedir);
comprasRouter.post('/ordenes-compra/:id/cancelar', ...puedePedir, postCancelar);
comprasRouter.post('/ordenes-compra/:id/cerrar', ...puedePedir, postCerrar);

/**
 * Recibir una orden NO lleva requiereSucursal: la sucursal no viene en el
 * pedido, es la de la orden. El servicio la verifica con el candado tomado.
 */
comprasRouter.post('/ordenes-compra/:id/recepciones', ...puedeRecibir, postRecepcionDeOrden);

// --- Recepciones.
comprasRouter.get('/recepciones', ...puedeVer, getRecepciones);
comprasRouter.get('/recepciones/:id', ...puedeVer, getRecepcion);
comprasRouter.post('/recepciones', ...puedeRecibir, enSucursalDelCuerpo, postRecepcionDirecta);
comprasRouter.post(
  '/recepciones/:id/anular',
  requiereAutenticacion,
  requierePermiso('compra:anular'),
  postAnularRecepcion,
);

// --- El costo promedio de un insumo (para su ficha).
comprasRouter.get('/insumos/:insumoId/costo', ...puedeVer, getCostoInsumo);
