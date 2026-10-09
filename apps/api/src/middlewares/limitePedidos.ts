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
 * OJO EN VERCEL: cada función tiene su propia memoria, así que este contador
 * es por instancia, no global. Ahí el freno de verdad es el firewall de
 * Vercel (una regla de "rate limit"), configurado en la guía de despliegue.
 * Este middleware queda como segunda línea, y es el freno real si algún día
 * la API corre en un servidor propio.
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
