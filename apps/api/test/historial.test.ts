import {
  HistorialCompraSchema,
  type InsumoDetalle,
  type OrdenDetalle,
  OrdenDetalleSchema,
  type ProveedorDetalle,
  type RecepcionDetalle,
} from '@panaderia/shared';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { PASSWORD_DEV } from '../prisma/semilla.js';
import { cerrarConexiones, prisma } from '../src/lib/db.js';
import { reiniciarLimitadores } from '../src/modules/auth/service.js';
import { ClienteHttp } from './cliente-http.js';

/** HISTORIAL Y NOTAS DE UNA COMPRA (Etapa 2, Fase 12c). */

let api: ClienteHttp;
let centralId: string;
let unidadKgId: string;
const PNG =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

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

async function entrarComo(email: string): Promise<void> {
  const r = await api.post('/api/auth/login', { email, password: PASSWORD_DEV });
  expect(r.status, `login de ${email}`).toBe(200);
}

function nombreNuevo(prefijo: string): string {
  return `${prefijo} ${String(Date.now())}-${String(Math.floor(Math.random() * 1000000))}`;
}

async function compra(): Promise<OrdenDetalle> {
  const insumo = await api.post('/api/insumos', {
    nombre: nombreNuevo('Harina historial'),
    codigo: null,
    categoriaId: null,
    unidadBaseId: unidadKgId,
  });
  const proveedor = await api.post('/api/proveedores', {
    nombre: nombreNuevo('Proveedor historial'),
  });
  const r = await api.post('/api/ordenes-compra', {
    sucursalId: centralId,
    proveedorId: (proveedor.cuerpo as ProveedorDetalle).id,
    lineas: [
      { insumoId: (insumo.cuerpo as InsumoDetalle).id, cantidad: '100', precioUnitario: '1000' },
    ],
  });
  expect(r.status, JSON.stringify(r.cuerpo)).toBe(201);
  return OrdenDetalleSchema.parse(r.cuerpo);
}

async function historial(ordenId: string) {
  const r = await api.get(`/api/ordenes-compra/${ordenId}/historial`);
  expect(r.status, JSON.stringify(r.cuerpo)).toBe(200);
  return HistorialCompraSchema.parse(r.cuerpo).eventos;
}

async function entregar(o: OrdenDetalle, cantidad: string): Promise<RecepcionDetalle> {
  const r = await api.post(`/api/ordenes-compra/${o.id}/recepciones`, {
    lineas: [{ lineaOrdenId: o.lineas[0]?.id, cantidad, precioUnitario: '1000' }],
  });
  expect(r.status, JSON.stringify(r.cuerpo)).toBe(201);
  return r.cuerpo as RecepcionDetalle;
}

describe('el historial de una compra', () => {
  it('✅ 2 pagos, 3 entregas y una nota: todo en el orden en que pasó', async () => {
    await entrarComo('dueno@panaderia.test');
    const o = await compra();

    await api.post(`/api/ordenes-compra/${o.id}/pagos`, {
      monto: '50000',
      medio: 'TRANSFERENCIA',
      comprobantes: [{ datos: PNG }],
    });
    await entregar(o, '20');
    await api.post(`/api/ordenes-compra/${o.id}/pagos`, { monto: '50000', medio: 'EFECTIVO' });
    await entregar(o, '20');
    const nota = await api.post(`/api/ordenes-compra/${o.id}/notas`, {
      texto: 'dicen que la próxima viene el 19',
    });
    expect(nota.status, JSON.stringify(nota.cuerpo)).toBe(201);
    await entregar(o, '20');

    const eventos = await historial(o.id);
    expect(eventos.map((e) => e.tipo)).toEqual([
      'CREADA',
      'PAGO',
      'ENTREGA',
      'PAGO',
      'ENTREGA',
      'NOTA',
      'ENTREGA',
    ]);
    expect(eventos[0]?.titulo).toBe('Compra creada y pedida');
    expect(eventos[1]?.detalle).toBe('1 comprobante');
    expect(eventos[2]?.titulo).toMatch(/^Entrega \d+ en Central$/);
    expect(eventos[2]?.detalle).toMatch(/^20 kg de Harina historial/);
    expect(eventos[5]?.detalle).toBe('dicen que la próxima viene el 19');
    expect(eventos[5]?.usuario?.nombre).toBeDefined();
  });

  it('la edición, la entrega anulada y la cancelación también quedan', async () => {
    await entrarComo('dueno@panaderia.test');
    const o = await compra();
    const linea = o.lineas[0];
    const editada = await api.pedir('PUT', `/api/ordenes-compra/${o.id}`, {
      sucursalId: centralId,
      proveedorId: o.proveedor.id,
      lineas: [{ insumoId: linea?.insumo.id, cantidad: '80', precioUnitario: '1000' }],
    });
    expect(editada.status).toBe(200);
    const otra = OrdenDetalleSchema.parse(editada.cuerpo);

    const entrega = await entregar(otra, '10');
    await api.post(`/api/recepciones/${entrega.id}/anular`, { motivo: 'era de otra compra' });
    await api.post(`/api/ordenes-compra/${o.id}/cancelar`, { nota: 'no lo necesito más' });

    const eventos = await historial(o.id);
    expect(eventos.map((e) => e.tipo)).toEqual([
      'CREADA',
      'EDITADA',
      'ENTREGA',
      'ENTREGA_ANULADA',
      'CANCELADA',
    ]);
    expect(eventos[3]?.detalle).toBe('era de otra compra');
    expect(eventos[4]?.detalle).toBe('no lo necesito más');
    expect(eventos[4]?.usuario).not.toBeNull();
  });

  it('una nota vacía no se guarda; el empleado no puede dejar notas', async () => {
    await entrarComo('dueno@panaderia.test');
    const o = await compra();
    expect((await api.post(`/api/ordenes-compra/${o.id}/notas`, { texto: '   ' })).status).toBe(
      400,
    );

    api.olvidarCookies();
    await entrarComo('empleado@panaderia.test');
    expect((await api.post(`/api/ordenes-compra/${o.id}/notas`, { texto: 'hola' })).status).toBe(
      403,
    );
  });

  it('la compra de otra empresa: 404 en el historial y en las notas', async () => {
    await entrarComo('dueno@panaderia.test');
    const o = await compra();
    api.olvidarCookies();
    await entrarComo('dueno@vecina.test');
    expect((await api.get(`/api/ordenes-compra/${o.id}/historial`)).status).toBe(404);
    expect((await api.post(`/api/ordenes-compra/${o.id}/notas`, { texto: 'hola' })).status).toBe(
      404,
    );
  });
});
