import type {
  EventoAuditoria,
  UnidadMedida,
  UsuarioResumen,
  UsuarioSesion,
} from '@panaderia/shared';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { PASSWORD_DEV } from '../prisma/semilla.js';
import { cerrarConexiones, prisma } from '../src/lib/db.js';
import { reiniciarLimitadores } from '../src/modules/auth/service.js';
import { ClienteHttp } from './cliente-http.js';

/**
 * EL TEST MÁS VALIOSO DEL PROYECTO.
 *
 * El aislamiento multi-empresa no lo garantiza la infraestructura: todas las
 * panaderías comparten las mismas tablas y lo único que las separa es que cada
 * consulta filtre por empresa_id. Un `where` olvidado y una panadería ve el
 * stock de su competencia. Es el único bug que termina el negocio.
 *
 * Por eso no se verifica leyendo el código: se verifica INTENTÁNDOLO. Acá nos
 * logueamos como el dueño de una empresa y tratamos de llegar a los datos de
 * la otra por todos los caminos que existen hoy. Este archivo crece con cada
 * endpoint nuevo.
 */

let api: ClienteHttp;
let laferrere: {
  empresaId: string;
  sucursalCentralId: string;
  usuarioIds: string[];
  unidadIds: string[];
};

beforeAll(async () => {
  api = await ClienteHttp.levantar();

  // Datos de la empresa "ajena", leídos directo de la base: son los que el
  // usuario de la otra empresa NO tiene que poder ver ni usar.
  const empresa = await prisma.empresa.findFirstOrThrow({
    where: { nombre: 'Panadería Laferrere' },
    include: { sucursales: true, usuarios: true, unidades: true },
  });
  const central = empresa.sucursales.find((s) => s.codigo === 'CEN');
  if (!central) throw new Error('falta la sucursal CEN en la semilla');

  laferrere = {
    empresaId: empresa.id,
    sucursalCentralId: central.id,
    usuarioIds: empresa.usuarios.map((u) => u.id),
    unidadIds: empresa.unidades.map((u) => u.id),
  };
});

afterAll(async () => {
  await api.cerrar();
  await cerrarConexiones();
});

beforeEach(() => {
  reiniciarLimitadores();
  api.olvidarCookies();
});

async function entrarComo(email: string): Promise<UsuarioSesion> {
  const r = await api.post('/api/auth/login', { email, password: PASSWORD_DEV });
  expect(r.status, `login de ${email}`).toBe(200);
  return r.cuerpo as UsuarioSesion;
}

describe('aislamiento entre empresas', () => {
  it('cada usuario ve su propia empresa en /auth/me', async () => {
    const vecina = await entrarComo('dueno@vecina.test');
    expect(vecina.empresa.nombre).toBe('Panadería Vecina (datos de prueba)');
    expect(vecina.empresa.id).not.toBe(laferrere.empresaId);

    api.olvidarCookies();
    const propia = await entrarComo('dueno@panaderia.test');
    expect(propia.empresa.id).toBe(laferrere.empresaId);
  });

  it('el dueño de una empresa solo ve las sucursales de SU empresa', async () => {
    const vecina = await entrarComo('dueno@vecina.test');
    // El dueño accede a "todas las sucursales"... de su empresa, no de todas.
    expect(vecina.sucursales.map((s) => s.codigo)).toEqual(['UNI']);
    expect(vecina.sucursales.map((s) => s.id)).not.toContain(laferrere.sucursalCentralId);
  });

  it('el listado de usuarios no incluye usuarios de la otra empresa', async () => {
    await entrarComo('dueno@vecina.test');
    const r = await api.get('/api/usuarios');
    expect(r.status).toBe(200);

    const usuarios = r.cuerpo as UsuarioResumen[];
    const emails = usuarios.map((u) => u.email);
    expect(emails).toContain('dueno@vecina.test');
    expect(emails).toContain('empleado@vecina.test');
    expect(emails).not.toContain('dueno@panaderia.test');
    expect(emails).not.toContain('encargado@panaderia.test');

    // Ni un solo id de la otra empresa puede aparecer en la respuesta.
    for (const id of laferrere.usuarioIds) {
      expect(JSON.stringify(usuarios)).not.toContain(id);
    }
  });

  it('la auditoría no muestra eventos de la otra empresa', async () => {
    // Primero generamos actividad en Laferrere (un login queda auditado).
    await entrarComo('dueno@panaderia.test');
    api.olvidarCookies();
    reiniciarLimitadores();

    // Ahora el dueño de la otra empresa mira su auditoría.
    await entrarComo('dueno@vecina.test');
    const r = await api.get('/api/auditoria');
    expect(r.status).toBe(200);

    const eventos = r.cuerpo as EventoAuditoria[];
    expect(eventos.length).toBeGreaterThan(0);
    const emails = eventos.map((e) => e.usuario?.email);
    expect(emails).not.toContain('dueno@panaderia.test');
    for (const id of laferrere.usuarioIds) {
      expect(JSON.stringify(eventos)).not.toContain(id);
    }
  });

  it('el catálogo de unidades es de cada empresa', async () => {
    // Las unidades tienen el mismo código en las dos empresas (kg, g, l...),
    // así que es fácil asumir que son "las mismas". No lo son: cada empresa
    // tiene su catálogo y sus ids, y mañana una podría agregar una unidad
    // propia sin afectar a la otra.
    await entrarComo('dueno@vecina.test');
    const r = await api.get('/api/unidades');
    expect(r.status).toBe(200);

    const lista = r.cuerpo as UnidadMedida[];
    expect(lista).toHaveLength(5);
    for (const id of laferrere.unidadIds) {
      expect(lista.map((u) => u.id)).not.toContain(id);
    }
  });

  it('no se puede asignar a un usuario nuevo una sucursal de otra empresa', async () => {
    await entrarComo('dueno@vecina.test');

    // El atacante conoce (o adivina) el UUID de una sucursal ajena y lo manda.
    const r = await api.post('/api/usuarios', {
      email: 'infiltrado@vecina.test',
      nombre: 'Infiltrado',
      rol: 'EMPLEADO',
      password: 'unaClaveLarga123',
      sucursalIds: [laferrere.sucursalCentralId],
    });

    expect(r.status).toBe(400);
    expect((r.cuerpo as { codigo: string }).codigo).toBe('DATOS_INVALIDOS');

    // Y no quedó creado a medias.
    const creado = await prisma.usuario.findUnique({ where: { email: 'infiltrado@vecina.test' } });
    expect(creado).toBeNull();
  });

  it('un usuario nuevo queda en la empresa de quien lo crea, no en otra', async () => {
    await entrarComo('dueno@vecina.test');

    const r = await api.post('/api/usuarios', {
      email: 'nuevo@vecina.test',
      nombre: 'Nuevo Vecino',
      rol: 'EMPLEADO',
      password: 'unaClaveLarga123',
      sucursalIds: [],
    });
    expect(r.status).toBe(201);

    const creado = await prisma.usuario.findUniqueOrThrow({
      where: { email: 'nuevo@vecina.test' },
    });
    // Aunque el pedido no dijo nada de la empresa, quedó en la correcta:
    // porque el empresaId sale de la SESIÓN y no del cuerpo del pedido.
    expect(creado.empresaId).not.toBe(laferrere.empresaId);
  });

  it('mandar un empresaId en el cuerpo del pedido no cambia nada', async () => {
    await entrarComo('dueno@vecina.test');

    // Esto es el ataque directo: inyectar el empresaId ajeno en el body.
    const r = await api.post('/api/usuarios', {
      email: 'inyectado@vecina.test',
      nombre: 'Inyectado',
      rol: 'EMPLEADO',
      password: 'unaClaveLarga123',
      sucursalIds: [],
      empresaId: laferrere.empresaId,
    });
    expect(r.status).toBe(201);

    const creado = await prisma.usuario.findUniqueOrThrow({
      where: { email: 'inyectado@vecina.test' },
    });
    // Zod descarta los campos que no están en el esquema y el servicio usa el
    // empresaId de la sesión: el intento se ignora por completo.
    expect(creado.empresaId).not.toBe(laferrere.empresaId);
  });
});
