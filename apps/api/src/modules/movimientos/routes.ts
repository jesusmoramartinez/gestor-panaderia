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
  getHistorial,
  getMotivos,
  getStock,
  postAjuste,
  postConsumo,
  postMerma,
  postReversa,
  postSaldoInicial,
} from './controller.js';

export const movimientosRouter: Router = Router();

/**
 * El orden de los middlewares no es decorativo, y acá se ve mejor que en
 * ninguna otra ruta del proyecto:
 *
 *   requiereAutenticacion  → ¿quién sos? (si no, 401)
 *   requierePermiso        → ¿tu rol puede hacer esto? (si no, 403)
 *   requiereSucursal       → ¿podés operar EN ESA sucursal? (si no, 403)
 *
 * Los tres son necesarios y ninguno reemplaza al otro: un encargado de
 * Laferrere tiene el permiso `consumo:crear` y aun así no puede cargar consumo
 * en la Central.
 */
const enSucursalDelCuerpo = requiereSucursal(campoDeCuerpo('sucursalId'));
const enSucursalDelQuery = requiereSucursal(campoDeQuery('sucursalId'));

// --- Consultas. VER stock e historial no lleva permiso: son cantidades, no
// --- plata. Lo que sí se exige es que la sucursal sea una de las suyas.
movimientosRouter.get('/stock', requiereAutenticacion, enSucursalDelQuery, getStock);
movimientosRouter.get(
  '/insumos/:insumoId/movimientos',
  requiereAutenticacion,
  enSucursalDelQuery,
  getHistorial,
);
movimientosRouter.get('/motivos', requiereAutenticacion, getMotivos);

// --- Cargas.
movimientosRouter.post(
  '/movimientos/saldo-inicial',
  requiereAutenticacion,
  requierePermiso('stock:cargar-inicial'),
  enSucursalDelCuerpo,
  postSaldoInicial,
);

movimientosRouter.post(
  '/movimientos/consumo',
  requiereAutenticacion,
  requierePermiso('consumo:crear'),
  enSucursalDelCuerpo,
  postConsumo,
);

movimientosRouter.post(
  '/movimientos/merma',
  requiereAutenticacion,
  requierePermiso('merma:crear'),
  enSucursalDelCuerpo,
  postMerma,
);

movimientosRouter.post(
  '/movimientos/ajuste',
  requiereAutenticacion,
  requierePermiso('ajuste:crear'),
  enSucursalDelCuerpo,
  postAjuste,
);

/**
 * La anulación NO lleva requiereSucursal: la sucursal no viene en el pedido,
 * sale del movimiento que se anula. Verificar que el usuario pueda operar ahí
 * es tarea del servicio, que es el que la conoce.
 */
movimientosRouter.post(
  '/movimientos/:id/reversa',
  requiereAutenticacion,
  requierePermiso('movimiento:anular'),
  postReversa,
);
