import type { EventoAuditoria, UsuarioResumen } from '@panaderia/shared';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { PASSWORD_DEV } from '../prisma/semilla.js';
import { cerrarConexiones, prisma } from '../src/lib/db.js';
import { reiniciarLimitadores } from '../src/modules/auth/service.js';
import { ClienteHttp } from './cliente-http.js';

let api: ClienteHttp;

beforeAll(async () => {
  api = await ClienteHttp.levantar();
});

afterAll(async () => {
  await api.cerrar();
  await cerrarConexiones();
});

beforeEach(() => {
  reiniciarLimitadores();
  api.olvidarCookies();
});

async function entrarComo(email: string): Promise<void> {
  const r = await api.post('/api/auth/login', { email, password: PASSWORD_DEV });
  expect(r.status, `login de ${email}`).toBe(200);
}

function codigo(respuesta: { cuerpo: unknown }): string {
  return (respuesta.cuerpo as { codigo: string }).codigo;
}

describe('permisos por rol', () => {
  it('el empleado no puede ver el listado de usuarios', async () => {
    await entrarComo('empleado@panaderia.test');
    const r = await api.get('/api/usuarios');
    expect(r.status).toBe(403);
    expect(codigo(r)).toBe('SIN_PERMISO');
  });

  it('el encargado puede VER usuarios pero no CREARLOS', async () => {
    await entrarComo('encargado@panaderia.test');

    const listado = await api.get('/api/usuarios');
    expect(listado.status).toBe(200);

    const creacion = await api.post('/api/usuarios', {
      email: 'no-deberia-existir@panaderia.test',
      nombre: 'Prueba',
      rol: 'EMPLEADO',
      password: 'unaClaveLarga123',
      sucursalIds: [],
    });
    expect(creacion.status).toBe(403);
    expect(codigo(creacion)).toBe('SIN_PERMISO');

    // El 403 tiene que cortar ANTES de tocar la base.
    const fila = await prisma.usuario.findUnique({
      where: { email: 'no-deberia-existir@panaderia.test' },
    });
    expect(fila).toBeNull();
  });

  it('solo el dueño ve la auditoría', async () => {
    await entrarComo('empleado@panaderia.test');
    expect((await api.get('/api/auditoria')).status).toBe(403);

    api.olvidarCookies();
    reiniciarLimitadores();
    await entrarComo('encargado@panaderia.test');
    expect((await api.get('/api/auditoria')).status).toBe(403);

    api.olvidarCookies();
    reiniciarLimitadores();
    await entrarComo('dueno@panaderia.test');
    const r = await api.get('/api/auditoria');
    expect(r.status).toBe(200);
    expect((r.cuerpo as EventoAuditoria[]).length).toBeGreaterThan(0);
  });

  it('sin sesión, los endpoints protegidos dan 401 y no 403', async () => {
    // La diferencia importa: 401 es "no sé quién sos", 403 es "sé quién sos y
    // no te corresponde".
    for (const ruta of ['/api/usuarios', '/api/auditoria', '/api/auth/me']) {
      const r = await api.get(ruta);
      expect(r.status, ruta).toBe(401);
      expect(codigo(r)).toBe('NO_AUTENTICADO');
    }
  });
});

describe('POST /api/usuarios', () => {
  it('el dueño crea un empleado, queda auditado y el empleado puede entrar', async () => {
    await entrarComo('dueno@panaderia.test');

    const sucursal = await prisma.sucursal.findFirstOrThrow({ where: { codigo: 'LAF' } });
    const antes = new Date();

    const r = await api.post('/api/usuarios', {
      email: 'marcela@panaderia.test',
      nombre: 'Marcela',
      rol: 'EMPLEADO',
      password: 'medialunas2026',
      sucursalIds: [sucursal.id],
    });

    expect(r.status).toBe(201);
    const creado = r.cuerpo as UsuarioResumen;
    expect(creado.rol).toBe('EMPLEADO');
    expect(creado.sucursales.map((s) => s.codigo)).toEqual(['LAF']);
    expect(creado.ultimoAccesoAt).toBeNull();
    // La respuesta no devuelve nada del secreto.
    expect(JSON.stringify(creado)).not.toContain('medialunas2026');
    expect(JSON.stringify(creado)).not.toContain('passwordHash');

    // Quedó auditado, con quién lo creó y sin la contraseña.
    const evento = await prisma.auditoria.findFirst({
      where: { accion: 'CREAR', entidad: 'usuario', createdAt: { gte: antes } },
      orderBy: { createdAt: 'desc' },
    });
    expect(evento).not.toBeNull();
    expect(JSON.stringify(evento?.datosDespues)).not.toContain('medialunas2026');

    // Y lo que importa: el usuario nuevo puede entrar con su contraseña.
    api.olvidarCookies();
    reiniciarLimitadores();
    const login = await api.post('/api/auth/login', {
      email: 'marcela@panaderia.test',
      password: 'medialunas2026',
    });
    expect(login.status).toBe(200);
  });

  it('rechaza un email que ya está en uso', async () => {
    await entrarComo('dueno@panaderia.test');
    const r = await api.post('/api/usuarios', {
      email: 'encargado@panaderia.test',
      nombre: 'Repetido',
      rol: 'EMPLEADO',
      password: 'unaClaveLarga123',
      sucursalIds: [],
    });
    expect(r.status).toBe(409);
    expect(codigo(r)).toBe('EMAIL_DUPLICADO');
  });

  it('exige una contraseña de al menos 8 caracteres', async () => {
    await entrarComo('dueno@panaderia.test');
    const r = await api.post('/api/usuarios', {
      email: 'corta@panaderia.test',
      nombre: 'Clave Corta',
      rol: 'EMPLEADO',
      password: 'corta',
      sucursalIds: [],
    });
    expect(r.status).toBe(400);
    const detalles = (r.cuerpo as { detalles: Record<string, string> }).detalles;
    expect(detalles['password']).toMatch(/8 caracteres/);
  });
});
