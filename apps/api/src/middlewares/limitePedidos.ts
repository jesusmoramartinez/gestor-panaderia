import type { RequestHandler } from 'express';

import { errores } from '../lib/errores.js';
import { LimitadorIntentos } from '../lib/limitador.js';

/**
 * LÍMITE GENERAL DE PEDIDOS por IP: N por minuto, contando TODOS los pedidos
 * (el del login cuenta solo los fallidos; este es un freno grueso contra un
 * script que martilla la API).
 *
 * Reusa el limitador de ventana deslizante del login.
 *
 * El contador vive en la memoria del proceso. En el VPS hay un solo proceso
 * de la API, así que es el freno real (se reinicia con cada deploy, y está
 * bien: es un freno contra ráfagas, no un registro).
 */
export function limitarPedidos(porMinuto: number): RequestHandler {
  if (porMinuto === 0) {
    return (_req, _res, next) => {
      next();
    };
  }

  const limitador = new LimitadorIntentos({ limite: porMinuto, ventanaMs: 60_000 });

  return (req, _res, next) => {
    const clave = req.ip ?? 'desconocida';
    const resultado = limitador.verificar(clave);
    if (!resultado.permitido) {
      next(errores.demasiadosPedidos(resultado.esperarSegundos));
      return;
    }
    limitador.registrar(clave);
    next();
  };
}
