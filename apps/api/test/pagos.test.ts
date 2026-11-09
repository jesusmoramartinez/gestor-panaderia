import {
  type InsumoDetalle,
  LoQueMeDebenSchema,
  type OrdenDetalle,
  OrdenDetalleSchema,
  type ProveedorDetalle,
  RecepcionDetalleSchema,
} from '@panaderia/shared';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { PASSWORD_DEV } from '../prisma/semilla.js';
import { cerrarConexiones, prisma } from '../src/lib/db.js';
import { NOMBRE_COOKIE_SESION } from '../src/modules/auth/cookies.js';
import { reiniciarLimitadores } from '../src/modules/auth/service.js';
import { ClienteHttp } from './cliente-http.js';

/**
 * PAGOS Y COMPROBANTES (Etapa 2, Fase 12b).
 *
 * Marcelo paga por adelantado (C-20), con efectivo, transferencia o Mercado
 * Pago (C-25), y guarda la captura (C-24). Cada test crea su compra.
 */

let api: ClienteHttp;
let centralId: string;
let unidadKgId: string;

/** Un PNG de verdad, de 1×1 píxel. */
const PNG =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
/** Algo que empieza como un JPEG (la firma FF D8 FF) y unos bytes más. */
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4, 5, 6]).toString('base64');
/** Un texto cualquiera: no es una imagen, aunque el nombre del archivo dijera ".jpg". */
const NO_IMAGEN = Buffer.from('esto no es una foto, es un texto').toString('base64');

beforeAll(async () => {
  api = await ClienteHttp.levantar();
  const empresa = await prisma.empresa.findFirstOrThrow({
    where: { nombre: 'Panadería Laferrere' },
    include: { sucursales: true, unidades: true },
  });
  centralId = empresa.sucursales.find((s) => s.codigo === 'CEN')?.id ?? '';
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

/** 100 bolsas a $20.000 ($2.000.000), de un proveedor y un insumo nuevos. */
async function compra(
  opciones: { precio?: string | null; pedir?: boolean } = {},
): Promise<OrdenDetalle> {
  const insumo = await api.post('/api/insumos', {
    nombre: nombreNuevo('Harina pago'),
    codigo: null,
    categoriaId: null,
    unidadBaseId: unidadKgId,
  });
  const insumoId = (insumo.cuerpo as InsumoDetalle).id;
  const bolsa = await api.post(`/api/insumos/${insumoId}/presentaciones`, {
    nombre: 'Bolsa 25 kg',
    cantidadBase: '25',
  });
  const bolsaId =
    (bolsa.cuerpo as InsumoDetalle).presentaciones.find((p) => p.nombre === 'Bolsa 25 kg')?.id ??
    '';
  const proveedor = await api.post('/api/proveedores', { nombre: nombreNuevo('Proveedor pago') });
  const r = await api.post('/api/ordenes-compra', {
    sucursalId: centralId,
    proveedorId: (proveedor.cuerpo as ProveedorDetalle).id,
    pedir: opciones.pedir ?? true,
    lineas: [
      {
        insumoId,
        presentacionId: bolsaId,
        cantidad: '100',
        precioUnitario: opciones.precio === undefined ? '20000' : opciones.precio,
      },
    ],
  });
  expect(r.status, JSON.stringify(r.cuerpo)).toBe(201);
  return OrdenDetalleSchema.parse(r.cuerpo);
}

async function pagar(ordenId: string, cuerpo: Record<string, unknown>) {
  return api.post(`/api/ordenes-compra/${ordenId}/pagos`, { medio: 'TRANSFERENCIA', ...cuerpo });
}

async function orden(id: string): Promise<OrdenDetalle> {
  const r = await api.get(`/api/ordenes-compra/${id}`);
  expect(r.status).toBe(200);
  return OrdenDetalleSchema.parse(r.cuerpo);
}

async function entregar(o: OrdenDetalle, cantidad: string, extra: Record<string, unknown> = {}) {
  const r = await api.post(`/api/ordenes-compra/${o.id}/recepciones`, {
    lineas: [{ lineaOrdenId: o.lineas[0]?.id, cantidad, precioUnitario: '20000' }],
    ...extra,
  });
  expect(r.status, JSON.stringify(r.cuerpo)).toBe(201);
  return RecepcionDetalleSchema.parse(r.cuerpo);
}

// ===========================================================================

describe('registrar un pago', () => {
  it('✅ paga el total con la captura de Mercado Pago: queda PAGADA y la imagen se puede ver', async () => {
    await entrarComo('dueno@panaderia.test');
    const o = await compra();
    expect(o.cuenta.estadoPago).toBe('SIN_PAGO');
    expect(o.puedePagar).toBe(true);

    const r = await pagar(o.id, {
      monto: '2.000.000',
      medio: 'MERCADO_PAGO',
      nota: 'adelanto de las 100 bolsas',
      comprobantes: [{ datos: PNG }],
    });
    expect(r.status, JSON.stringify(r.cuerpo)).toBe(201);
    const pagada = OrdenDetalleSchema.parse(r.cuerpo);
    expect(pagada.cuenta.estadoPago).toBe('PAGADA');
    expect(pagada.cuenta.pagado).toBe('2000000');
    expect(pagada.cuenta.saldo).toBe('0');
    expect(pagada.puedePagar).toBe(false);
    expect(pagada.pagos).toHaveLength(1);
    expect(pagada.pagos[0]?.medio).toBe('MERCADO_PAGO');
    expect(pagada.pagos[0]?.comprobantes).toHaveLength(1);
    expect(pagada.pagos[0]?.comprobantes[0]?.tipo).toBe('image/png');

    // La imagen vuelve EXACTAMENTE como se mandó, con el tipo que dicen sus bytes.
    const comprobanteId = pagada.pagos[0]?.comprobantes[0]?.id ?? '';
    const imagen = await api.crudo(`/api/comprobantes/${comprobanteId}`, {
      headers: { cookie: `${NOMBRE_COOKIE_SESION}=${api.cookie(NOMBRE_COOKIE_SESION) ?? ''}` },
    });
    expect(imagen.status).toBe(200);
    expect(imagen.headers.get('content-type')).toBe('image/png');
    expect(imagen.headers.get('x-content-type-options')).toBe('nosniff');
    expect(Buffer.from(await imagen.arrayBuffer()).toString('base64')).toBe(PNG);

    // El listado también sabe que está pagada.
    const lista = await api.get('/api/ordenes-compra?limite=200');
    const fila = (lista.cuerpo as { items: { id: string; estadoPago: string }[] }).items.find(
      (item) => item.id === o.id,
    );
    expect(fila?.estadoPago).toBe('PAGADA');
  });

  it('en dos pagos: PAGO_PARCIAL y después PAGADA', async () => {
    await entrarComo('dueno@panaderia.test');
    const o = await compra();
    const primero = await pagar(o.id, { monto: '500000', medio: 'EFECTIVO' });
    expect(OrdenDetalleSchema.parse(primero.cuerpo).cuenta.estadoPago).toBe('PAGO_PARCIAL');
    expect(OrdenDetalleSchema.parse(primero.cuerpo).cuenta.saldo).toBe('1500000');
    const segundo = await pagar(o.id, { monto: '1500000' });
    expect(OrdenDetalleSchema.parse(segundo.cuerpo).cuenta.estadoPago).toBe('PAGADA');
  });

  it('no se puede pagar más que lo que falta (y el error va al campo monto)', async () => {
    await entrarComo('dueno@panaderia.test');
    const o = await compra();
    await pagar(o.id, { monto: '1500000' });

    const demas = await pagar(o.id, { monto: '600000' });
    expect(demas.status).toBe(409);
    expect(codigoError(demas)).toBe('PAGO_EXCEDE_TOTAL');
    expect((demas.cuerpo as { detalles: { monto: string } }).detalles.monto).toMatch(/500\.000/);
    expect((await orden(o.id)).cuenta.pagado).toBe('1500000');
  });

  it('dos pagos del total en el mismo instante: entra uno solo (el candado de la orden)', async () => {
    await entrarComo('dueno@panaderia.test');
    const o = await compra();
    const [a, b] = await Promise.all([
      pagar(o.id, { monto: '2000000' }),
      pagar(o.id, { monto: '2000000' }),
    ]);
    expect([a.status, b.status].sort()).toEqual([201, 409]);
    expect((await orden(o.id)).cuenta.pagado).toBe('2000000');
  });

  it('una compra con un insumo sin precio no se puede pagar (no hay total)', async () => {
    await entrarComo('dueno@panaderia.test');
    const o = await compra({ precio: null });
    expect(o.puedePagar).toBe(false);
    const r = await pagar(o.id, { monto: '1000' });
    expect(r.status).toBe(409);
    expect(codigoError(r)).toBe('COMPRA_SIN_PRECIO');
  });

  it('un borrador o una compra cancelada no se pagan', async () => {
    await entrarComo('dueno@panaderia.test');
    const borrador = await compra({ pedir: false });
    expect(codigoError(await pagar(borrador.id, { monto: '1000' }))).toBe(
      'COMPRA_NO_SE_PUEDE_PAGAR',
    );

    const cancelada = await compra();
    await api.post(`/api/ordenes-compra/${cancelada.id}/cancelar`, {});
    expect(codigoError(await pagar(cancelada.id, { monto: '1000' }))).toBe(
      'COMPRA_NO_SE_PUEDE_PAGAR',
    );
  });

  it('montos inválidos: cero, negativo, letras', async () => {
    await entrarComo('dueno@panaderia.test');
    const o = await compra();
    for (const monto of ['0', '-5', 'mil']) {
      const r = await pagar(o.id, { monto });
      expect(r.status, monto).toBe(400);
    }
  });
});

describe('comprobantes', () => {
  it('un archivo que no es imagen se rechaza, y no queda ni el pago', async () => {
    await entrarComo('dueno@panaderia.test');
    const o = await compra();
    const r = await pagar(o.id, { monto: '1000', comprobantes: [{ datos: NO_IMAGEN }] });
    expect(r.status).toBe(400);
    expect((r.cuerpo as { detalles: Record<string, string> }).detalles.comprobantes).toMatch(
      /no es una imagen/,
    );
    expect((await orden(o.id)).pagos).toHaveLength(0);
  });

  it('una imagen de más de 2 MB se rechaza', async () => {
    await entrarComo('dueno@panaderia.test');
    const o = await compra();
    const grande = Buffer.concat([
      Buffer.from([0xff, 0xd8, 0xff]),
      Buffer.alloc(2 * 1024 * 1024 + 10),
    ]).toString('base64');
    const r = await pagar(o.id, { monto: '1000', comprobantes: [{ datos: grande }] });
    expect(r.status).toBe(400);
  });

  it('se pueden agregar fotos a un pago ya cargado', async () => {
    await entrarComo('dueno@panaderia.test');
    const o = await compra();
    const pagada = OrdenDetalleSchema.parse((await pagar(o.id, { monto: '1000' })).cuerpo);
    const pagoId = pagada.pagos[0]?.id ?? '';

    const r = await api.post(`/api/pagos/${pagoId}/comprobantes`, {
      comprobantes: [{ datos: JPEG }, { datos: PNG }],
    });
    expect(r.status, JSON.stringify(r.cuerpo)).toBe(201);
    const tipos = OrdenDetalleSchema.parse(r.cuerpo).pagos[0]?.comprobantes.map((c) => c.tipo);
    expect(tipos).toEqual(['image/jpeg', 'image/png']);
  });

  it('la foto del remito, al registrar la entrega o después (C-30)', async () => {
    await entrarComo('dueno@panaderia.test');
    const o = await compra();
    const entrega = await entregar(o, '20', { comprobantes: [{ datos: JPEG }] });
    expect(entrega.comprobantes).toHaveLength(1);
    expect(entrega.comprobantes[0]?.tipo).toBe('image/jpeg');

    const r = await api.post(`/api/recepciones/${entrega.id}/comprobantes`, {
      comprobantes: [{ datos: PNG }],
    });
    expect(r.status).toBe(201);
    expect(RecepcionDetalleSchema.parse(r.cuerpo).comprobantes).toHaveLength(2);
  });

  it('el empleado no ve comprobantes, y el encargado no paga', async () => {
    await entrarComo('dueno@panaderia.test');
    const o = await compra();
    const pagada = OrdenDetalleSchema.parse(
      (await pagar(o.id, { monto: '1000', comprobantes: [{ datos: PNG }] })).cuerpo,
    );
    const comprobanteId = pagada.pagos[0]?.comprobantes[0]?.id ?? '';

    api.olvidarCookies();
    await entrarComo('empleado@panaderia.test');
    expect((await api.get(`/api/comprobantes/${comprobanteId}`)).status).toBe(403);

    api.olvidarCookies();
    await entrarComo('encargado@panaderia.test');
    expect((await pagar(o.id, { monto: '1000' })).status).toBe(403);
  });
});

describe('anular un pago', () => {
  it('deja de contar, queda en la historia con el motivo, y no se anula dos veces', async () => {
    await entrarComo('dueno@panaderia.test');
    const o = await compra();
    const pagada = OrdenDetalleSchema.parse((await pagar(o.id, { monto: '2000000' })).cuerpo);
    const pagoId = pagada.pagos[0]?.id ?? '';

    const sinMotivo = await api.post(`/api/pagos/${pagoId}/anular`, { motivo: '' });
    expect(sinMotivo.status).toBe(400);

    const r = await api.post(`/api/pagos/${pagoId}/anular`, { motivo: 'cargué un cero de más' });
    expect(r.status, JSON.stringify(r.cuerpo)).toBe(200);
    const anulada = OrdenDetalleSchema.parse(r.cuerpo);
    expect(anulada.cuenta.estadoPago).toBe('SIN_PAGO');
    expect(anulada.pagos[0]?.anuladoAt).not.toBeNull();
    expect(anulada.pagos[0]?.motivoAnulacion).toBe('cargué un cero de más');
    expect(anulada.pagos[0]?.anuladoPor?.nombre).toBeDefined();

    const otraVez = await api.post(`/api/pagos/${pagoId}/anular`, { motivo: 'de nuevo' });
    expect(codigoError(otraVez)).toBe('PAGO_YA_ANULADO');
  });
});

describe('editar una compra que ya se pagó', () => {
  it('el total no puede quedar por debajo de lo pagado; por encima, sí', async () => {
    await entrarComo('dueno@panaderia.test');
    const o = await compra();
    await pagar(o.id, { monto: '2000000' });
    const linea = o.lineas[0];
    const cuerpo = (cantidad: string) => ({
      sucursalId: centralId,
      proveedorId: o.proveedor.id,
      lineas: [
        {
          insumoId: linea?.insumo.id,
          presentacionId: linea?.presentacion?.id,
          cantidad,
          precioUnitario: '20000',
        },
      ],
    });

    const menos = await api.pedir('PUT', `/api/ordenes-compra/${o.id}`, cuerpo('90'));
    expect(menos.status).toBe(409);
    expect(codigoError(menos)).toBe('TOTAL_MENOR_A_LO_PAGADO');

    const mas = await api.pedir('PUT', `/api/ordenes-compra/${o.id}`, cuerpo('110'));
    expect(mas.status, JSON.stringify(mas.cuerpo)).toBe(200);
    expect(OrdenDetalleSchema.parse(mas.cuerpo).cuenta.estadoPago).toBe('PAGO_PARCIAL');
  });
});

describe('lo que me deben, con pagos', () => {
  it('pagó todo y llegaron 40: la plata suya que tiene el proveedor es lo de las 60 que faltan', async () => {
    await entrarComo('dueno@panaderia.test');
    const o = await compra();
    await pagar(o.id, { monto: '2000000' });
    await entregar(o, '40');

    const deudas = LoQueMeDebenSchema.parse((await api.get('/api/acopio/me-deben')).cuerpo);
    const deuda = deudas.proveedores.find((d) => d.proveedor.id === o.proveedor.id);
    expect(deuda?.valorPendiente).toBe('1200000');
    expect(deuda?.adelantadoSinEntregar).toBe('1200000');
  });

  it('pagó todo, llegaron 30 y la cerró con faltante: le tienen que devolver lo de las 70', async () => {
    await entrarComo('dueno@panaderia.test');
    const o = await compra();
    await pagar(o.id, { monto: '2000000' });
    await entregar(o, '30');
    await api.post(`/api/ordenes-compra/${o.id}/cerrar`, { nota: 'no hay más' });

    const deudas = LoQueMeDebenSchema.parse((await api.get('/api/acopio/me-deben')).cuerpo);
    expect(deudas.proveedores.find((d) => d.proveedor.id === o.proveedor.id)).toBeUndefined();
    const aFavor = deudas.aFavor.find((item) => item.id === o.id);
    expect(aFavor?.monto).toBe('1400000');
    expect(aFavor?.estado).toBe('CERRADA');
  });

  it('si el proveedor devolvió la plata, se anula el pago y ya no queda a favor', async () => {
    await entrarComo('dueno@panaderia.test');
    const o = await compra();
    const pagada = OrdenDetalleSchema.parse((await pagar(o.id, { monto: '2000000' })).cuerpo);
    await api.post(`/api/ordenes-compra/${o.id}/cancelar`, {});
    let deudas = LoQueMeDebenSchema.parse((await api.get('/api/acopio/me-deben')).cuerpo);
    expect(deudas.aFavor.find((item) => item.id === o.id)?.monto).toBe('2000000');

    await api.post(`/api/pagos/${pagada.pagos[0]?.id ?? ''}/anular`, {
      motivo: 'el molino devolvió la plata',
    });
    deudas = LoQueMeDebenSchema.parse((await api.get('/api/acopio/me-deben')).cuerpo);
    expect(deudas.aFavor.find((item) => item.id === o.id)).toBeUndefined();
  });
});
