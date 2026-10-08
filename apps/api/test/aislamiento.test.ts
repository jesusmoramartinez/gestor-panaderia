import type {
  EventoAuditoria,
  ListadoInsumos,
  Motivo,
  ProveedorDetalle,
  ProveedorResumen,
  StockPorSucursal,
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
  insumoIds: string[];
  harina000Id: string;
  proveedorIds: string[];
  molinoId: string;
};

beforeAll(async () => {
  api = await ClienteHttp.levantar();

  // Datos de la empresa "ajena", leídos directo de la base: son los que el
  // usuario de la otra empresa NO tiene que poder ver ni usar.
  const empresa = await prisma.empresa.findFirstOrThrow({
    where: { nombre: 'Panadería Laferrere' },
    include: {
      sucursales: true,
      usuarios: true,
      unidades: true,
      insumos: true,
      proveedores: true,
    },
  });
  const central = empresa.sucursales.find((s) => s.codigo === 'CEN');
  if (!central) throw new Error('falta la sucursal CEN en la semilla');

  laferrere = {
    empresaId: empresa.id,
    sucursalCentralId: central.id,
    usuarioIds: empresa.usuarios.map((u) => u.id),
    unidadIds: empresa.unidades.map((u) => u.id),
    insumoIds: empresa.insumos.map((i) => i.id),
    harina000Id: empresa.insumos.find((i) => i.nombre === 'Harina 000')?.id ?? '',
    proveedorIds: empresa.proveedores.map((p) => p.id),
    // Ojo: la OTRA empresa tiene un proveedor con el mismo nombre y el mismo
    // CUIT. Es el caso realista (dos panaderías le compran al mismo molino) y
    // el que demuestra que lo que separa los datos es el empresa_id, no el
    // nombre.
    molinoId: empresa.proveedores.find((p) => p.nombre === 'Molino San Jorge')?.id ?? '',
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

  it('dos empresas pueden tener un insumo con el MISMO nombre, y no se mezclan', async () => {
    // Las dos tienen "Harina 000". Es el caso que demuestra que la unicidad es
    // POR empresa y que el listado jamás cruza los datos.
    await entrarComo('dueno@vecina.test');
    const r = await api.get('/api/insumos?limite=100');
    expect(r.status).toBe(200);

    const { items, total } = r.cuerpo as ListadoInsumos;
    expect(total).toBe(2);
    expect(items.map((i) => i.nombre).sort()).toEqual(['Azúcar', 'Harina 000']);

    // Su "Harina 000" NO es la de la otra empresa.
    const suHarina = items.find((i) => i.nombre === 'Harina 000');
    expect(suHarina?.id).not.toBe(laferrere.harina000Id);
    for (const id of laferrere.insumoIds) {
      expect(JSON.stringify(items)).not.toContain(id);
    }
  });

  it('pedir el detalle de un insumo ajeno responde 404, no 403', async () => {
    // Un 403 confirmaría que ese insumo existe y es de alguien. Para este
    // usuario, simplemente no existe.
    await entrarComo('dueno@vecina.test');
    const r = await api.get(`/api/insumos/${laferrere.harina000Id}`);
    expect(r.status).toBe(404);
  });

  it('no se puede editar ni desactivar un insumo de otra empresa', async () => {
    await entrarComo('dueno@vecina.test');
    const editar = await api.pedir('PATCH', `/api/insumos/${laferrere.harina000Id}`, {
      nombre: 'Secuestrada',
    });
    expect(editar.status).toBe(404);

    const baja = await api.post(`/api/insumos/${laferrere.harina000Id}/desactivar`);
    expect(baja.status).toBe(404);

    // Y sigue intacta.
    const harina = await prisma.insumo.findUniqueOrThrow({
      where: { id: laferrere.harina000Id },
    });
    expect(harina.nombre).toBe('Harina 000');
    expect(harina.activo).toBe(true);
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

  it('el listado de proveedores no cruza empresas, aunque se llamen igual', async () => {
    // Las dos empresas tienen un "Molino San Jorge" con el MISMO CUIT. Si el
    // filtro por empresa_id se olvidara en algún lado, acá se vería.
    await entrarComo('dueno@vecina.test');
    const r = await api.get('/api/proveedores');
    expect(r.status).toBe(200);

    const proveedores = r.cuerpo as ProveedorResumen[];
    expect(proveedores.map((p) => p.nombre)).toEqual(['Molino San Jorge']);
    expect(proveedores[0]?.id).not.toBe(laferrere.molinoId);
    // Su molino tarda 3 días; el de la otra empresa, 2. Son fichas distintas.
    expect(proveedores[0]?.diasEntrega).toBe(3);

    for (const id of laferrere.proveedorIds) {
      expect(JSON.stringify(proveedores)).not.toContain(id);
    }
  });

  it('la ficha de un proveedor ajeno responde 404, y no se puede editar', async () => {
    await entrarComo('dueno@vecina.test');
    expect((await api.get(`/api/proveedores/${laferrere.molinoId}`)).status).toBe(404);

    const editar = await api.pedir('PATCH', `/api/proveedores/${laferrere.molinoId}`, {
      nombre: 'Secuestrado',
    });
    expect(editar.status).toBe(404);

    const baja = await api.post(`/api/proveedores/${laferrere.molinoId}/desactivar`);
    expect(baja.status).toBe(404);

    // Y sigue intacto.
    const molino = await prisma.proveedor.findUniqueOrThrow({ where: { id: laferrere.molinoId } });
    expect(molino.nombre).toBe('Molino San Jorge');
    expect(molino.activo).toBe(true);
  });

  it('no se puede asociar un insumo de otra empresa a un proveedor propio', async () => {
    await entrarComo('dueno@vecina.test');

    // Primero un proveedor propio, legítimo.
    const alta = await api.post('/api/proveedores', { nombre: 'Proveedor del vecino' });
    expect(alta.status).toBe(201);
    const propio = alta.cuerpo as ProveedorDetalle;

    // Ahora el ataque: el atacante conoce (o adivina) el UUID de un insumo
    // ajeno y lo manda en el cuerpo del pedido.
    const r = await api.post(`/api/proveedores/${propio.id}/insumos`, {
      insumoId: laferrere.harina000Id,
    });

    expect(r.status).toBe(400);
    expect((r.cuerpo as { codigo: string }).codigo).toBe('DATOS_INVALIDOS');

    // Y no quedó nada escrito apuntando al insumo ajeno.
    const colado = await prisma.proveedorInsumo.count({
      where: { insumoId: laferrere.harina000Id, proveedorId: propio.id },
    });
    expect(colado).toBe(0);
  });

  it('ver los proveedores de un insumo ajeno responde 404', async () => {
    await entrarComo('dueno@vecina.test');
    const r = await api.get(`/api/insumos/${laferrere.harina000Id}/proveedores`);
    expect(r.status).toBe(404);
  });

  it('no se puede ver el stock de una sucursal de otra empresa', async () => {
    await entrarComo('dueno@vecina.test');
    const r = await api.get(`/api/stock?sucursalId=${laferrere.sucursalCentralId}`);
    // 403 y no 404: la sucursal no está entre las habilitadas de esta sesión,
    // y es el middleware el que corta antes de llegar a la base.
    expect(r.status).toBe(403);
    expect((r.cuerpo as { codigo: string }).codigo).toBe('SUCURSAL_NO_PERMITIDA');
  });

  it('el stock propio no incluye ni un insumo de la otra empresa', async () => {
    const vecina = await entrarComo('dueno@vecina.test');
    const suSucursal = vecina.sucursales[0]?.id ?? '';
    const r = await api.get(`/api/stock?sucursalId=${suSucursal}`);
    expect(r.status).toBe(200);

    const datos = r.cuerpo as StockPorSucursal;
    expect(datos.items.map((i) => i.nombre).sort()).toEqual(['Azúcar', 'Harina 000']);
    for (const id of laferrere.insumoIds) {
      expect(JSON.stringify(datos)).not.toContain(id);
    }
  });

  it('no se puede cargar un consumo con un insumo de otra empresa', async () => {
    const vecina = await entrarComo('dueno@vecina.test');
    const suSucursal = vecina.sucursales[0]?.id ?? '';

    // El atacante conoce (o adivina) el UUID de un insumo ajeno.
    const r = await api.post('/api/movimientos/consumo', {
      sucursalId: suSucursal,
      lineas: [{ insumoId: laferrere.harina000Id, cantidad: '1' }],
    });

    expect(r.status).toBe(400);
    expect((r.cuerpo as { codigo: string }).codigo).toBe('DATOS_INVALIDOS');

    // Y no quedó ningún movimiento apuntando al insumo ajeno.
    const colados = await prisma.movimientoStock.count({
      where: { insumoId: laferrere.harina000Id, empresaId: { not: laferrere.empresaId } },
    });
    expect(colados).toBe(0);
  });

  it('el historial de un insumo ajeno responde 404', async () => {
    const vecina = await entrarComo('dueno@vecina.test');
    const suSucursal = vecina.sucursales[0]?.id ?? '';
    const r = await api.get(
      `/api/insumos/${laferrere.harina000Id}/movimientos?sucursalId=${suSucursal}`,
    );
    expect(r.status).toBe(404);
  });

  it('no se puede anular un movimiento de otra empresa', async () => {
    // Primero generamos un movimiento real en Laferrere.
    await entrarComo('dueno@panaderia.test');
    const carga = await api.post('/api/movimientos/consumo', {
      sucursalId: laferrere.sucursalCentralId,
      lineas: [{ insumoId: laferrere.harina000Id, cantidad: '1' }],
      forzar: true,
    });
    expect(carga.status).toBe(201);
    const movimientoId =
      (carga.cuerpo as { movimientos: { id: string }[] }).movimientos[0]?.id ?? '';

    api.olvidarCookies();
    reiniciarLimitadores();
    await entrarComo('dueno@vecina.test');

    const r = await api.post(`/api/movimientos/${movimientoId}/reversa`, {});
    expect(r.status).toBe(404);

    // Y el movimiento sigue intacto, sin reversa.
    const original = await prisma.movimientoStock.findUniqueOrThrow({
      where: { id: movimientoId },
      include: { revertidoPor: true },
    });
    expect(original.revertidoPor).toBeNull();
  });

  it('los motivos de movimiento son de cada empresa', async () => {
    // Las dos tienen los mismos NOMBRES (los siembra el seed para todas), pero
    // no los mismos ids: cada panadería podría agregar el motivo que quiera.
    await entrarComo('dueno@vecina.test');
    const r = await api.get('/api/motivos');
    expect(r.status).toBe(200);

    const motivos = r.cuerpo as Motivo[];
    expect(motivos).toHaveLength(9);

    const propios = await prisma.motivoMovimiento.findMany({
      where: { empresaId: laferrere.empresaId },
      select: { id: true },
    });
    for (const { id } of propios) {
      expect(motivos.map((m) => m.id)).not.toContain(id);
    }
  });

  it('no se puede ajustar el stock de un insumo de otra empresa', async () => {
    const vecina = await entrarComo('dueno@vecina.test');
    const suSucursal = vecina.sucursales[0]?.id ?? '';
    const suMotivo = await prisma.motivoMovimiento.findFirstOrThrow({
      where: { empresa: { nombre: { contains: 'Vecina' } }, tipoAplicable: 'AJUSTE' },
    });

    // El ajuste es el camino más directo para tocar un saldo, así que es el
    // que más vale probar: acá se intenta contra un insumo ajeno.
    const r = await api.post('/api/movimientos/ajuste', {
      sucursalId: suSucursal,
      motivoId: suMotivo.id,
      lineas: [{ insumoId: laferrere.harina000Id, cantidadContada: '999' }],
    });

    expect(r.status).toBe(400);
    expect((r.cuerpo as { codigo: string }).codigo).toBe('DATOS_INVALIDOS');

    const colados = await prisma.movimientoStock.count({
      where: { insumoId: laferrere.harina000Id, empresaId: { not: laferrere.empresaId } },
    });
    expect(colados).toBe(0);
  });

  it('no se puede usar un motivo de otra empresa', async () => {
    // El motivo viene en el cuerpo del pedido, así que es otro id que hay que
    // verificar de a uno: el empresaId de la sesión no alcanza por sí solo.
    const ajeno = await prisma.motivoMovimiento.findFirstOrThrow({
      where: { empresaId: laferrere.empresaId, tipoAplicable: 'AJUSTE' },
    });
    const vecina = await entrarComo('dueno@vecina.test');
    const suSucursal = vecina.sucursales[0]?.id ?? '';
    const suInsumo = await prisma.insumo.findFirstOrThrow({
      where: { empresa: { nombre: { contains: 'Vecina' } } },
    });

    const r = await api.post('/api/movimientos/ajuste', {
      sucursalId: suSucursal,
      motivoId: ajeno.id,
      lineas: [{ insumoId: suInsumo.id, cantidadContada: '5' }],
    });

    expect(r.status).toBe(400);
    expect((r.cuerpo as { detalles: Record<string, string> }).detalles['motivoId']).toBeDefined();
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
