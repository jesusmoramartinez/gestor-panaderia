// CAPA 2 — CONTROLADOR: traduce entre HTTP y el servicio. Sin reglas de negocio.
import { LoginSchema } from '@panaderia/shared';
import type { Request, Response } from 'express';

import { contextoDe } from '../../lib/contexto.js';
import { parsear } from '../../lib/validar.js';
import { NOMBRE_COOKIE_SESION, opcionesBorrarCookie, opcionesCookieSesion } from './cookies.js';
import * as service from './service.js';

export async function postLogin(req: Request, res: Response): Promise<void> {
  const entrada = parsear(LoginSchema, req.body);

  const { token, expiraAt, usuario } = await service.login(entrada, {
    // req.ip respeta la configuración de "trust proxy" de Express, que en
    // producción habrá que ajustar según dónde se despliegue (Fase 11).
    ip: req.ip ?? null,
    userAgent: req.get('user-agent') ?? null,
  });

  // El token viaja SOLO en la cookie: nunca en el cuerpo de la respuesta, para
  // que no quede en los logs del navegador ni al alcance de un script.
  res.cookie(NOMBRE_COOKIE_SESION, token, opcionesCookieSesion(expiraAt));
  res.status(200).json(usuario);
}

export async function postLogout(req: Request, res: Response): Promise<void> {
  await service.logout(contextoDe(req));
  res.clearCookie(NOMBRE_COOKIE_SESION, opcionesBorrarCookie());
  res.status(204).end();
}

export async function getMe(req: Request, res: Response): Promise<void> {
  res.status(200).json(await service.datosDeSesion(contextoDe(req)));
}
