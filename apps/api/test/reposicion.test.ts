import type { InsumoDetalle, Reposicion, ResumenAlertas } from '@panaderia/shared';
import { ReposicionSchema } from '@panaderia/shared';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { PASSWORD_DEV } from '../prisma/semilla.js';
import { cerrarConexiones, prisma } from '../src/lib/db.js';
import { reiniciarLimitadores } from '../src/modules/auth/service.js';
import { ClienteHttp } from './cliente-http.js';

/**
 * REPOSICIÓN (Fase 10): qué hay que traer, de dónde y cuánto.
 *
 * Cada test crea su propio insumo: la base de prueba la comparten todos los
 * archivos y otros tests también configuran mínimos.
 */

let api: ClienteHttp;
let centralId: string;
let laferrereId: string;
let unidadKgId: string;

beforeAll(async () => {
  api = await ClienteHttp.levantar();
  const empresa = await prisma.empresa.findFirstOrThrow({
    where: { nombre: 'Panadería Laferrere' },
    include: { sucursales: true, unidades: true },
  });
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

async function entrarComo(email: string): Promise<void> {
  const r = await api.post('/api/auth/login', { email, password: PASSWORD_DEV });
  expect(r.status, `login de ${email}`).toBe(200);
}

let contador = 0;
/** Un insumo en kg con "Bolsa 25 kg" y un proveedor preferido que la vende a $25.000. */
async function harinaConProveedor(): Promise<{
  insumoId: string;
  bolsaId: string;
  proveedorId: string;
}> {
  contador += 1;
  const sufijo = `${String(Date.now())}-${String(contador)}`;
  const creado = await api.post('/api/insumos', {
    nombre: `Harina reposición ${sufijo}`,
    unidadBaseId: unidadKgId,
  });
  const insumoId = (creado.cuerpo as InsumoDetalle).id;
  const conBolsa = await api.post(`/api/insumos/${insumoId}/presentaciones`, {
    nombre: 'Bolsa 25 kg',
    cantidadBase: '25',
  });
  const bolsaId =
    (conBolsa.cuerpo as InsumoDetalle).presentaciones.find((p) => p.nombre === 'Bolsa 25 kg')?.id ??
    '';
  const proveedor = await api.post('/api/proveedores', {
    nombre: `Proveedor reposición ${sufijo}`,
  });
  const proveedorId = (proveedor.cuerpo as { id: string }).id;
  const asociacion = await api.post(`/api/proveedores/${proveedorId}/insumos`, {
    insumoId,
    presentacionId: bolsaId,
    ultimoPrecio: '25000',
    esPreferido: true,
  });
  expect(asociacion.status).toBe(201);
  return { insumoId, bolsaId, proveedorId };
}

async function conSaldo(insumoId: string, sucursalId: string, cantidad: string) {
  const r = await api.post('/api/movimientos/saldo-inicial', {
    sucursalId,
    lineas: [{ insumoId, cantidad }],
  });
  expect(r.status).toBe(201);
}

async function minimo(
  insumoId: string,
  sucursalId: string,
  stockMinimo: string,
  stockMaximo?: string,
) {
  const r = await api.pedir('PUT', `/api/insumos/${insumoId}/sucursales/${sucursalId}`, {
    stockMinimo,
    stockMaximo: stockMaximo ?? null,
    activo: true,
  });
  expect(r.status, JSON.stringify(r.cuerpo)).toBe(200);
}

async function reposicion(query = ''): Promise<Reposicion> {
  const r = await api.get(`/api/reposicion${query}`);
  expect(r.status, JSON.stringify(r.cuerpo)).toBe(200);
  return ReposicionSchema.parse(r.cuerpo);
}

// ===========================================================================

describe('qué hay que reponer', () => {
  it('✅ mínimo 50 teniendo 40 → aparece, bajo su proveedor preferido, sugiriendo bultos enteros', async () => {
    await entrarComo('dueno@panaderia.test');
    const { insumoId, proveedorId } = await harinaConProveedor();
    await conSaldo(insumoId, centralId, '40');
    await minimo(insumoId, centralId, '50', '100');

    const datos = await reposicion();
    const item = datos.items.find((i) => i.insumo.id === insumoId);
    expect(item?.estado).toBe('BAJO');
    expect(item?.sucursal.codigo).toBe('CEN');
    // Hasta el máximo: faltan 60 → 3 bolsas de 25 (75 kg), a $25.000.
    expect(item?.faltante).toBe('60');
    expect(item?.compra?.bultos).toBe('3');
    expect(item?.compra?.cantidadBase).toBe('75');
    expect(item?.compra?.subtotal).toBe('75000');

    const grupo = datos.compras.find(
      (c) => c.proveedor?.id === proveedorId && c.sucursal.id === centralId,
    );
    expect(grupo?.lineas.map((l) => l.insumo.id)).toEqual([insumoId]);
    expect(grupo?.totalEstimado).toBe('75000');
  });

  it('✅ un insumo en 0 aparece como crítico, arriba de los demás', async () => {
    await entrarComo('dueno@panaderia.test');
    const bajo = await harinaConProveedor();
    const vacio = await harinaConProveedor();
    await conSaldo(bajo.insumoId, centralId, '40');
    await minimo(bajo.insumoId, centralId, '50');
    await minimo(vacio.insumoId, centralId, '10');

    const datos = await reposicion();
    const posicion = (id: string) => datos.items.findIndex((i) => i.insumo.id === id);
    expect(datos.items[posicion(vacio.insumoId)]?.estado).toBe('CRITICO');
    expect(posicion(vacio.insumoId)).toBeLessThan(posicion(bajo.insumoId));
    // Y todos los críticos están antes que cualquier bajo.
    const estados = datos.items.map((i) => i.estado);
    expect(estados.indexOf('BAJO')).toBeGreaterThan(estados.lastIndexOf('CRITICO'));
  });

  it('un insumo sin mínimo no aparece, aunque no tenga stock', async () => {
    await entrarComo('dueno@panaderia.test');
    const { insumoId } = await harinaConProveedor();
    const datos = await reposicion();
    expect(datos.items.some((i) => i.insumo.id === insumoId)).toBe(false);
  });

  it('✅ con una orden pendiente por 100 kg, se muestra "ya pedido" y no se pide dos veces', async () => {
    await entrarComo('dueno@panaderia.test');
    const { insumoId, bolsaId, proveedorId } = await harinaConProveedor();
    await conSaldo(insumoId, centralId, '40');
    await minimo(insumoId, centralId, '50', '140');

    const orden = await api.post('/api/ordenes-compra', {
      sucursalId: centralId,
      proveedorId,
      lineas: [{ insumoId, presentacionId: bolsaId, cantidad: '4' }],
    });
    expect(orden.status).toBe(201);

    const item = (await reposicion()).items.find((i) => i.insumo.id === insumoId);
    expect(item?.yaPedido).toBe('100');
    // 140 − 40 − 100 = 0: está en alerta hoy, pero ya está resuelto.
    expect(item?.faltante).toBe('0');
    expect(item?.compra).toBeNull();
  });

  it('lo que ya llegó de una orden deja de contar como pedido', async () => {
    await entrarComo('dueno@panaderia.test');
    const { insumoId, bolsaId, proveedorId } = await harinaConProveedor();
    await minimo(insumoId, centralId, '200');
    const orden = await api.post('/api/ordenes-compra', {
      sucursalId: centralId,
      proveedorId,
      lineas: [{ insumoId, presentacionId: bolsaId, cantidad: '4', precioUnitario: '25000' }],
    });
    const lineaId = (orden.cuerpo as { lineas: { id: string }[] }).lineas[0]?.id;
    await api.post(`/api/ordenes-compra/${(orden.cuerpo as { id: string }).id}/recepciones`, {
      lineas: [{ lineaOrdenId: lineaId, cantidad: '1', precioUnitario: '25000' }],
    });

    const item = (await reposicion()).items.find((i) => i.insumo.id === insumoId);
    // Llegó 1 bolsa (25 kg, ya está en el saldo) y faltan 3 (75 kg pedidos).
    expect(item?.saldo).toBe('25');
    expect(item?.yaPedido).toBe('75');
    expect(item?.faltante).toBe('100');
  });
});

describe('la Central abastece a Laferrere', () => {
  it('lo que le sobra a la Central se transfiere; el resto se compra', async () => {
    await entrarComo('dueno@panaderia.test');
    const { insumoId } = await harinaConProveedor();
    await conSaldo(insumoId, centralId, '120');
    await minimo(insumoId, centralId, '100');
    await conSaldo(insumoId, laferrereId, '10');
    await minimo(insumoId, laferrereId, '50', '80');

    const datos = await reposicion();
    const item = datos.items.find((i) => i.insumo.id === insumoId);
    expect(item?.sucursal.codigo).toBe('LAF');
    expect(item?.faltante).toBe('70');
    expect(item?.desdeCentral).toBe('20');
    expect(item?.aComprar).toBe('50');
    expect(item?.compra?.bultos).toBe('2');

    const transferencia = datos.transferencias.find((t) => t.destino.id === laferrereId);
    expect(transferencia?.lineas.find((l) => l.insumo.id === insumoId)?.cantidadBase).toBe('20');
    expect(datos.central?.codigo).toBe('CEN');
    // La Central no está en alerta: no compra nada para sí.
    expect(datos.items.some((i) => i.insumo.id === insumoId && i.sucursal.codigo === 'CEN')).toBe(
      false,
    );
  });

  it('lo que viene en una transferencia en tránsito se descuenta', async () => {
    await entrarComo('dueno@panaderia.test');
    const { insumoId } = await harinaConProveedor();
    await conSaldo(insumoId, centralId, '30');
    await minimo(insumoId, laferrereId, '50');
    const enviada = await api.post('/api/transferencias', {
      sucursalOrigenId: centralId,
      sucursalDestinoId: laferrereId,
      lineas: [{ insumoId, cantidad: '30' }],
    });
    expect(enviada.status).toBe(201);

    const item = (await reposicion()).items.find((i) => i.insumo.id === insumoId);
    expect(item?.enCamino).toBe('30');
    expect(item?.faltante).toBe('20');
  });
});

describe('cada sucursal con lo suyo', () => {
  it('✅ la alerta de una sucursal no mezcla insumos de la otra', async () => {
    await entrarComo('dueno@panaderia.test');
    const { insumoId } = await harinaConProveedor();
    await minimo(insumoId, centralId, '10');

    const deLaferrere = await reposicion(`?sucursalId=${laferrereId}`);
    expect(deLaferrere.items.every((i) => i.sucursal.id === laferrereId)).toBe(true);
    expect(deLaferrere.items.some((i) => i.insumo.id === insumoId)).toBe(false);
    expect(deLaferrere.compras.every((c) => c.sucursal.id === laferrereId)).toBe(true);
  });

  it('el encargado de una sola sucursal ve solo la suya', async () => {
    await entrarComo('dueno@panaderia.test');
    const { insumoId } = await harinaConProveedor();
    await minimo(insumoId, centralId, '10');
    const email = `encargado-repo-${String(Date.now())}@panaderia.test`;
    await api.post('/api/usuarios', {
      email,
      nombre: 'Encargado Laferrere',
      rol: 'ENCARGADO',
      password: PASSWORD_DEV,
      sucursalIds: [laferrereId],
    });

    api.olvidarCookies();
    await entrarComo(email);
    const datos = await reposicion();
    expect(datos.items.every((i) => i.sucursal.id === laferrereId)).toBe(true);
    expect((await api.get(`/api/reposicion?sucursalId=${centralId}`)).status).toBe(403);
  });

  it('el empleado no ve la reposición (tiene precios), pero sí el número de alertas', async () => {
    await entrarComo('empleado@panaderia.test');
    expect((await api.get('/api/reposicion')).status).toBe(403);
    const me = (await api.get('/api/auth/me')).cuerpo as { sucursales: { id: string }[] };
    const r = await api.get(`/api/alertas?sucursalId=${me.sucursales[0]?.id ?? ''}`);
    expect(r.status).toBe(200);
  });

  it('el número de alertas cuenta solo los insumos con mínimo', async () => {
    await entrarComo('dueno@panaderia.test');
    const antes = (await api.get(`/api/alertas?sucursalId=${laferrereId}`))
      .cuerpo as ResumenAlertas;
    const critico = await harinaConProveedor();
    const bajo = await harinaConProveedor();
    await harinaConProveedor(); // sin mínimo: no cuenta
    await minimo(critico.insumoId, laferrereId, '10');
    await conSaldo(bajo.insumoId, laferrereId, '5');
    await minimo(bajo.insumoId, laferrereId, '10');

    const despues = (await api.get(`/api/alertas?sucursalId=${laferrereId}`))
      .cuerpo as ResumenAlertas;
    expect(despues.critico - antes.critico).toBe(1);
    expect(despues.bajo - antes.bajo).toBe(1);
  });
});

describe('✅ de la reposición a la orden de compra', () => {
  it('el grupo de un proveedor se convierte en una orden, y después figura como pedido', async () => {
    await entrarComo('dueno@panaderia.test');
    const { insumoId, proveedorId } = await harinaConProveedor();
    await conSaldo(insumoId, centralId, '10');
    await minimo(insumoId, centralId, '50');

    const grupo = (await reposicion()).compras.find(
      (c) => c.proveedor?.id === proveedorId && c.sucursal.id === centralId,
    );
    expect(grupo).toBeDefined();

    // Lo mismo que hace el botón "Crear orden con esto" de la pantalla.
    const orden = await api.post('/api/ordenes-compra', {
      sucursalId: grupo?.sucursal.id,
      proveedorId: grupo?.proveedor?.id,
      lineas: (grupo?.lineas ?? []).map((l) => ({
        insumoId: l.insumo.id,
        presentacionId: l.presentacion?.id ?? null,
        cantidad: l.bultos,
        precioUnitario: l.precioUnitario,
      })),
    });
    expect(orden.status, JSON.stringify(orden.cuerpo)).toBe(201);

    const item = (await reposicion()).items.find((i) => i.insumo.id === insumoId);
    // Faltaban 40 → 2 bolsas (50 kg) pedidas: ya no falta nada.
    expect(item?.yaPedido).toBe('50');
    expect(item?.compra).toBeNull();
  });
});
