import {
  diaEnArgentina,
  type InsumoDetalle,
  OrdenDetalleSchema,
  type ProveedorDetalle,
  type Reportes,
  ReportesSchema,
} from '@panaderia/shared';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { PASSWORD_DEV } from '../prisma/semilla.js';
import { cerrarConexiones, prisma } from '../src/lib/db.js';
import { reiniciarLimitadores } from '../src/modules/auth/service.js';
import { ClienteHttp } from './cliente-http.js';

/**
 * LOS REPORTES (Etapa 2, Fase 12d), contra la API de verdad.
 *
 * Las cuentas se prueban con números conocidos en shared (reportes.test.ts).
 * Acá: que las filas que trae la base sean las correctas (el período, las
 * canceladas y los borradores afuera, los pagos anulados afuera) y que los
 * totales cuadren con lo que se cargó. Se mira solo el proveedor del test.
 */

let api: ClienteHttp;
let centralId: string;
let unidadKgId: string;
const hoy = diaEnArgentina(new Date());

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

async function reportes(query = `desde=${hoy}&hasta=${hoy}`): Promise<Reportes> {
  const r = await api.get(`/api/reportes?${query}`);
  expect(r.status, JSON.stringify(r.cuerpo)).toBe(200);
  return ReportesSchema.parse(r.cuerpo);
}

/**
 * Un proveedor y un insumo nuevos, con:
 *   - una compra de 10 bolsas (25 kg) a $20.000, pagada en dos (efectivo y
 *     Mercado Pago, uno anulado), con 4 bolsas entregadas;
 *   - una compra cancelada y un borrador, que NO cuentan.
 */
async function escenario() {
  const insumo = await api.post('/api/insumos', {
    nombre: nombreNuevo('Harina reporte'),
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
  const proveedor = await api.post('/api/proveedores', {
    nombre: nombreNuevo('Proveedor reporte'),
  });
  const proveedorId = (proveedor.cuerpo as ProveedorDetalle).id;
  const crear = async (pedir: boolean, cantidad: string) =>
    OrdenDetalleSchema.parse(
      (
        await api.post('/api/ordenes-compra', {
          sucursalId: centralId,
          proveedorId,
          pedir,
          lineas: [{ insumoId, presentacionId: bolsaId, cantidad, precioUnitario: '20000' }],
        })
      ).cuerpo,
    );

  const compra = await crear(true, '10');
  await api.post(`/api/ordenes-compra/${compra.id}/pagos`, { monto: '150000', medio: 'EFECTIVO' });
  const anulable = OrdenDetalleSchema.parse(
    (await api.post(`/api/ordenes-compra/${compra.id}/pagos`, { monto: '1000', medio: 'EFECTIVO' }))
      .cuerpo,
  );
  await api.post(`/api/pagos/${anulable.pagos[1]?.id ?? ''}/anular`, { motivo: 'era de prueba' });
  await api.post(`/api/ordenes-compra/${compra.id}/pagos`, {
    monto: '50000',
    medio: 'MERCADO_PAGO',
  });
  await api.post(`/api/ordenes-compra/${compra.id}/recepciones`, {
    lineas: [{ lineaOrdenId: compra.lineas[0]?.id, cantidad: '4', precioUnitario: '20000' }],
  });

  const cancelada = await crear(true, '99');
  await api.post(`/api/ordenes-compra/${cancelada.id}/cancelar`, {});
  await crear(false, '77');

  return { proveedorId, insumoId, compra };
}

describe('reportes', () => {
  it('✅ lo comprado, lo pagado, los precios, el cumplimiento y las entregas cuadran con lo cargado', async () => {
    await entrarComo('dueno@panaderia.test');
    const antes = await reportes();
    const { proveedorId, insumoId, compra } = await escenario();
    const despues = await reportes();

    // Gasto: solo la compra de verdad (10 × $20.000). Ni la cancelada ni el borrador.
    expect(despues.gastoPorProveedor.find((g) => g.proveedor.id === proveedorId)).toEqual({
      proveedor: { id: proveedorId, nombre: expect.any(String) as string },
      compras: 1,
      comprado: '200000',
    });
    expect(despues.gastoPorInsumo.find((g) => g.insumo.id === insumoId)?.cantidadBase).toBe('250');

    // El mes de hoy creció en lo comprado y en lo pagado (sin el pago anulado).
    const mes = hoy.slice(0, 7);
    const delMes = (r: Reportes) => r.gastoPorMes.find((g) => g.mes === mes);
    expect(Number(delMes(despues)?.comprado) - Number(delMes(antes)?.comprado)).toBe(200000);
    expect(Number(delMes(despues)?.pagado) - Number(delMes(antes)?.pagado)).toBe(200000);

    const medio = (r: Reportes, m: string) =>
      Number(r.pagosPorMedio.totales.find((t) => t.medio === m)?.total);
    expect(medio(despues, 'EFECTIVO') - medio(antes, 'EFECTIVO')).toBe(150000);
    expect(medio(despues, 'MERCADO_PAGO') - medio(antes, 'MERCADO_PAGO')).toBe(50000);

    // El precio, por bolsa y por kg.
    const precio = despues.precios.find((p) => p.ordenId === compra.id);
    expect(precio?.precioUnitario).toBe('20000');
    expect(precio?.precioPorUnidadBase).toBe('800');

    // Cumplimiento: 1 abierta y 1 cancelada; llegó el 40 % del valor.
    expect(despues.cumplimiento.find((c) => c.proveedor.id === proveedorId)).toMatchObject({
      compras: 2,
      abiertas: 1,
      canceladas: 1,
      completas: 0,
      porcentajeEntregado: 40,
    });

    // La entrega de esta semana, con su valor.
    const renglon = despues.entregasPorSemana
      .flatMap((semana) => semana.renglones)
      .find((r) => r.proveedor.id === proveedorId);
    expect(renglon?.cantidad).toBe('4');
    expect(renglon?.valor).toBe('80000');
    expect(renglon?.compraNumero).toBe(compra.numero);
  });

  it('un período que no incluye la compra no la muestra', async () => {
    await entrarComo('dueno@panaderia.test');
    const { proveedorId } = await escenario();
    const viejo = await reportes('desde=2020-01-01&hasta=2020-01-31');
    expect(viejo.gastoPorProveedor.some((g) => g.proveedor.id === proveedorId)).toBe(false);
    expect(viejo.gastoPorMes).toEqual([{ mes: '2020-01', comprado: '0', pagado: '0' }]);
  });

  it('sin fechas: los últimos 12 meses, terminando hoy', async () => {
    await entrarComo('dueno@panaderia.test');
    const r = await reportes('');
    expect(r.hasta).toBe(hoy);
    expect(r.gastoPorMes).toHaveLength(12);
    expect(r.gastoPorMes.at(-1)?.mes).toBe(hoy.slice(0, 7));
  });

  it('fechas inválidas o al revés: 400', async () => {
    await entrarComo('dueno@panaderia.test');
    expect((await api.get('/api/reportes?desde=2026-02-30')).status).toBe(400);
    expect((await api.get('/api/reportes?desde=2026-05-01&hasta=2026-04-01')).status).toBe(400);
  });

  it('el empleado no ve reportes; la otra empresa no ve nada de esta', async () => {
    await entrarComo('dueno@panaderia.test');
    const { proveedorId, insumoId } = await escenario();

    api.olvidarCookies();
    await entrarComo('empleado@panaderia.test');
    expect((await api.get('/api/reportes')).status).toBe(403);

    api.olvidarCookies();
    await entrarComo('dueno@vecina.test');
    const ajenos = await reportes();
    const texto = JSON.stringify(ajenos);
    expect(texto).not.toContain(proveedorId);
    expect(texto).not.toContain(insumoId);
  });
});
