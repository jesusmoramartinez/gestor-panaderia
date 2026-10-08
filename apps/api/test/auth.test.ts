import type { UsuarioSesion } from '@panaderia/shared';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { PASSWORD_DEV } from '../prisma/semilla.js';
import { cerrarConexiones, prisma } from '../src/lib/db.js';
import { reiniciarLimitadores } from '../src/modules/auth/service.js';
import { ClienteHttp } from './cliente-http.js';

const COOKIE = 'panaderia_sesion';
let api: ClienteHttp;

beforeAll(async () => {
  api = await ClienteHttp.levantar();
});

afterAll(async () => {
  await api.cerrar();
  await cerrarConexiones();
});

beforeEach(() => {
  // El limitador vive en memoria y lo comparten todos los tests del archivo:
  // sin esto, los intentos fallidos de un test bloquearían al siguiente.
  reiniciarLimitadores();
  api.olvidarCookies();
});

function cuerpoError(respuesta: { cuerpo: unknown }): { codigo: string; mensaje: string } {
  return respuesta.cuerpo as { codigo: string; mensaje: string };
}

describe('POST /api/auth/login', () => {
  it('con credenciales correctas devuelve la sesión y manda la cookie', async () => {
    const r = await api.post('/api/auth/login', {
      email: 'encargado@panaderia.test',
      password: PASSWORD_DEV,
    });

    expect(r.status).toBe(200);
    const usuario = r.cuerpo as UsuarioSesion;
    expect(usuario.email).toBe('encargado@panaderia.test');
    expect(usuario.rol).toBe('ENCARGADO');
    expect(usuario.empresa.nombre).toBe('Panadería Laferrere');
    // El encargado cubre las dos sucursales.
    expect(usuario.sucursales.map((s) => s.codigo).sort()).toEqual(['CEN', 'LAF']);
    expect(api.cookie(COOKIE)).toBeDefined();
  });

  it('la cookie es httpOnly, SameSite=Lax y de todo el sitio', async () => {
    const r = await api.post('/api/auth/login', {
      email: 'dueno@panaderia.test',
      password: PASSWORD_DEV,
    });

    const cookie = r.setCookie.find((c) => c.startsWith(COOKIE));
    expect(cookie).toBeDefined();
    // httpOnly es lo que impide que un script de la página lea la sesión.
    expect(cookie).toMatch(/HttpOnly/i);
    // SameSite=Lax es lo que corta los ataques CSRF.
    expect(cookie).toMatch(/SameSite=Lax/i);
    expect(cookie).toMatch(/Path=\//);
    // En desarrollo NO lleva Secure, porque trabajamos sobre http://localhost.
    expect(cookie).not.toMatch(/Secure/i);
  });

  it('la respuesta no filtra el token ni el hash de la contraseña', async () => {
    const r = await api.post('/api/auth/login', {
      email: 'dueno@panaderia.test',
      password: PASSWORD_DEV,
    });

    const json = JSON.stringify(r.cuerpo);
    expect(json).not.toContain('passwordHash');
    expect(json).not.toContain('scrypt$');
    // El token viaja SOLO en la cookie, nunca en el cuerpo.
    expect(json).not.toContain(api.cookie(COOKIE) ?? 'imposible');
  });

  it('normaliza el email: espacios y mayúsculas no importan', async () => {
    const r = await api.post('/api/auth/login', {
      email: '  DUENO@Panaderia.TEST  ',
      password: PASSWORD_DEV,
    });
    expect(r.status).toBe(200);
  });

  it('con la contraseña incorrecta devuelve 401', async () => {
    const r = await api.post('/api/auth/login', {
      email: 'dueno@panaderia.test',
      password: 'no-es-la-contraseña',
    });
    expect(r.status).toBe(401);
    expect(cuerpoError(r).codigo).toBe('CREDENCIALES_INVALIDAS');
  });

  it('con un email inexistente responde EXACTAMENTE igual que con la contraseña mala', async () => {
    // Si las dos respuestas fueran distintas, cualquiera podría averiguar qué
    // emails están registrados en el sistema.
    const malPassword = await api.post('/api/auth/login', {
      email: 'dueno@panaderia.test',
      password: 'incorrecta',
    });
    reiniciarLimitadores();
    const noExiste = await api.post('/api/auth/login', {
      email: 'fantasma@panaderia.test',
      password: 'incorrecta',
    });

    expect(noExiste.status).toBe(malPassword.status);
    expect(cuerpoError(noExiste)).toEqual(cuerpoError(malPassword));
  });

  it('rechaza un cuerpo inválido indicando el campo', async () => {
    const r = await api.post('/api/auth/login', { email: 'no-es-un-email' });
    expect(r.status).toBe(400);
    const error = r.cuerpo as { codigo: string; detalles: Record<string, string> };
    expect(error.codigo).toBe('DATOS_INVALIDOS');
    expect(Object.keys(error.detalles).sort()).toEqual(['email', 'password']);
  });

  it('bloquea después de 5 intentos fallidos sobre el mismo email', async () => {
    const credenciales = { email: 'encargado@panaderia.test', password: 'incorrecta' };

    for (let intento = 1; intento <= 5; intento++) {
      const r = await api.post('/api/auth/login', credenciales);
      expect(r.status, `intento ${String(intento)}`).toBe(401);
    }

    const bloqueado = await api.post('/api/auth/login', credenciales);
    expect(bloqueado.status).toBe(429);
    expect(cuerpoError(bloqueado).codigo).toBe('DEMASIADOS_INTENTOS');

    // Y con la contraseña CORRECTA también queda bloqueado: si no, el límite
    // no serviría para nada.
    const conLaBuena = await api.post('/api/auth/login', {
      email: 'encargado@panaderia.test',
      password: PASSWORD_DEV,
    });
    expect(conLaBuena.status).toBe(429);
  });
});

describe('GET /api/auth/me', () => {
  it('sin cookie responde 401', async () => {
    const r = await api.get('/api/auth/me');
    expect(r.status).toBe(401);
    expect(cuerpoError(r).codigo).toBe('NO_AUTENTICADO');
  });

  it('con una cookie inventada responde 401', async () => {
    api.ponerCookie(COOKIE, 'token-que-no-existe');
    const r = await api.get('/api/auth/me');
    expect(r.status).toBe(401);
  });

  it('con sesión válida devuelve el usuario', async () => {
    await api.post('/api/auth/login', {
      email: 'empleado@panaderia.test',
      password: PASSWORD_DEV,
    });

    const r = await api.get('/api/auth/me');
    expect(r.status).toBe(200);
    const usuario = r.cuerpo as UsuarioSesion;
    expect(usuario.rol).toBe('EMPLEADO');
    // El empleado solo opera en Laferrere.
    expect(usuario.sucursales.map((s) => s.codigo)).toEqual(['LAF']);
    // Y no tiene ningún permiso de los que hay hoy.
    expect(usuario.permisos).toEqual([]);
  });
});

describe('POST /api/auth/logout', () => {
  it('revoca la sesión: el mismo token deja de servir', async () => {
    await api.post('/api/auth/login', {
      email: 'dueno@panaderia.test',
      password: PASSWORD_DEV,
    });
    const token = api.cookie(COOKIE);
    expect(token).toBeDefined();

    const salida = await api.post('/api/auth/logout');
    expect(salida.status).toBe(204);
    // El servidor pide borrar la cookie.
    expect(salida.setCookie.some((c) => c.startsWith(`${COOKIE}=;`))).toBe(true);

    // Ahora lo importante: reusamos el token a mano, como lo haría alguien que
    // lo copió. Tiene que estar muerto en el SERVIDOR, no solo en el navegador.
    api.ponerCookie(COOKIE, token ?? '');
    const r = await api.get('/api/auth/me');
    expect(r.status).toBe(401);
  });

  it('sin sesión responde 401', async () => {
    const r = await api.post('/api/auth/logout');
    expect(r.status).toBe(401);
  });
});

describe('auditoría de los accesos', () => {
  it('registra el login exitoso', async () => {
    const antes = new Date();
    await api.post('/api/auth/login', {
      email: 'dueno@panaderia.test',
      password: PASSWORD_DEV,
    });

    const evento = await prisma.auditoria.findFirst({
      where: { accion: 'LOGIN', createdAt: { gte: antes } },
      include: { usuario: true },
      orderBy: { createdAt: 'desc' },
    });

    expect(evento).not.toBeNull();
    expect(evento?.usuario?.email).toBe('dueno@panaderia.test');
    expect(evento?.empresaId).not.toBeNull();
  });

  it('registra el intento fallido con el email, y nunca la contraseña', async () => {
    const antes = new Date();
    await api.post('/api/auth/login', {
      email: 'dueno@panaderia.test',
      password: 'contraseña-secreta-del-atacante',
    });

    const evento = await prisma.auditoria.findFirst({
      where: { accion: 'LOGIN_FALLIDO', createdAt: { gte: antes } },
      orderBy: { createdAt: 'desc' },
    });

    expect(evento).not.toBeNull();
    const datos = evento?.datosDespues as { email: string; motivo: string } | null;
    expect(datos?.email).toBe('dueno@panaderia.test');
    expect(datos?.motivo).toBe('password');
    // La contraseña intentada NO se guarda en ninguna parte.
    expect(JSON.stringify(evento)).not.toContain('contraseña-secreta-del-atacante');
  });

  it('registra el intento con un email inexistente sin empresa asociada', async () => {
    const antes = new Date();
    await api.post('/api/auth/login', {
      email: 'nadie@panaderia.test',
      password: 'cualquiera',
    });

    const evento = await prisma.auditoria.findFirst({
      where: { accion: 'LOGIN_FALLIDO', createdAt: { gte: antes } },
      orderBy: { createdAt: 'desc' },
    });

    // empresaId nullable existe justamente para este caso.
    expect(evento?.empresaId).toBeNull();
    expect(evento?.usuarioId).toBeNull();
    expect((evento?.datosDespues as { motivo: string } | null)?.motivo).toBe('inexistente');
  });
});
