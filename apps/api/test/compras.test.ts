import type {
  CostoInsumo,
  HistorialMovimientos,
  InsumoDetalle,
  OrdenDetalle,
  Plantilla,
  ProveedorDeInsumo,
  ProveedorDetalle,
  RecepcionDetalle,
} from '@panaderia/shared';
import { OrdenDetalleSchema, RecepcionDetalleSchema } from '@panaderia/shared';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { PASSWORD_DEV } from '../prisma/semilla.js';
import { cerrarConexiones, prisma } from '../src/lib/db.js';
import { reiniciarLimitadores } from '../src/modules/auth/service.js';
import { ClienteHttp } from './cliente-http.js';

/**
 * COMPRAS (Fase 8): órdenes, recepciones parciales y costo promedio.
 *
 * Los criterios de "Terminado cuando" de PLAN.md están marcados con ✅ en el
 * nombre del test. Cada test crea su propio insumo y su propio proveedor, así
 * no dependen del orden en que corren.
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

async function entrarComo(email: string): Promise<void> {
  const r = await api.post('/api/auth/login', { email, password: PASSWORD_DEV });
  expect(r.status, `login de ${email}`).toBe(200);
}

function codigoError(respuesta: { cuerpo: unknown }): string {
  return (respuesta.cuerpo as { codigo: string }).codigo;
}

function nombreNuevo(prefijo: string): string {
  return `${prefijo} ${String(Date.now())}-${String(Math.floor(Math.random() * 1000000))}`;
}

/** Un insumo en kg con su "Bolsa 25 kg", nuevo para cada test. */
async function harinaNueva(): Promise<{ insumoId: string; bolsaId: string }> {
  const creado = await api.post('/api/insumos', {
    nombre: nombreNuevo('Harina compra'),
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
  const detalle = bolsa.cuerpo as InsumoDetalle;
  const bolsaId = detalle.presentaciones.find((p) => p.nombre === 'Bolsa 25 kg')?.id ?? '';
  return { insumoId, bolsaId };
}

async function proveedorNuevo(): Promise<string> {
  const r = await api.post('/api/proveedores', { nombre: nombreNuevo('Proveedor de prueba') });
  expect(r.status).toBe(201);
  return (r.cuerpo as ProveedorDetalle).id;
}

async function crearOrden(cuerpo: Record<string, unknown>): Promise<OrdenDetalle> {
  const r = await api.post('/api/ordenes-compra', cuerpo);
  expect(r.status, JSON.stringify(r.cuerpo)).toBe(201);
  return OrdenDetalleSchema.parse(r.cuerpo);
}

async function orden(id: string): Promise<OrdenDetalle> {
  const r = await api.get(`/api/ordenes-compra/${id}`);
  expect(r.status).toBe(200);
  return OrdenDetalleSchema.parse(r.cuerpo);
}

async function recibirDirecta(cuerpo: Record<string, unknown>): Promise<RecepcionDetalle> {
  const r = await api.post('/api/recepciones', cuerpo);
  expect(r.status, JSON.stringify(r.cuerpo)).toBe(201);
  return RecepcionDetalleSchema.parse(r.cuerpo);
}

async function saldo(insumoId: string, sucursalId = centralId): Promise<string> {
  const agregado = await prisma.movimientoStock.aggregate({
    where: { empresaId, sucursalId, insumoId },
    _sum: { cantidadBase: true },
  });
  return agregado._sum.cantidadBase?.toString() ?? '0';
}

async function costo(insumoId: string): Promise<string | null> {
  const r = await api.get(`/api/insumos/${insumoId}/costo`);
  expect(r.status).toBe(200);
  return (r.cuerpo as CostoInsumo).costoPromedio;
}

// ===========================================================================

describe('orden de compra con recepción parcial', () => {
  it('✅ 10 bolsas pedidas, llegan 4 → +100 kg y PARCIAL con 6 pendientes; llegan 6 → RECIBIDA', async () => {
    await entrarComo('dueno@panaderia.test');
    const { insumoId, bolsaId } = await harinaNueva();
    const proveedorId = await proveedorNuevo();

    const creada = await crearOrden({
      sucursalId: centralId,
      proveedorId,
      lineas: [{ insumoId, presentacionId: bolsaId, cantidad: '10', precioUnitario: '25000' }],
    });
    expect(creada.estado).toBe('PEDIDA');
    expect(creada.lineas[0]?.cantidadBase).toBe('250');
    // Pedir NO mueve stock.
    expect(await saldo(insumoId)).toBe('0');

    const lineaId = creada.lineas[0]?.id ?? '';
    const primera = await api.post(`/api/ordenes-compra/${creada.id}/recepciones`, {
      numeroRemito: '0001-00004567',
      lineas: [{ lineaOrdenId: lineaId, cantidad: '4', precioUnitario: '25000' }],
    });
    expect(primera.status, JSON.stringify(primera.cuerpo)).toBe(201);

    expect(await saldo(insumoId)).toBe('100');
    let actual = await orden(creada.id);
    expect(actual.estado).toBe('PARCIAL');
    expect(actual.lineas[0]?.pendiente).toBe('6');
    expect(actual.lineas[0]?.pendienteBase).toBe('150');
    // Cancelar ya no: llegó una parte. Lo que corresponde es cerrar.
    expect(actual.acciones).toEqual(['recibir', 'cerrar']);

    const segunda = await api.post(`/api/ordenes-compra/${creada.id}/recepciones`, {
      lineas: [{ lineaOrdenId: lineaId, cantidad: '6', precioUnitario: '25000' }],
    });
    expect(segunda.status).toBe(201);

    expect(await saldo(insumoId)).toBe('250');
    actual = await orden(creada.id);
    expect(actual.estado).toBe('RECIBIDA');
    expect(actual.lineas[0]?.pendiente).toBe('0');
    expect(actual.recepciones).toHaveLength(2);
    expect(actual.acciones).toEqual([]);
  });

  it('no se puede recibir más de lo que falta', async () => {
    await entrarComo('dueno@panaderia.test');
    const { insumoId, bolsaId } = await harinaNueva();
    const proveedorId = await proveedorNuevo();
    const creada = await crearOrden({
      sucursalId: centralId,
      proveedorId,
      lineas: [{ insumoId, presentacionId: bolsaId, cantidad: '10', precioUnitario: '25000' }],
    });
    const lineaId = creada.lineas[0]?.id ?? '';

    await api.post(`/api/ordenes-compra/${creada.id}/recepciones`, {
      lineas: [{ lineaOrdenId: lineaId, cantidad: '4', precioUnitario: '25000' }],
    });
    const demas = await api.post(`/api/ordenes-compra/${creada.id}/recepciones`, {
      lineas: [{ lineaOrdenId: lineaId, cantidad: '7', precioUnitario: '25000' }],
    });

    expect(demas.status).toBe(409);
    expect(codigoError(demas)).toBe('CANTIDAD_MAYOR_A_PENDIENTE');
    expect((demas.cuerpo as { mensaje: string }).mensaje).toMatch(/faltan 6 y querés recibir 7/);
    // Y no entró nada: la transacción se deshizo entera.
    expect(await saldo(insumoId)).toBe('100');
  });

  it('una línea de OTRA orden no se puede recibir acá', async () => {
    await entrarComo('dueno@panaderia.test');
    const a = await harinaNueva();
    const proveedorId = await proveedorNuevo();
    const ordenA = await crearOrden({
      sucursalId: centralId,
      proveedorId,
      lineas: [{ insumoId: a.insumoId, presentacionId: a.bolsaId, cantidad: '1' }],
    });
    const ordenB = await crearOrden({
      sucursalId: centralId,
      proveedorId,
      lineas: [{ insumoId: a.insumoId, presentacionId: a.bolsaId, cantidad: '1' }],
    });

    const r = await api.post(`/api/ordenes-compra/${ordenA.id}/recepciones`, {
      lineas: [{ lineaOrdenId: ordenB.lineas[0]?.id, cantidad: '1', precioUnitario: '1' }],
    });
    expect(r.status).toBe(400);
  });

  it('el precio de la orden se puede corregir al recibir (C-9)', async () => {
    await entrarComo('dueno@panaderia.test');
    const { insumoId, bolsaId } = await harinaNueva();
    const proveedorId = await proveedorNuevo();
    const creada = await crearOrden({
      sucursalId: centralId,
      proveedorId,
      lineas: [{ insumoId, presentacionId: bolsaId, cantidad: '2', precioUnitario: '25000' }],
    });

    const r = await api.post(`/api/ordenes-compra/${creada.id}/recepciones`, {
      lineas: [{ lineaOrdenId: creada.lineas[0]?.id, cantidad: '2', precioUnitario: '27500' }],
    });
    expect(r.status).toBe(201);
    // El costo es el que se PAGÓ, no el que se había pedido.
    expect(await costo(insumoId)).toBe('1100');
  });
});

describe('la máquina de estados de la orden', () => {
  it('un borrador no se recibe; al pedirlo, sí', async () => {
    await entrarComo('dueno@panaderia.test');
    const { insumoId, bolsaId } = await harinaNueva();
    const proveedorId = await proveedorNuevo();

    const borrador = await crearOrden({
      sucursalId: centralId,
      proveedorId,
      pedir: false,
      lineas: [{ insumoId, presentacionId: bolsaId, cantidad: '2' }],
    });
    expect(borrador.estado).toBe('BORRADOR');
    expect(borrador.pedidaAt).toBeNull();

    const antes = await api.post(`/api/ordenes-compra/${borrador.id}/recepciones`, {
      lineas: [{ lineaOrdenId: borrador.lineas[0]?.id, cantidad: '2', precioUnitario: '25000' }],
    });
    expect(antes.status).toBe(409);
    expect(codigoError(antes)).toBe('TRANSICION_INVALIDA');
    expect((antes.cuerpo as { mensaje: string }).mensaje).toMatch(/Marcala como pedida/);

    const pedida = await api.post(`/api/ordenes-compra/${borrador.id}/pedir`);
    expect(pedida.status).toBe(200);
    expect((pedida.cuerpo as OrdenDetalle).estado).toBe('PEDIDA');

    // Pedirla dos veces no: ya no es borrador.
    const otraVez = await api.post(`/api/ordenes-compra/${borrador.id}/pedir`);
    expect(otraVez.status).toBe(409);
  });

  it('se edita mientras no llegó nada; después, no', async () => {
    await entrarComo('dueno@panaderia.test');
    const { insumoId, bolsaId } = await harinaNueva();
    const proveedorId = await proveedorNuevo();
    const creada = await crearOrden({
      sucursalId: centralId,
      proveedorId,
      lineas: [{ insumoId, presentacionId: bolsaId, cantidad: '10' }],
    });

    const editada = await api.pedir('PUT', `/api/ordenes-compra/${creada.id}`, {
      sucursalId: centralId,
      proveedorId,
      fechaEntregaEstimada: '2026-12-01',
      lineas: [{ insumoId, presentacionId: bolsaId, cantidad: '8', precioUnitario: '24000' }],
    });
    expect(editada.status, JSON.stringify(editada.cuerpo)).toBe(200);
    const despues = editada.cuerpo as OrdenDetalle;
    expect(despues.lineas[0]?.cantidad).toBe('8');
    expect(despues.fechaEntregaEstimada).toBe('2026-12-01');
    expect(despues.numero).toBe(creada.numero);

    await api.post(`/api/ordenes-compra/${creada.id}/recepciones`, {
      lineas: [{ lineaOrdenId: despues.lineas[0]?.id, cantidad: '1', precioUnitario: '24000' }],
    });
    const tarde = await api.pedir('PUT', `/api/ordenes-compra/${creada.id}`, {
      sucursalId: centralId,
      proveedorId,
      lineas: [{ insumoId, presentacionId: bolsaId, cantidad: '20' }],
    });
    expect(tarde.status).toBe(409);
  });

  it('cancelar es solo sin recepciones; con una parte recibida, se CIERRA con faltante', async () => {
    await entrarComo('dueno@panaderia.test');
    const { insumoId, bolsaId } = await harinaNueva();
    const proveedorId = await proveedorNuevo();

    const aCancelar = await crearOrden({
      sucursalId: centralId,
      proveedorId,
      lineas: [{ insumoId, presentacionId: bolsaId, cantidad: '1' }],
    });
    // Cerrar con faltante sin que haya llegado nada no tiene sentido: es cancelar.
    expect((await api.post(`/api/ordenes-compra/${aCancelar.id}/cerrar`, {})).status).toBe(409);
    const cancelada = await api.post(`/api/ordenes-compra/${aCancelar.id}/cancelar`, {
      nota: 'Lo conseguí más barato en otro lado',
    });
    expect(cancelada.status).toBe(200);
    expect((cancelada.cuerpo as OrdenDetalle).estado).toBe('CANCELADA');
    expect((cancelada.cuerpo as OrdenDetalle).notaCierre).toBe(
      'Lo conseguí más barato en otro lado',
    );

    const parcial = await crearOrden({
      sucursalId: centralId,
      proveedorId,
      lineas: [{ insumoId, presentacionId: bolsaId, cantidad: '10' }],
    });
    await api.post(`/api/ordenes-compra/${parcial.id}/recepciones`, {
      lineas: [{ lineaOrdenId: parcial.lineas[0]?.id, cantidad: '4', precioUnitario: '25000' }],
    });
    const noCancela = await api.post(`/api/ordenes-compra/${parcial.id}/cancelar`, {});
    expect(noCancela.status).toBe(409);
    expect((noCancela.cuerpo as { mensaje: string }).mensaje).toMatch(/cerrala con faltante/);

    const cerrada = await api.post(`/api/ordenes-compra/${parcial.id}/cerrar`, {
      nota: 'El molino no tiene más',
    });
    expect(cerrada.status).toBe(200);
    const final = cerrada.cuerpo as OrdenDetalle;
    expect(final.estado).toBe('CERRADA');
    // Lo que faltó queda registrado: sirve para saber qué proveedor falla.
    expect(final.lineas[0]?.pendiente).toBe('6');

    // Y una orden cerrada ya no recibe nada.
    const tarde = await api.post(`/api/ordenes-compra/${parcial.id}/recepciones`, {
      lineas: [{ lineaOrdenId: parcial.lineas[0]?.id, cantidad: '1', precioUnitario: '25000' }],
    });
    expect(tarde.status).toBe(409);
  });

  it('una orden pedida con la fecha estimada vencida aparece atrasada (C-8)', async () => {
    await entrarComo('dueno@panaderia.test');
    const { insumoId, bolsaId } = await harinaNueva();
    const proveedorId = await proveedorNuevo();

    const atrasada = await crearOrden({
      sucursalId: centralId,
      proveedorId,
      fechaEntregaEstimada: '2020-01-01',
      lineas: [{ insumoId, presentacionId: bolsaId, cantidad: '1' }],
    });
    expect(atrasada.atrasada).toBe(true);

    const enFecha = await crearOrden({
      sucursalId: centralId,
      proveedorId,
      fechaEntregaEstimada: '2099-01-01',
      lineas: [{ insumoId, presentacionId: bolsaId, cantidad: '1' }],
    });
    expect(enFecha.atrasada).toBe(false);
  });

  it('el listado de pendientes trae solo lo que todavía se espera', async () => {
    await entrarComo('dueno@panaderia.test');
    const { insumoId, bolsaId } = await harinaNueva();
    const proveedorId = await proveedorNuevo();
    const borrador = await crearOrden({
      sucursalId: centralId,
      proveedorId,
      pedir: false,
      lineas: [{ insumoId, presentacionId: bolsaId, cantidad: '1' }],
    });
    const pedida = await crearOrden({
      sucursalId: centralId,
      proveedorId,
      lineas: [{ insumoId, presentacionId: bolsaId, cantidad: '1' }],
    });

    const r = await api.get(`/api/ordenes-compra?soloPendientes=true&proveedorId=${proveedorId}`);
    expect(r.status).toBe(200);
    const ids = (r.cuerpo as { items: { id: string }[] }).items.map((o) => o.id);
    expect(ids).toContain(pedida.id);
    expect(ids).not.toContain(borrador.id);
  });

  it('la presentación tiene que ser del insumo de la línea', async () => {
    await entrarComo('dueno@panaderia.test');
    const harina = await harinaNueva();
    const otra = await harinaNueva();
    const proveedorId = await proveedorNuevo();

    const r = await api.post('/api/ordenes-compra', {
      sucursalId: centralId,
      proveedorId,
      lineas: [{ insumoId: harina.insumoId, presentacionId: otra.bolsaId, cantidad: '1' }],
    });
    expect(r.status).toBe(400);
    expect((r.cuerpo as { detalles: Record<string, string> }).detalles).toHaveProperty(
      'lineas.0.presentacionId',
    );
  });

  it('los números de orden son correlativos por empresa', async () => {
    await entrarComo('dueno@panaderia.test');
    const { insumoId } = await harinaNueva();
    const proveedorId = await proveedorNuevo();
    const lineas = [{ insumoId, presentacionId: null, cantidad: '1' }];

    const a = await crearOrden({ sucursalId: centralId, proveedorId, lineas });
    const b = await crearOrden({ sucursalId: centralId, proveedorId, lineas });
    expect(b.numero).toBe(a.numero + 1);
  });
});

describe('costo promedio ponderado', () => {
  it('✅ 100 kg a $1.000 + 50 kg a $1.300 = $1.100/kg (el ejemplo de PLAN.md 3.7)', async () => {
    await entrarComo('dueno@panaderia.test');
    const { insumoId } = await harinaNueva();
    const proveedorId = await proveedorNuevo();

    expect(await costo(insumoId)).toBeNull();

    await recibirDirecta({
      sucursalId: centralId,
      proveedorId,
      lineas: [{ insumoId, presentacionId: null, cantidad: '100', precioUnitario: '1000' }],
    });
    expect(await costo(insumoId)).toBe('1000');

    const segunda = await recibirDirecta({
      sucursalId: centralId,
      proveedorId,
      lineas: [{ insumoId, presentacionId: null, cantidad: '50', precioUnitario: '1300' }],
    });
    expect(await costo(insumoId)).toBe('1100');
    // La respuesta de la recepción ya trae el costo nuevo.
    expect(segunda.costos[0]?.costoPromedio).toBe('1100');
  });

  it('✅ bolsa de 25 kg a $25.000 → costo unitario $1.000/kg', async () => {
    await entrarComo('dueno@panaderia.test');
    const { insumoId, bolsaId } = await harinaNueva();
    const proveedorId = await proveedorNuevo();

    const recepcion = await recibirDirecta({
      sucursalId: centralId,
      proveedorId,
      lineas: [{ insumoId, presentacionId: bolsaId, cantidad: '4', precioUnitario: '25000' }],
    });

    const linea = recepcion.lineas[0];
    expect(linea?.cantidadBase).toBe('100');
    expect(linea?.costoUnitarioBase).toBe('1000');
    expect(linea?.subtotal).toBe('100000');
    expect(recepcion.total).toBe('100000');
    expect(await costo(insumoId)).toBe('1000');

    // Y el movimiento lleva ese costo CONGELADO.
    const movimiento = await prisma.movimientoStock.findFirstOrThrow({
      where: { recepcionCompraId: recepcion.id },
    });
    expect(movimiento.tipo).toBe('COMPRA');
    expect(movimiento.costoUnitario?.toString()).toBe('1000');
  });

  it('las salidas congelan el costo promedio del momento', async () => {
    await entrarComo('dueno@panaderia.test');
    const { insumoId } = await harinaNueva();
    const proveedorId = await proveedorNuevo();
    await recibirDirecta({
      sucursalId: centralId,
      proveedorId,
      lineas: [{ insumoId, presentacionId: null, cantidad: '100', precioUnitario: '1000' }],
    });

    const consumo = await api.post('/api/movimientos/consumo', {
      sucursalId: centralId,
      lineas: [{ insumoId, cantidad: '10' }],
    });
    expect(consumo.status).toBe(201);

    // Sube el precio: el consumo de antes tiene que seguir valiendo $1.000.
    await recibirDirecta({
      sucursalId: centralId,
      proveedorId,
      lineas: [{ insumoId, presentacionId: null, cantidad: '90', precioUnitario: '1400' }],
    });
    expect(await costo(insumoId)).toBe('1200');

    const salida = await prisma.movimientoStock.findFirstOrThrow({
      where: { insumoId, tipo: 'CONSUMO' },
    });
    expect(salida.costoUnitario?.toString()).toBe('1000');
  });

  it('el saldo inicial sin precio toma el costo de la primera compra', async () => {
    await entrarComo('dueno@panaderia.test');
    const { insumoId } = await harinaNueva();
    const proveedorId = await proveedorNuevo();
    await api.post('/api/movimientos/saldo-inicial', {
      sucursalId: centralId,
      lineas: [{ insumoId, cantidad: '70' }],
    });
    expect(await costo(insumoId)).toBeNull();

    await recibirDirecta({
      sucursalId: centralId,
      proveedorId,
      lineas: [{ insumoId, presentacionId: null, cantidad: '25', precioUnitario: '740' }],
    });
    expect(await costo(insumoId)).toBe('740');
  });

  it('el costo es por EMPRESA: compras en las dos sucursales se promedian juntas', async () => {
    await entrarComo('dueno@panaderia.test');
    const { insumoId } = await harinaNueva();
    const proveedorId = await proveedorNuevo();
    await recibirDirecta({
      sucursalId: centralId,
      proveedorId,
      lineas: [{ insumoId, presentacionId: null, cantidad: '100', precioUnitario: '1000' }],
    });
    await recibirDirecta({
      sucursalId: laferrereId,
      proveedorId,
      lineas: [{ insumoId, presentacionId: null, cantidad: '50', precioUnitario: '1300' }],
    });
    expect(await costo(insumoId)).toBe('1100');
  });
});

describe('recepción directa (sin orden)', () => {
  it('✅ suma stock igual que con orden', async () => {
    await entrarComo('dueno@panaderia.test');
    const { insumoId, bolsaId } = await harinaNueva();
    const proveedorId = await proveedorNuevo();

    const recepcion = await recibirDirecta({
      sucursalId: laferrereId,
      proveedorId,
      numeroRemito: 'R-123',
      numeroFactura: 'B-0001-00000042',
      lineas: [{ insumoId, presentacionId: bolsaId, cantidad: '2', precioUnitario: '25000' }],
    });

    expect(recepcion.orden).toBeNull();
    expect(recepcion.estado).toBe('CONFIRMADA');
    expect(await saldo(insumoId, laferrereId)).toBe('50');
    // Y en la otra sucursal no entró nada.
    expect(await saldo(insumoId, centralId)).toBe('0');
  });

  it('✅ el historial del insumo muestra la compra con el número de remito', async () => {
    await entrarComo('dueno@panaderia.test');
    const { insumoId, bolsaId } = await harinaNueva();
    const proveedorId = await proveedorNuevo();
    const recepcion = await recibirDirecta({
      sucursalId: centralId,
      proveedorId,
      numeroRemito: '0001-00009999',
      lineas: [{ insumoId, presentacionId: bolsaId, cantidad: '1', precioUnitario: '25000' }],
    });

    const r = await api.get(`/api/insumos/${insumoId}/movimientos?sucursalId=${centralId}`);
    expect(r.status).toBe(200);
    const compra = (r.cuerpo as HistorialMovimientos).items[0];
    expect(compra?.tipo).toBe('COMPRA');
    expect(compra?.recepcion?.numero).toBe(recepcion.numero);
    expect(compra?.recepcion?.numeroRemito).toBe('0001-00009999');
    // El historial no manda plata: lo ve también el empleado.
    expect(compra).not.toHaveProperty('costoUnitario');
  });

  it('el precio es obligatorio al recibir (C-7)', async () => {
    await entrarComo('dueno@panaderia.test');
    const { insumoId } = await harinaNueva();
    const proveedorId = await proveedorNuevo();
    const r = await api.post('/api/recepciones', {
      sucursalId: centralId,
      proveedorId,
      lineas: [{ insumoId, presentacionId: null, cantidad: '1' }],
    });
    expect(r.status).toBe(400);
  });

  it('a un proveedor inactivo no se le compra', async () => {
    await entrarComo('dueno@panaderia.test');
    const { insumoId } = await harinaNueva();
    const proveedorId = await proveedorNuevo();
    await api.post(`/api/proveedores/${proveedorId}/desactivar`);

    const r = await api.post('/api/recepciones', {
      sucursalId: centralId,
      proveedorId,
      lineas: [{ insumoId, presentacionId: null, cantidad: '1', precioUnitario: '1' }],
    });
    expect(r.status).toBe(400);
  });
});

describe('último precio del proveedor (C-7)', () => {
  async function asociacion(proveedorId: string, insumoId: string) {
    return prisma.proveedorInsumo.findUnique({
      where: { proveedorId_insumoId: { proveedorId, insumoId } },
    });
  }

  it('la recepción crea la asociación si no existía y guarda el precio con su fecha', async () => {
    await entrarComo('dueno@panaderia.test');
    const { insumoId, bolsaId } = await harinaNueva();
    const proveedorId = await proveedorNuevo();
    expect(await asociacion(proveedorId, insumoId)).toBeNull();

    const recepcion = await recibirDirecta({
      sucursalId: centralId,
      proveedorId,
      lineas: [{ insumoId, presentacionId: bolsaId, cantidad: '1', precioUnitario: '25000' }],
    });

    const creada = await asociacion(proveedorId, insumoId);
    expect(creada?.ultimoPrecio?.toString()).toBe('25000');
    expect(creada?.presentacionId).toBe(bolsaId);
    expect(creada?.ultimoPrecioAt?.toISOString()).toBe(recepcion.fecha);
  });

  it('el precio se lleva a la presentación de la asociación (bolsa de 25 → precio por kg)', async () => {
    await entrarComo('dueno@panaderia.test');
    const { insumoId, bolsaId } = await harinaNueva();
    const proveedorId = await proveedorNuevo();
    // El proveedor lo tiene registrado POR KILO (sin presentación).
    await api.post(`/api/proveedores/${proveedorId}/insumos`, { insumoId, ultimoPrecio: '900' });

    await recibirDirecta({
      sucursalId: centralId,
      proveedorId,
      lineas: [{ insumoId, presentacionId: bolsaId, cantidad: '1', precioUnitario: '25000' }],
    });
    expect((await asociacion(proveedorId, insumoId))?.ultimoPrecio?.toString()).toBe('1000');
  });

  it('una recepción con fecha vieja no pisa un precio más nuevo', async () => {
    await entrarComo('dueno@panaderia.test');
    const { insumoId } = await harinaNueva();
    const proveedorId = await proveedorNuevo();
    await recibirDirecta({
      sucursalId: centralId,
      proveedorId,
      lineas: [{ insumoId, presentacionId: null, cantidad: '1', precioUnitario: '1200' }],
    });
    await recibirDirecta({
      sucursalId: centralId,
      proveedorId,
      fecha: '2026-01-15T12:00:00Z',
      lineas: [{ insumoId, presentacionId: null, cantidad: '1', precioUnitario: '800' }],
    });
    expect((await asociacion(proveedorId, insumoId))?.ultimoPrecio?.toString()).toBe('1200');
  });

  it('comparación entre proveedores: el más barato y el más caro POR KILO (C-6)', async () => {
    await entrarComo('dueno@panaderia.test');
    const { insumoId, bolsaId } = await harinaNueva();
    const bolsa50 = await api.post(`/api/insumos/${insumoId}/presentaciones`, {
      nombre: 'Bolsa 50 kg',
      cantidadBase: '50',
    });
    const bolsa50Id =
      (bolsa50.cuerpo as InsumoDetalle).presentaciones.find((p) => p.nombre === 'Bolsa 50 kg')
        ?.id ?? '';
    const caro = await proveedorNuevo();
    const barato = await proveedorNuevo();

    // $25.000 la bolsa de 25 = $1.000/kg; $39.500 la de 50 = $790/kg. La bolsa
    // de 50 "parece" más cara, y es la más barata.
    await api.post(`/api/proveedores/${caro}/insumos`, {
      insumoId,
      presentacionId: bolsaId,
      ultimoPrecio: '25000',
    });
    await api.post(`/api/proveedores/${barato}/insumos`, {
      insumoId,
      presentacionId: bolsa50Id,
      ultimoPrecio: '39500',
    });

    const r = await api.get(`/api/insumos/${insumoId}/proveedores`);
    expect(r.status).toBe(200);
    const lista = r.cuerpo as ProveedorDeInsumo[];
    const delCaro = lista.find((p) => p.proveedor.id === caro);
    const delBarato = lista.find((p) => p.proveedor.id === barato);
    expect(delCaro?.costoBase).toBe('1000');
    expect(delCaro?.comparacion).toBe('MAS_CARO');
    expect(delBarato?.costoBase).toBe('790');
    expect(delBarato?.comparacion).toBe('MAS_BARATO');
  });
});

describe('anular una recepción', () => {
  it('✅ el stock y el costo promedio vuelven al valor anterior', async () => {
    await entrarComo('dueno@panaderia.test');
    const { insumoId } = await harinaNueva();
    const proveedorId = await proveedorNuevo();
    await recibirDirecta({
      sucursalId: centralId,
      proveedorId,
      lineas: [{ insumoId, presentacionId: null, cantidad: '100', precioUnitario: '1000' }],
    });
    const segunda = await recibirDirecta({
      sucursalId: centralId,
      proveedorId,
      lineas: [{ insumoId, presentacionId: null, cantidad: '50', precioUnitario: '1300' }],
    });
    expect(await saldo(insumoId)).toBe('150');
    expect(await costo(insumoId)).toBe('1100');

    const r = await api.post(`/api/recepciones/${segunda.id}/anular`, {
      motivo: 'Se cargó dos veces',
    });
    expect(r.status, JSON.stringify(r.cuerpo)).toBe(200);
    const anulada = RecepcionDetalleSchema.parse(r.cuerpo);

    expect(anulada.estado).toBe('ANULADA');
    expect(anulada.motivoAnulacion).toBe('Se cargó dos veces');
    expect(anulada.anuladaPor?.nombre).toBeTruthy();
    expect(await saldo(insumoId)).toBe('100');
    expect(await costo(insumoId)).toBe('1000');

    // No se borró nada: la compra y su reversa siguen en el kardex.
    const movimientos = await prisma.movimientoStock.findMany({
      where: { recepcionCompraId: segunda.id },
      orderBy: { createdAt: 'asc' },
    });
    expect(movimientos.map((m) => m.tipo)).toEqual(['COMPRA', 'REVERSA']);
    expect(movimientos[1]?.revierteAId).toBe(movimientos[0]?.id);
  });

  it('reabre la orden: una RECIBIDA vuelve a PARCIAL', async () => {
    await entrarComo('dueno@panaderia.test');
    const { insumoId, bolsaId } = await harinaNueva();
    const proveedorId = await proveedorNuevo();
    const creada = await crearOrden({
      sucursalId: centralId,
      proveedorId,
      lineas: [{ insumoId, presentacionId: bolsaId, cantidad: '10', precioUnitario: '25000' }],
    });
    const lineaId = creada.lineas[0]?.id ?? '';
    await api.post(`/api/ordenes-compra/${creada.id}/recepciones`, {
      lineas: [{ lineaOrdenId: lineaId, cantidad: '4', precioUnitario: '25000' }],
    });
    const ultima = await api.post(`/api/ordenes-compra/${creada.id}/recepciones`, {
      lineas: [{ lineaOrdenId: lineaId, cantidad: '6', precioUnitario: '25000' }],
    });
    expect((await orden(creada.id)).estado).toBe('RECIBIDA');

    await api.post(`/api/recepciones/${(ultima.cuerpo as RecepcionDetalle).id}/anular`, {
      motivo: 'Llegaron rotas',
    });

    const reabierta = await orden(creada.id);
    expect(reabierta.estado).toBe('PARCIAL');
    expect(reabierta.lineas[0]?.pendiente).toBe('6');
  });

  it('no se anula dos veces', async () => {
    await entrarComo('dueno@panaderia.test');
    const { insumoId } = await harinaNueva();
    const proveedorId = await proveedorNuevo();
    const recepcion = await recibirDirecta({
      sucursalId: centralId,
      proveedorId,
      lineas: [{ insumoId, presentacionId: null, cantidad: '10', precioUnitario: '1000' }],
    });
    await api.post(`/api/recepciones/${recepcion.id}/anular`, { motivo: 'Error' });
    const otra = await api.post(`/api/recepciones/${recepcion.id}/anular`, { motivo: 'Error' });
    expect(otra.status).toBe(409);
    expect(codigoError(otra)).toBe('RECEPCION_YA_ANULADA');
    expect(await saldo(insumoId)).toBe('0');
  });

  it('si la mercadería ya se usó, avisa; con forzar, la anula igual', async () => {
    await entrarComo('dueno@panaderia.test');
    const { insumoId } = await harinaNueva();
    const proveedorId = await proveedorNuevo();
    const recepcion = await recibirDirecta({
      sucursalId: centralId,
      proveedorId,
      lineas: [{ insumoId, presentacionId: null, cantidad: '10', precioUnitario: '1000' }],
    });
    await api.post('/api/movimientos/consumo', {
      sucursalId: centralId,
      lineas: [{ insumoId, cantidad: '8' }],
    });

    const sinForzar = await api.post(`/api/recepciones/${recepcion.id}/anular`, {
      motivo: 'Error de carga',
    });
    expect(sinForzar.status).toBe(409);
    expect(codigoError(sinForzar)).toBe('STOCK_INSUFICIENTE');

    const forzada = await api.post(`/api/recepciones/${recepcion.id}/anular`, {
      motivo: 'Error de carga',
      forzar: true,
    });
    expect(forzada.status).toBe(200);
    expect(await saldo(insumoId)).toBe('-8');
  });

  it('el último precio vuelve al de la recepción anterior', async () => {
    await entrarComo('dueno@panaderia.test');
    const { insumoId } = await harinaNueva();
    const proveedorId = await proveedorNuevo();
    await recibirDirecta({
      sucursalId: centralId,
      proveedorId,
      fecha: '2026-09-01T12:00:00Z',
      lineas: [{ insumoId, presentacionId: null, cantidad: '10', precioUnitario: '1000' }],
    });
    const mal = await recibirDirecta({
      sucursalId: centralId,
      proveedorId,
      lineas: [{ insumoId, presentacionId: null, cantidad: '10', precioUnitario: '10000' }],
    });

    await api.post(`/api/recepciones/${mal.id}/anular`, { motivo: 'Precio mal cargado' });

    const asociacion = await prisma.proveedorInsumo.findUniqueOrThrow({
      where: { proveedorId_insumoId: { proveedorId, insumoId } },
    });
    expect(asociacion.ultimoPrecio?.toString()).toBe('1000');
    expect(asociacion.ultimoPrecioAt?.toISOString()).toBe('2026-09-01T12:00:00.000Z');
  });

  it('una COMPRA no se anula suelta desde el historial: se anula su recepción', async () => {
    await entrarComo('dueno@panaderia.test');
    const { insumoId } = await harinaNueva();
    const proveedorId = await proveedorNuevo();
    const recepcion = await recibirDirecta({
      sucursalId: centralId,
      proveedorId,
      lineas: [{ insumoId, presentacionId: null, cantidad: '10', precioUnitario: '1000' }],
    });
    const compra = await prisma.movimientoStock.findFirstOrThrow({
      where: { recepcionCompraId: recepcion.id },
    });

    const r = await api.post(`/api/movimientos/${compra.id}/reversa`, {});
    expect(r.status).toBe(409);
    expect(codigoError(r)).toBe('COMPRA_SE_ANULA_DESDE_RECEPCION');
    expect(await saldo(insumoId)).toBe('10');
  });
});

describe('permisos (C-13)', () => {
  it('el encargado no crea órdenes, pero sí recibe', async () => {
    await entrarComo('dueno@panaderia.test');
    const { insumoId, bolsaId } = await harinaNueva();
    const proveedorId = await proveedorNuevo();
    const creada = await crearOrden({
      sucursalId: laferrereId,
      proveedorId,
      lineas: [{ insumoId, presentacionId: bolsaId, cantidad: '2', precioUnitario: '25000' }],
    });

    api.olvidarCookies();
    await entrarComo('encargado@panaderia.test');

    const pedir = await api.post('/api/ordenes-compra', {
      sucursalId: laferrereId,
      proveedorId,
      lineas: [{ insumoId, presentacionId: bolsaId, cantidad: '1' }],
    });
    expect(pedir.status).toBe(403);

    // Ve la orden y la recibe: el camión llega aunque el dueño no esté.
    expect((await api.get(`/api/ordenes-compra/${creada.id}`)).status).toBe(200);
    const recibir = await api.post(`/api/ordenes-compra/${creada.id}/recepciones`, {
      lineas: [{ lineaOrdenId: creada.lineas[0]?.id, cantidad: '2', precioUnitario: '25000' }],
    });
    expect(recibir.status).toBe(201);

    // Anular no: cambia el costo de toda la empresa.
    const anular = await api.post(
      `/api/recepciones/${(recibir.cuerpo as RecepcionDetalle).id}/anular`,
      { motivo: 'Probando' },
    );
    expect(anular.status).toBe(403);
  });

  it('el encargado solo recibe en SUS sucursales', async () => {
    await entrarComo('dueno@panaderia.test');
    const { insumoId, bolsaId } = await harinaNueva();
    const proveedorId = await proveedorNuevo();
    const creada = await crearOrden({
      sucursalId: centralId,
      proveedorId,
      lineas: [{ insumoId, presentacionId: bolsaId, cantidad: '2' }],
    });

    // Un encargado nuevo, solo de Laferrere.
    const email = `encargado-laf-${String(Date.now())}@panaderia.test`;
    const alta = await api.post('/api/usuarios', {
      email,
      nombre: 'Encargado de Laferrere',
      rol: 'ENCARGADO',
      password: PASSWORD_DEV,
      sucursalIds: [laferrereId],
    });
    expect(alta.status).toBe(201);

    api.olvidarCookies();
    await entrarComo(email);

    const ajena = await api.post(`/api/ordenes-compra/${creada.id}/recepciones`, {
      lineas: [{ lineaOrdenId: creada.lineas[0]?.id, cantidad: '2', precioUnitario: '25000' }],
    });
    expect(ajena.status).toBe(403);
    expect((await api.get(`/api/ordenes-compra/${creada.id}`)).status).toBe(403);

    const directa = await api.post('/api/recepciones', {
      sucursalId: centralId,
      proveedorId,
      lineas: [{ insumoId, presentacionId: null, cantidad: '1', precioUnitario: '1' }],
    });
    expect(directa.status).toBe(403);
  });

  it('el empleado no ve compras: tienen precios', async () => {
    await entrarComo('empleado@panaderia.test');
    expect((await api.get('/api/ordenes-compra')).status).toBe(403);
    expect((await api.get('/api/recepciones')).status).toBe(403);
  });
});

describe('concurrencia', () => {
  it('✅ dos recepciones simultáneas no repiten el número de documento', async () => {
    await entrarComo('dueno@panaderia.test');
    const { insumoId } = await harinaNueva();
    const proveedorId = await proveedorNuevo();
    const cuerpo = {
      sucursalId: centralId,
      proveedorId,
      lineas: [{ insumoId, presentacionId: null, cantidad: '1', precioUnitario: '1000' }],
    };

    const respuestas = await Promise.all(
      Array.from({ length: 5 }, () => api.post('/api/recepciones', cuerpo)),
    );
    expect(respuestas.map((r) => r.status)).toEqual([201, 201, 201, 201, 201]);

    const numeros = respuestas.map((r) => (r.cuerpo as RecepcionDetalle).numero);
    expect(new Set(numeros).size).toBe(5);
    // Y correlativos: sin huecos entre ellos.
    const ordenados = [...numeros].sort((a, b) => a - b);
    expect((ordenados.at(-1) ?? 0) - (ordenados.at(0) ?? 0)).toBe(4);
  });

  it('dos recepciones simultáneas de lo que falta: una entra y la otra choca', async () => {
    await entrarComo('dueno@panaderia.test');
    const { insumoId, bolsaId } = await harinaNueva();
    const proveedorId = await proveedorNuevo();
    const creada = await crearOrden({
      sucursalId: centralId,
      proveedorId,
      lineas: [{ insumoId, presentacionId: bolsaId, cantidad: '6' }],
    });
    const cuerpo = {
      lineas: [{ lineaOrdenId: creada.lineas[0]?.id, cantidad: '6', precioUnitario: '25000' }],
    };

    const [a, b] = await Promise.all([
      api.post(`/api/ordenes-compra/${creada.id}/recepciones`, cuerpo),
      api.post(`/api/ordenes-compra/${creada.id}/recepciones`, cuerpo),
    ]);

    expect([a.status, b.status].sort()).toEqual([201, 409]);
    // EL INVARIANTE: nunca entra más de lo pedido.
    expect(await saldo(insumoId)).toBe('150');
    expect((await orden(creada.id)).estado).toBe('RECIBIDA');
  });

  it('compras simultáneas del mismo insumo en dos sucursales: sin abrazo mortal y con el promedio exacto', async () => {
    await entrarComo('dueno@panaderia.test');
    const { insumoId } = await harinaNueva();
    const proveedorId = await proveedorNuevo();

    const [central, laferrere] = await Promise.all([
      api.post('/api/recepciones', {
        sucursalId: centralId,
        proveedorId,
        lineas: [{ insumoId, presentacionId: null, cantidad: '100', precioUnitario: '1000' }],
      }),
      api.post('/api/recepciones', {
        sucursalId: laferrereId,
        proveedorId,
        lineas: [{ insumoId, presentacionId: null, cantidad: '50', precioUnitario: '1300' }],
      }),
    ]);

    expect([central.status, laferrere.status]).toEqual([201, 201]);
    // Si una recepción hubiera calculado el promedio sin ver la otra compra,
    // daría 1000 o 1300. Solo con el candado da 1100.
    expect(await costo(insumoId)).toBe('1100');
  });

  /**
   * El test de arriba NO alcanza para el abrazo mortal, y lo descubrí
   * rompiendo el candado a propósito: con `FOR UPDATE` seguía pasando. Dos
   * RECEPCIONES nunca llegan a pelear por el insumo, porque antes pelean por
   * el contador de números, y eso ya las pone en fila.
   *
   * Las ANULACIONES no piden número. Dos anulaciones simultáneas del mismo
   * insumo en sucursales distintas sí recorren el camino peligroso: cada una
   * inserta su reversa (candado suave sobre el insumo) y después pide el
   * candado del insumo para recalcular el costo. Con `FOR UPDATE`, Postgres
   * detecta el abrazo y mata a una ("deadlock detected"). Con
   * `FOR NO KEY UPDATE`, las dos terminan.
   */
  it('dos anulaciones simultáneas del mismo insumo en dos sucursales: sin abrazo mortal', async () => {
    await entrarComo('dueno@panaderia.test');

    // Varias vueltas: un abrazo mortal depende del momento exacto en que cada
    // una toma su candado, y una sola vuelta podría tener suerte.
    for (let vuelta = 0; vuelta < 5; vuelta += 1) {
      const { insumoId } = await harinaNueva();
      const proveedorId = await proveedorNuevo();
      const base = await recibirDirecta({
        sucursalId: centralId,
        proveedorId,
        lineas: [{ insumoId, presentacionId: null, cantidad: '100', precioUnitario: '1000' }],
      });
      const enCentral = await recibirDirecta({
        sucursalId: centralId,
        proveedorId,
        lineas: [{ insumoId, presentacionId: null, cantidad: '10', precioUnitario: '2000' }],
      });
      const enLaferrere = await recibirDirecta({
        sucursalId: laferrereId,
        proveedorId,
        lineas: [{ insumoId, presentacionId: null, cantidad: '10', precioUnitario: '3000' }],
      });
      expect(base.estado).toBe('CONFIRMADA');

      const [a, b] = await Promise.all([
        api.post(`/api/recepciones/${enCentral.id}/anular`, { motivo: 'Prueba A' }),
        api.post(`/api/recepciones/${enLaferrere.id}/anular`, { motivo: 'Prueba B' }),
      ]);

      expect([a.status, b.status], JSON.stringify([a.cuerpo, b.cuerpo])).toEqual([200, 200]);
      // Las dos anuladas: queda solo la primera compra.
      expect(await costo(insumoId)).toBe('1000');
    }
  });
});

describe('plantillas de pedidos recurrentes', () => {
  it('se guarda con nombre, se edita y se desactiva sin borrarse', async () => {
    await entrarComo('dueno@panaderia.test');
    const { insumoId, bolsaId } = await harinaNueva();
    const proveedorId = await proveedorNuevo();
    const nombre = nombreNuevo('Pedido semanal');

    const creada = await api.post('/api/plantillas-pedido', {
      nombre,
      proveedorId,
      sucursalId: centralId,
      lineas: [{ insumoId, presentacionId: bolsaId, cantidad: '10' }],
    });
    expect(creada.status, JSON.stringify(creada.cuerpo)).toBe(201);
    const plantilla = creada.cuerpo as Plantilla;
    expect(plantilla.lineas[0]?.cantidad).toBe('10');
    expect(plantilla.lineas[0]?.presentacion?.nombre).toBe('Bolsa 25 kg');

    const editada = await api.pedir('PUT', `/api/plantillas-pedido/${plantilla.id}`, {
      nombre,
      proveedorId,
      sucursalId: centralId,
      lineas: [{ insumoId, presentacionId: bolsaId, cantidad: '12' }],
    });
    expect(editada.status).toBe(200);
    expect((editada.cuerpo as Plantilla).lineas[0]?.cantidad).toBe('12');

    await api.post(`/api/plantillas-pedido/${plantilla.id}/desactivar`);
    const activas = (await api.get('/api/plantillas-pedido')).cuerpo as Plantilla[];
    expect(activas.map((p) => p.id)).not.toContain(plantilla.id);
    const todas = (await api.get('/api/plantillas-pedido?incluirInactivas=true'))
      .cuerpo as Plantilla[];
    expect(todas.find((p) => p.id === plantilla.id)?.activa).toBe(false);
  });

  it('no puede haber dos plantillas con el mismo nombre', async () => {
    await entrarComo('dueno@panaderia.test');
    const { insumoId } = await harinaNueva();
    const proveedorId = await proveedorNuevo();
    const cuerpo = {
      nombre: nombreNuevo('Pedido lunes'),
      proveedorId,
      sucursalId: centralId,
      lineas: [{ insumoId, presentacionId: null, cantidad: '1' }],
    };
    expect((await api.post('/api/plantillas-pedido', cuerpo)).status).toBe(201);
    const repetida = await api.post('/api/plantillas-pedido', {
      ...cuerpo,
      nombre: cuerpo.nombre.toUpperCase(),
    });
    expect(repetida.status).toBe(409);
  });

  it('el encargado las ve pero no las administra', async () => {
    await entrarComo('encargado@panaderia.test');
    expect((await api.get('/api/plantillas-pedido')).status).toBe(200);
    const r = await api.post('/api/plantillas-pedido', {
      nombre: 'Intento',
      proveedorId: '00000000-0000-4000-8000-000000000000',
      sucursalId: centralId,
      lineas: [],
    });
    expect(r.status).toBe(403);
  });
});
