// CAPA 1 — RUTAS: qué URL existe y qué la atiende. Cero lógica.
import { Router } from 'express';

import { requiereAutenticacion } from '../../middlewares/auth.js';
import {
  campoDeCuerpo,
  campoDeQuery,
  requierePermiso,
  requiereSucursal,
} from '../../middlewares/permisos.js';
import {
  getTransferencia,
  getTransferencias,
  postAnular,
  postRecibir,
  postTransferencia,
} from './controller.js';

export const transferenciasRouter: Router = Router();

/**
 * VER no lleva permiso: son cantidades, no plata (el costo no sale en la
 * respuesta), y el empleado de la sucursal que recibe tiene que saber qué le
 * está por llegar. Lo que sí se exige es que la sucursal sea una de las suyas.
 */
transferenciasRouter.get(
  '/transferencias',
  requiereAutenticacion,
  requiereSucursal(campoDeQuery('sucursalId')),
  getTransferencias,
);
transferenciasRouter.get('/transferencias/:id', requiereAutenticacion, getTransferencia);

// Enviar: poder operar en el ORIGEN, que viene en el cuerpo.
transferenciasRouter.post(
  '/transferencias',
  requiereAutenticacion,
  requierePermiso('transferencia:enviar'),
  requiereSucursal(campoDeCuerpo('sucursalOrigenId')),
  postTransferencia,
);

/**
 * Recibir y anular NO llevan requiereSucursal: la sucursal no viene en el
 * pedido, sale de la transferencia (destino para recibir, origen para
 * anular). El servicio la verifica con el candado tomado.
 */
transferenciasRouter.post(
  '/transferencias/:id/recibir',
  requiereAutenticacion,
  requierePermiso('transferencia:recibir'),
  postRecibir,
);
transferenciasRouter.post(
  '/transferencias/:id/anular',
  requiereAutenticacion,
  requierePermiso('transferencia:enviar'),
  postAnular,
);
