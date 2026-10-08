import type { Request, Response } from 'express';
import { describe, expect, it, vi } from 'vitest';

import type { Contexto } from '../lib/contexto.js';
import { AppError } from '../lib/errores.js';
import { requierePermiso, requiereSucursal } from './permisos.js';

/**
 * Estos son tests UNITARIOS de los middlewares: no levantan la app ni tocan la
 * base. Les pasamos un pedido inventado y miramos con qué llaman a `next`.
 *
 * Express usa `next` de dos formas: `next()` significa "seguí adelante" y
 * `next(error)` significa "cortá acá con este error". Eso es exactamente lo
 * que verificamos.
 */

const CTX_ENCARGADO: Contexto = {
  usuarioId: 'usuario-1',
  empresaId: 'empresa-1',
  rol: 'ENCARGADO',
  permisos: ['usuario:ver'],
  sucursalesPermitidas: ['sucursal-central', 'sucursal-laferrere'],
  sesionId: 'sesion-1',
  ip: undefined,
};

function pedido(ctx: Contexto | undefined, extra: Partial<Request> = {}): Request {
  return { ctx, ...extra } as Request;
}

const respuesta = {} as Response;

function errorDe(next: ReturnType<typeof vi.fn>): AppError {
  const argumento: unknown = next.mock.calls[0]?.[0];
  if (!(argumento instanceof AppError)) {
    throw new Error('se esperaba que next() recibiera un AppError');
  }
  return argumento;
}

describe('requierePermiso', () => {
  it('deja pasar cuando el rol tiene el permiso', () => {
    const next = vi.fn();
    requierePermiso('usuario:ver')(pedido(CTX_ENCARGADO), respuesta, next);
    expect(next).toHaveBeenCalledWith();
  });

  it('corta con 403 cuando el rol no tiene el permiso', () => {
    const next = vi.fn();
    requierePermiso('usuario:crear')(pedido(CTX_ENCARGADO), respuesta, next);

    const error = errorDe(next);
    expect(error.status).toBe(403);
    expect(error.codigo).toBe('SIN_PERMISO');
  });

  it('sin contexto corta con 401 (la ruta se montó sin requiereAutenticacion)', () => {
    // Es un error de programación, y es mejor que falle fuerte que seguir
    // adelante con los datos de nadie.
    expect(() => {
      requierePermiso('usuario:ver')(pedido(undefined), respuesta, vi.fn());
    }).toThrow(AppError);
  });
});

describe('requiereSucursal', () => {
  const desdeElQuery = requiereSucursal((req) => (req.query as { sucursalId?: string }).sucursalId);

  it('deja pasar una sucursal habilitada', () => {
    const next = vi.fn();
    desdeElQuery(
      pedido(CTX_ENCARGADO, { query: { sucursalId: 'sucursal-central' } }),
      respuesta,
      next,
    );
    expect(next).toHaveBeenCalledWith();
  });

  it('corta con 403 una sucursal de la que el usuario no tiene permiso', () => {
    // El empresa_id de la sesión no alcanza: un empleado de una sucursal no
    // tiene por qué operar en otra, aunque sea de su misma empresa.
    const next = vi.fn();
    desdeElQuery(
      pedido(CTX_ENCARGADO, { query: { sucursalId: 'sucursal-ajena' } }),
      respuesta,
      next,
    );

    const error = errorDe(next);
    expect(error.status).toBe(403);
    expect(error.codigo).toBe('SUCURSAL_NO_PERMITIDA');
  });

  it('corta con 400 si el pedido no indica sucursal', () => {
    const next = vi.fn();
    desdeElQuery(pedido(CTX_ENCARGADO, { query: {} }), respuesta, next);

    const error = errorDe(next);
    expect(error.status).toBe(400);
    expect(error.codigo).toBe('DATOS_INVALIDOS');
  });

  it('puede leer la sucursal del cuerpo del pedido, no solo del query', () => {
    // Por eso recibe una función: en un GET el id viene en el query y en un
    // POST en el body, y eso cambia según el endpoint.
    const desdeElCuerpo = requiereSucursal(
      (req) => (req.body as { sucursalId?: string }).sucursalId,
    );
    const next = vi.fn();
    desdeElCuerpo(
      pedido(CTX_ENCARGADO, { body: { sucursalId: 'sucursal-laferrere' } }),
      respuesta,
      next,
    );
    expect(next).toHaveBeenCalledWith();
  });
});
