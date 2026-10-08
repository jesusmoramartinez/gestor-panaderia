// CAPA 1 — RUTAS. Un módulo tan chico que tiene todo junto: una consulta sin
// reglas no justifica cuatro archivos.
import type { SucursalResumen } from '@panaderia/shared';
import { type Request, type Response, Router } from 'express';

import { contextoDe } from '../../lib/contexto.js';
import { prisma } from '../../lib/db.js';
import { requiereAutenticacion } from '../../middlewares/auth.js';

export const sucursalesRouter: Router = Router();

/**
 * Todas las sucursales ACTIVAS de la empresa.
 *
 * Existe para elegir el DESTINO de una transferencia: el encargado de la
 * Central puede mandarle harina a Laferrere aunque no trabaje en Laferrere.
 * Las sucursales donde el usuario puede OPERAR siguen saliendo de la sesión
 * (/auth/me); esta lista solo dice cuáles existen.
 */
async function getSucursales(req: Request, res: Response): Promise<void> {
  const ctx = contextoDe(req);
  const filas: SucursalResumen[] = await prisma.sucursal.findMany({
    where: { empresaId: ctx.empresaId, activa: true },
    orderBy: [{ esCentral: 'desc' }, { nombre: 'asc' }],
    select: { id: true, codigo: true, nombre: true, esCentral: true },
  });
  res.status(200).json(filas);
}

sucursalesRouter.get('/sucursales', requiereAutenticacion, getSucursales);
