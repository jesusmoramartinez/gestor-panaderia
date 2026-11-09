import {
  type InsumoDetalle,
  type LoQueMeDeben,
  LoQueMeDebenSchema,
  type OrdenDetalle,
  OrdenDetalleSchema,
  type ProveedorDetalle,
  RecepcionDetalleSchema,
  type UsuarioSesion,
} from '@panaderia/shared';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { PASSWORD_DEV } from '../prisma/semilla.js';
import { cerrarConexiones, prisma } from '../src/lib/db.js';
import { reiniciarLimitadores } from '../src/modules/auth/service.js';
import { ClienteHttp } from './cliente-http.js';

/**
 * LO QUE ME DEBEN (Etapa 2, Fase 12a): compras en acopio.
 *
 * Marcelo paga 100 bolsas y le entregan por tandas. Cada test crea su propio
 * proveedor, y mira en la respuesta SOLO lo de ese proveedor: la base de los
 * tests es compartida y otros tests dejan compras abiertas.
 */

let api: ClienteHttp;
let empresaId: string;
let centralId: string;
let laferrereId: string;
let unidadKgId: string;

beforeAll(async () => {
  api = await ClienteHttp.levantar();
  const empresa = await prisma.empresa.findFirstOrThrow({
    where: { nombre: 'Panadería Laferrere' },
    include: { sucursales: true, unidades: true },
  });
  empresaId = empresa.id;
  centralId = empresa.sucursales.find((s) => s.codigo === 'CEN')?.id ?? '';
  laferrereId = empresa.sucursales.find((s) => s.codigo === 'LAF')?.id ?? '';
  unidadKgId = empresa.unidades.find((u) => u.codigo === 'kg')?.id ?? '';
});

afterAll(async () => {
  await api.cerrar();
  await cerrarConexiones();
});

beforeEach(() => {
  reiniciarLimitadores();
  api.olvidarCookies();
});

// ===========================================================================
// Ayudas
// ===========================================================================

async function entrarComo(email: string, password = PASSWORD_DEV): Promise<void> {
  const r = await api.post('/api/auth/login', { email, password });
  expect(r.status, `login de ${email}`).toBe(200);
}

function codigoError(respuesta: { cuerpo: unknown }): string {
  return (respuesta.cuerpo as { codigo: string }).codigo;
}

function nombreNuevo(prefijo: string): string {
  return `${prefijo} ${String(Date.now())}-${String(Math.floor(Math.random() * 1000000))}`;
}

async function harinaNueva(): Promise<{ insumoId: string; bolsaId: string }> {
  const creado = await api.post('/api/insumos', {
    nombre: nombreNuevo('Harina acopio'),
    codigo: null,
    categoriaId: null,
    unidadBaseId: unidadKgId,
  });
  expect(creado.status).toBe(201);
  const insumoId = (creado.cuerpo as InsumoDetalle).id;
  const bolsa = await api.post(`/api/insumos/${insumoId}/presentaciones`, {
    nombre: 'Bolsa 25 kg',
    cantidadBase: '25',
  });
  expect(bolsa.status).toBe(201);
  const bolsaId =
    (bolsa.cuerpo as InsumoDetalle).presentaciones.find((p) => p.nombre === 'Bolsa 25 kg')?.id ??
    '';
  return { insumoId, bolsaId };
}

async function proveedorNuevo(): Promise<string> {
  const r = await api.post('/api/proveedores', { nombre: nombreNuevo('Proveedor acopio') });
  expect(r.status).toBe(201);
  return (r.cuerpo as ProveedorDetalle).id;
}

async function crearOrden(cuerpo: Record<string, unknown>): Promise<OrdenDetalle> {
  const r = await api.post('/api/ordenes-compra', cuerpo);
  expect(r.status, JSON.stringify(r.cuerpo)).toBe(201);
  return OrdenDetalleSchema.parse(r.cuerpo);
}

async function entregar(
  orden: OrdenDetalle,
  cantidad: string,
  extra: Record<string, unknown> = {},
): Promise<void> {
  const linea = orden.lineas[0];
  const r = await api.post(`/api/ordenes-compra/${orden.id}/recepciones`, {
    lineas: [{ lineaOrdenId: linea?.id, cantidad, precioUnitario: linea?.precioUnitario ?? '1' }],
    ...extra,
  });
  expect(r.status, JSON.stringify(r.cuerpo)).toBe(201);
}

async function meDeben(): Promise<LoQueMeDeben> {
  const r = await api.get('/api/acopio/me-deben');
  expect(r.status, JSON.stringify(r.cuerpo)).toBe(200);
  return LoQueMeDebenSchema.parse(r.cuerpo);
}

/** Cien bolsas a $20.000, pedidas a un proveedor nuevo. */
async function compraDe100Bolsas(precio: string | null = '20000') {
  const { insumoId, bolsaId } = await harinaNueva();
  const proveedorId = await proveedorNuevo();
  const orden = await crearOrden({
    sucursalId: centralId,
    proveedorId,
    lineas: [{ insumoId, presentacionId: bolsaId, cantidad: '100', precioUnitario: precio }],
  });
  return { orden, proveedorId, insumoId };
}

// ===========================================================================

describe('lo que me deben', () => {
  it('✅ compró 100 bolsas, llegaron 20 y 20 → le deben 60 bolsas ($1.200.000)', async () => {
    await entrarComo('dueno@panaderia.test');
    const { orden, proveedorId } = await compraDe100Bolsas();

    await entregar(orden, '20');
    await entregar(orden, '20');

    const deudas = await meDeben();
    const deuda = deudas.proveedores.find((d) => d.proveedor.id === proveedorId);
    expect(deuda?.renglones).toHaveLength(1);
    expect(deuda?.renglones[0]?.pendiente).toBe('60');
    expect(deuda?.renglones[0]?.pendienteBase).toBe('1500');
    expect(deuda?.renglones[0]?.presentacion?.nombre).toBe('Bolsa 25 kg');
    expect(deuda?.renglones[0]?.ordenNumero).toBe(orden.numero);
    expect(deuda?.valorPendiente).toBe('1200000');

    const abierta = deudas.comprasAbiertas.find((c) => c.id === orden.id);
    expect(abierta?.estado).toBe('PARCIAL');
    expect(abierta?.total).toBe('2000000');
    expect(abierta?.valorRecibido).toBe('800000');
    expect(abierta?.valorPendiente).toBe('1200000');
    expect(abierta?.diasAbierta).toBe(0);
  });

  it('una compra completa ya no figura', async () => {
    await entrarComo('dueno@panaderia.test');
    const { orden, proveedorId } = await compraDe100Bolsas();
    await entregar(orden, '100');

    const deudas = await meDeben();
    expect(deudas.proveedores.find((d) => d.proveedor.id === proveedorId)).toBeUndefined();
    expect(deudas.comprasAbiertas.find((c) => c.id === orden.id)).toBeUndefined();
  });

  it('una compra cerrada con faltante tampoco: lo que falta ya no va a llegar', async () => {
    await entrarComo('dueno@panaderia.test');
    const { orden, proveedorId } = await compraDe100Bolsas();
    await entregar(orden, '30');
    const cerrada = await api.post(`/api/ordenes-compra/${orden.id}/cerrar`, {
      nota: 'no hay más',
    });
    expect(cerrada.status).toBe(200);

    const deudas = await meDeben();
    expect(deudas.proveedores.find((d) => d.proveedor.id === proveedorId)).toBeUndefined();
  });

  it('sin precio: la cantidad se ve, la plata no, y avisa cuántos renglones faltan', async () => {
    await entrarComo('dueno@panaderia.test');
    const { orden, proveedorId } = await compraDe100Bolsas(null);

    const deudas = await meDeben();
    const deuda = deudas.proveedores.find((d) => d.proveedor.id === proveedorId);
    expect(deuda?.renglones[0]?.pendiente).toBe('100');
    expect(deuda?.renglones[0]?.valorPendiente).toBeNull();
    expect(deuda?.renglonesSinPrecio).toBe(1);
    expect(deudas.comprasAbiertas.find((c) => c.id === orden.id)?.total).toBeNull();
  });

  it('el total suma todas las compras abiertas, de todos los proveedores', async () => {
    await entrarComo('dueno@panaderia.test');
    const antes = await meDeben();
    const { orden } = await compraDe100Bolsas('1000');
    await entregar(orden, '10');

    const despues = await meDeben();
    // 90 bolsas a $1.000 más que antes.
    expect(Number(despues.valorPendiente) - Number(antes.valorPendiente)).toBe(90000);
  });

  it('el empleado no ve plata: 403', async () => {
    await entrarComo('empleado@panaderia.test');
    const r = await api.get('/api/acopio/me-deben');
    expect(r.status).toBe(403);
  });
});

describe('cada entrega elige su sucursal (C-28)', () => {
  it('una compra para Catán puede entregarse en Laferrere, y lo que falta se cuenta igual', async () => {
    await entrarComo('dueno@panaderia.test');
    const { orden, insumoId, proveedorId } = await compraDe100Bolsas();

    await entregar(orden, '20', { sucursalId: laferrereId });
    await entregar(orden, '20');

    const stock = async (sucursalId: string) =>
      (
        await prisma.movimientoStock.aggregate({
          where: { empresaId, sucursalId, insumoId },
          _sum: { cantidadBase: true },
        })
      )._sum.cantidadBase?.toString() ?? '0';
    expect(await stock(laferrereId)).toBe('500');
    expect(await stock(centralId)).toBe('500');

    const deuda = (await meDeben()).proveedores.find((d) => d.proveedor.id === proveedorId);
    expect(deuda?.renglones[0]?.pendiente).toBe('60');
  });

  it('la recepción dice a qué sucursal llegó', async () => {
    await entrarComo('dueno@panaderia.test');
    const { orden } = await compraDe100Bolsas();
    const r = await api.post(`/api/ordenes-compra/${orden.id}/recepciones`, {
      sucursalId: laferrereId,
      lineas: [{ lineaOrdenId: orden.lineas[0]?.id, cantidad: '5', precioUnitario: '20000' }],
    });
    expect(r.status).toBe(201);
    expect(RecepcionDetalleSchema.parse(r.cuerpo).sucursal.id).toBe(laferrereId);
  });

  it('no se puede entregar en una sucursal de otra empresa', async () => {
    await entrarComo('dueno@panaderia.test');
    const { orden } = await compraDe100Bolsas();
    const ajena = await prisma.sucursal.findFirstOrThrow({ where: { codigo: 'UNI' } });

    const r = await api.post(`/api/ordenes-compra/${orden.id}/recepciones`, {
      sucursalId: ajena.id,
      lineas: [{ lineaOrdenId: orden.lineas[0]?.id, cantidad: '5', precioUnitario: '20000' }],
    });
    expect(r.status).toBe(403);
    expect(codigoError(r)).toBe('SUCURSAL_NO_PERMITIDA');
  });
});

describe('mi cuenta: contraseña y email', () => {
  /** Un usuario propio para cada test, así no se tocan los de la semilla. */
  async function usuarioNuevo(): Promise<{ email: string; password: string }> {
    await entrarComo('dueno@panaderia.test');
    const email = `${nombreNuevo('cuenta').replace(/\W+/g, '-').toLowerCase()}@panaderia.test`;
    const password = 'clave-inicial-1';
    const r = await api.post('/api/usuarios', {
      email,
      nombre: 'Cuenta de prueba',
      rol: 'ENCARGADO',
      password,
      sucursalIds: [centralId],
    });
    expect(r.status, JSON.stringify(r.cuerpo)).toBe(201);
    api.olvidarCookies();
    return { email, password };
  }

  it('cambia la contraseña: la vieja deja de andar, la nueva anda, y las otras sesiones se cierran', async () => {
    const { email, password } = await usuarioNuevo();

    // Una sesión "en otra computadora".
    const otra = await ClienteHttp.levantar();
    expect((await otra.post('/api/auth/login', { email, password })).status).toBe(200);

    await entrarComo(email, password);
    const cambio = await api.post('/api/auth/password', {
      actual: password,
      nueva: 'clave-nueva-2',
    });
    expect(cambio.status, JSON.stringify(cambio.cuerpo)).toBe(204);

    // La sesión desde la que se cambió sigue; la otra quedó afuera.
    expect((await api.get('/api/auth/me')).status).toBe(200);
    expect((await otra.get('/api/auth/me')).status).toBe(401);
    await otra.cerrar();

    api.olvidarCookies();
    expect((await api.post('/api/auth/login', { email, password })).status).toBe(401);
    expect((await api.post('/api/auth/login', { email, password: 'clave-nueva-2' })).status).toBe(
      200,
    );

    const auditada = await prisma.auditoria.findFirst({
      where: {
        entidad: 'usuario',
        accion: 'ACTUALIZAR',
        datosDespues: { path: ['cambio'], equals: 'password' },
      },
      orderBy: { createdAt: 'desc' },
    });
    expect(auditada).not.toBeNull();
    // Nunca la contraseña ni su hash.
    expect(JSON.stringify(auditada)).not.toMatch(/clave-nueva|scrypt/);
  });

  it('con la contraseña actual equivocada no cambia nada, y el error va al campo', async () => {
    const { email, password } = await usuarioNuevo();
    await entrarComo(email, password);

    const r = await api.post('/api/auth/password', { actual: 'no-es', nueva: 'clave-nueva-2' });
    expect(r.status).toBe(400);
    expect(codigoError(r)).toBe('PASSWORD_INCORRECTA');
    expect((r.cuerpo as { detalles: Record<string, string> }).detalles.actual).toBeDefined();

    api.olvidarCookies();
    expect((await api.post('/api/auth/login', { email, password })).status).toBe(200);
  });

  it('adivinar la contraseña actual tiene el mismo límite que el login', async () => {
    const { email, password } = await usuarioNuevo();
    await entrarComo(email, password);

    for (let intento = 0; intento < 5; intento += 1) {
      const r = await api.post('/api/auth/password', {
        actual: `mal-${String(intento)}`,
        nueva: 'x'.repeat(10),
      });
      expect(r.status).toBe(400);
    }
    const bloqueado = await api.post('/api/auth/password', {
      actual: password,
      nueva: 'x'.repeat(10),
    });
    expect(bloqueado.status).toBe(429);
  });

  it('cambia el email y entra con el nuevo; uno que ya existe se rechaza', async () => {
    const { email, password } = await usuarioNuevo();
    await entrarComo(email, password);

    const repetido = await api.post('/api/auth/email', { email: 'dueno@panaderia.test', password });
    expect(repetido.status).toBe(409);
    expect(codigoError(repetido)).toBe('EMAIL_DUPLICADO');

    const nuevo = `NUEVO-${email}`;
    const r = await api.post('/api/auth/email', { email: nuevo, password });
    expect(r.status, JSON.stringify(r.cuerpo)).toBe(200);
    // Se guarda normalizado: en minúsculas.
    expect((r.cuerpo as UsuarioSesion).email).toBe(nuevo.toLowerCase());

    api.olvidarCookies();
    expect((await api.post('/api/auth/login', { email, password })).status).toBe(401);
    expect((await api.post('/api/auth/login', { email: nuevo, password })).status).toBe(200);
  });

  it('sin sesión, no se puede cambiar nada', async () => {
    expect(
      (await api.post('/api/auth/password', { actual: 'a', nueva: 'abcdefghij' })).status,
    ).toBe(401);
    expect((await api.post('/api/auth/email', { email: 'x@y.com', password: 'a' })).status).toBe(
      401,
    );
  });
});
