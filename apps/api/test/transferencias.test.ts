import type {
  HistorialMovimientos,
  InsumoDetalle,
  ListaTransferencias,
  RecepcionDetalle,
  TransferenciaDetalle,
} from '@panaderia/shared';
import { TransferenciaDetalleSchema } from '@panaderia/shared';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { PASSWORD_DEV } from '../prisma/semilla.js';
import { cerrarConexiones, prisma } from '../src/lib/db.js';
import { reiniciarLimitadores } from '../src/modules/auth/service.js';
import { ClienteHttp } from './cliente-http.js';

/**
 * TRANSFERENCIAS ENTRE SUCURSALES (Fase 9).
 *
 * El invariante que recorre el archivo: una transferencia no crea ni destruye
 * insumos. La suma de las dos sucursales antes y después es la misma, salvo
 * exactamente la merma declarada por "Diferencia en transferencia".
 */

let api: ClienteHttp;
let empresaId: string;
let centralId: string;
let laferrereId: string;
let unidadKgId: string;
let unidadGId: string;

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
  unidadGId = empresa.unidades.find((u) => u.codigo === 'g')?.id ?? '';
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

/** Un insumo nuevo, en kg, con el saldo pedido en la Central. */
async function conSaldoEnCentral(cantidad: string): Promise<string> {
  const creado = await api.post('/api/insumos', {
    nombre: `Harina transferencia ${String(Date.now())}-${String(Math.random()).slice(2, 8)}`,
    unidadBaseId: unidadKgId,
  });
  expect(creado.status).toBe(201);
  const insumoId = (creado.cuerpo as InsumoDetalle).id;
  const inicial = await api.post('/api/movimientos/saldo-inicial', {
    sucursalId: centralId,
    lineas: [{ insumoId, cantidad }],
  });
  expect(inicial.status).toBe(201);
  return insumoId;
}

async function saldo(insumoId: string, sucursalId: string): Promise<string> {
  const agregado = await prisma.movimientoStock.aggregate({
    where: { empresaId, sucursalId, insumoId },
    _sum: { cantidadBase: true },
  });
  return agregado._sum.cantidadBase?.toString() ?? '0';
}

async function enviar(insumoId: string, cantidad: string, extra = {}) {
  return api.post('/api/transferencias', {
    sucursalOrigenId: centralId,
    sucursalDestinoId: laferrereId,
    lineas: [{ insumoId, cantidad }],
    ...extra,
  });
}

async function enviada(insumoId: string, cantidad: string): Promise<TransferenciaDetalle> {
  const r = await enviar(insumoId, cantidad);
  expect(r.status, JSON.stringify(r.cuerpo)).toBe(201);
  return TransferenciaDetalleSchema.parse(r.cuerpo);
}

function recibir(transferencia: TransferenciaDetalle, cantidades: string[], extra = {}) {
  return api.post(`/api/transferencias/${transferencia.id}/recibir`, {
    lineas: transferencia.lineas.map((linea, indice) => ({
      lineaId: linea.id,
      cantidadRecibida: cantidades[indice] ?? linea.cantidadBaseEnviada,
    })),
    ...extra,
  });
}

// ===========================================================================

describe('enviar', () => {
  it('✅ 20 kg de Central a Laferrere: Central baja 20, Laferrere no cambia, y queda en tránsito en las dos bandejas', async () => {
    await entrarComo('dueno@panaderia.test');
    const insumoId = await conSaldoEnCentral('50');

    const transferencia = await enviada(insumoId, '20');
    expect(transferencia.estado).toBe('ENVIADA');
    expect(transferencia.acciones).toEqual(['recibir', 'anular']);
    expect(transferencia.lineas[0]?.cantidadBaseEnviada).toBe('20');
    expect(transferencia.lineas[0]?.cantidadBaseRecibida).toBeNull();

    expect(await saldo(insumoId, centralId)).toBe('30');
    expect(await saldo(insumoId, laferrereId)).toBe('0');

    // "Salieron de acá" en la Central y "vienen para acá" en Laferrere.
    const salientes = (
      await api.get(
        `/api/transferencias?sucursalId=${centralId}&direccion=SALIENTES&estado=ENVIADA`,
      )
    ).cuerpo as ListaTransferencias;
    const entrantes = (
      await api.get(
        `/api/transferencias?sucursalId=${laferrereId}&direccion=ENTRANTES&estado=ENVIADA`,
      )
    ).cuerpo as ListaTransferencias;
    expect(salientes.items.map((t) => t.id)).toContain(transferencia.id);
    expect(entrantes.items.map((t) => t.id)).toContain(transferencia.id);
  });

  it('no se puede enviar más de lo que hay; con permiso, se puede forzar', async () => {
    await entrarComo('dueno@panaderia.test');
    const insumoId = await conSaldoEnCentral('10');

    const demas = await enviar(insumoId, '15');
    expect(demas.status).toBe(409);
    expect(codigoError(demas)).toBe('STOCK_INSUFICIENTE');
    expect(await saldo(insumoId, centralId)).toBe('10');
    // Y no quedó una transferencia a medias: la transacción se deshizo entera.
    expect(await prisma.lineaTransferencia.count({ where: { insumoId } })).toBe(0);

    const forzada = await enviar(insumoId, '15', { forzar: true });
    expect(forzada.status).toBe(201);
    expect(await saldo(insumoId, centralId)).toBe('-5');
  });

  it('el destino tiene que ser otra sucursal', async () => {
    await entrarComo('dueno@panaderia.test');
    const insumoId = await conSaldoEnCentral('10');
    const r = await enviar(insumoId, '1', { sucursalDestinoId: centralId });
    expect(r.status).toBe(400);
  });

  it('se puede enviar en otra unidad: 2000 g de un insumo que se lleva en kg', async () => {
    await entrarComo('dueno@panaderia.test');
    const insumoId = await conSaldoEnCentral('10');
    const r = await api.post('/api/transferencias', {
      sucursalOrigenId: centralId,
      sucursalDestinoId: laferrereId,
      lineas: [{ insumoId, cantidad: '2000', unidadId: unidadGId }],
    });
    expect(r.status).toBe(201);
    const linea = (r.cuerpo as TransferenciaDetalle).lineas[0];
    expect(linea?.cantidadIngresada).toBe('2000');
    expect(linea?.unidadIngresadaCodigo).toBe('g');
    expect(linea?.cantidadBaseEnviada).toBe('2');
    expect(await saldo(insumoId, centralId)).toBe('8');
  });
});

describe('recibir', () => {
  it('✅ salieron 20, llegaron 18 → Laferrere sube 18 y queda una merma de 2 con motivo "Diferencia en transferencia"', async () => {
    await entrarComo('dueno@panaderia.test');
    const insumoId = await conSaldoEnCentral('50');
    const transferencia = await enviada(insumoId, '20');

    const r = await recibir(transferencia, ['18']);
    expect(r.status, JSON.stringify(r.cuerpo)).toBe(200);
    const recibida = TransferenciaDetalleSchema.parse(r.cuerpo);
    expect(recibida.estado).toBe('RECIBIDA');
    expect(recibida.conDiferencia).toBe(true);
    expect(recibida.lineas[0]?.diferencia).toBe('2');

    expect(await saldo(insumoId, laferrereId)).toBe('18');
    // La Central NO baja más: ya había bajado los 20 al enviar.
    expect(await saldo(insumoId, centralId)).toBe('30');

    const merma = await prisma.movimientoStock.findFirstOrThrow({
      where: { insumoId, tipo: 'MERMA' },
      include: { motivo: true },
    });
    expect(merma.sucursalId).toBe(laferrereId);
    expect(merma.cantidadBase.toString()).toBe('-2');
    expect(merma.motivo?.nombre).toBe('Diferencia en transferencia');
    expect(merma.transferenciaId).toBe(transferencia.id);
  });

  it('✅ LA CONSERVACIÓN: la suma de las dos sucursales baja exactamente la merma declarada', async () => {
    await entrarComo('dueno@panaderia.test');
    const insumoId = await conSaldoEnCentral('100');
    await api.post('/api/movimientos/saldo-inicial', {
      sucursalId: laferrereId,
      lineas: [{ insumoId, cantidad: '7.5' }],
    });
    const suma = async () =>
      (
        await prisma.movimientoStock.aggregate({
          where: { insumoId },
          _sum: { cantidadBase: true },
        })
      )._sum.cantidadBase?.toString();

    expect(await suma()).toBe('107.5');

    // Completa: la suma no cambia.
    await recibir(await enviada(insumoId, '40'), []);
    expect(await suma()).toBe('107.5');

    // Con diferencia: la suma baja exactamente lo que dice la merma.
    await recibir(await enviada(insumoId, '12.25'), ['12']);
    expect(await suma()).toBe('107.25');
    const mermas = await prisma.movimientoStock.aggregate({
      where: { insumoId, tipo: 'MERMA' },
      _sum: { cantidadBase: true },
    });
    expect(mermas._sum.cantidadBase?.toString()).toBe('-0.25');

    // Y cada sucursal por separado.
    expect(await saldo(insumoId, centralId)).toBe('47.75');
    expect(await saldo(insumoId, laferrereId)).toBe('59.5');
  });

  it('✅ recibirla de nuevo → 409', async () => {
    await entrarComo('dueno@panaderia.test');
    const insumoId = await conSaldoEnCentral('50');
    const transferencia = await enviada(insumoId, '20');
    expect((await recibir(transferencia, [])).status).toBe(200);

    const otraVez = await recibir(transferencia, []);
    expect(otraVez.status).toBe(409);
    expect(codigoError(otraVez)).toBe('TRANSFERENCIA_NO_EN_TRANSITO');
    expect(await saldo(insumoId, laferrereId)).toBe('20');
  });

  it('no puede llegar más de lo que salió', async () => {
    await entrarComo('dueno@panaderia.test');
    const insumoId = await conSaldoEnCentral('50');
    const transferencia = await enviada(insumoId, '20');

    const r = await recibir(transferencia, ['21']);
    expect(r.status).toBe(400);
    expect((r.cuerpo as { detalles: Record<string, string> }).detalles).toHaveProperty(
      'lineas.0.cantidadRecibida',
    );
    expect(await saldo(insumoId, laferrereId)).toBe('0');
  });

  it('hay que decir cuánto llegó de CADA línea', async () => {
    await entrarComo('dueno@panaderia.test');
    const a = await conSaldoEnCentral('10');
    const b = await conSaldoEnCentral('10');
    const r = await api.post('/api/transferencias', {
      sucursalOrigenId: centralId,
      sucursalDestinoId: laferrereId,
      lineas: [
        { insumoId: a, cantidad: '1' },
        { insumoId: b, cantidad: '1' },
      ],
    });
    const transferencia = r.cuerpo as TransferenciaDetalle;

    const incompleta = await api.post(`/api/transferencias/${transferencia.id}/recibir`, {
      lineas: [{ lineaId: transferencia.lineas[0]?.id, cantidadRecibida: '1' }],
    });
    expect(incompleta.status).toBe(400);
  });

  it('no puede haber llegado antes de salir', async () => {
    await entrarComo('dueno@panaderia.test');
    const insumoId = await conSaldoEnCentral('10');
    const transferencia = await enviada(insumoId, '5');
    const r = await recibir(transferencia, [], { fecha: '2020-01-01T12:00:00Z' });
    expect(r.status).toBe(400);
  });

  it('contar cero es válido: no llegó nada, y todo es merma', async () => {
    await entrarComo('dueno@panaderia.test');
    const insumoId = await conSaldoEnCentral('10');
    const transferencia = await enviada(insumoId, '5');
    const r = await recibir(transferencia, ['0']);
    expect(r.status).toBe(200);
    expect(await saldo(insumoId, laferrereId)).toBe('0');
    expect((r.cuerpo as TransferenciaDetalle).lineas[0]?.diferencia).toBe('5');
  });

  it('la mercadería viaja AL COSTO: entra al destino con el costo con que salió, y el promedio no cambia', async () => {
    await entrarComo('dueno@panaderia.test');
    const creado = await api.post('/api/insumos', {
      nombre: `Azúcar transferencia ${String(Date.now())}`,
      unidadBaseId: unidadKgId,
    });
    const insumoId = (creado.cuerpo as InsumoDetalle).id;
    const proveedor = await api.post('/api/proveedores', {
      nombre: `Proveedor transferencia ${String(Date.now())}`,
    });
    const compra = await api.post('/api/recepciones', {
      sucursalId: centralId,
      proveedorId: (proveedor.cuerpo as { id: string }).id,
      lineas: [{ insumoId, presentacionId: null, cantidad: '100', precioUnitario: '900' }],
    });
    expect((compra.cuerpo as RecepcionDetalle).costos[0]?.costoPromedio).toBe('900');

    const transferencia = await enviada(insumoId, '30');
    await recibir(transferencia, ['29']);

    const movimientos = await prisma.movimientoStock.findMany({
      where: { transferenciaId: transferencia.id },
    });
    expect(movimientos.map((m) => m.costoUnitario?.toString())).toEqual(['900', '900', '900']);
    const insumo = await prisma.insumo.findUniqueOrThrow({ where: { id: insumoId } });
    expect(insumo.costoPromedio?.toString()).toBe('900');
  });

  it('el historial de cada sucursal muestra la transferencia', async () => {
    await entrarComo('dueno@panaderia.test');
    const insumoId = await conSaldoEnCentral('10');
    const transferencia = await enviada(insumoId, '4');
    await recibir(transferencia, []);

    const r = await api.get(`/api/insumos/${insumoId}/movimientos?sucursalId=${laferrereId}`);
    const entrada = (r.cuerpo as HistorialMovimientos).items[0];
    expect(entrada?.tipo).toBe('TRANSFERENCIA_ENTRADA');
    expect(entrada?.transferencia?.numero).toBe(transferencia.numero);
    expect(entrada?.transferencia?.origenNombre).toBe('Central');
  });
});

describe('anular', () => {
  it('✅ anular una enviada → el stock de la Central vuelve', async () => {
    await entrarComo('dueno@panaderia.test');
    const insumoId = await conSaldoEnCentral('50');
    const transferencia = await enviada(insumoId, '20');
    expect(await saldo(insumoId, centralId)).toBe('30');

    const r = await api.post(`/api/transferencias/${transferencia.id}/anular`, {
      motivo: 'Se cargó la sucursal equivocada',
    });
    expect(r.status).toBe(200);
    expect((r.cuerpo as TransferenciaDetalle).estado).toBe('ANULADA');
    expect(await saldo(insumoId, centralId)).toBe('50');
    expect(await saldo(insumoId, laferrereId)).toBe('0');

    // Y ya no se puede recibir.
    expect((await recibir(transferencia, [])).status).toBe(409);
  });

  it('✅ anular una ya recibida → 409', async () => {
    await entrarComo('dueno@panaderia.test');
    const insumoId = await conSaldoEnCentral('50');
    const transferencia = await enviada(insumoId, '20');
    await recibir(transferencia, []);

    const r = await api.post(`/api/transferencias/${transferencia.id}/anular`, {
      motivo: 'Me arrepentí',
    });
    expect(r.status).toBe(409);
    expect((r.cuerpo as { mensaje: string }).mensaje).toMatch(/transferencia de vuelta/);
  });

  it('un movimiento de transferencia no se anula suelto desde el historial', async () => {
    await entrarComo('dueno@panaderia.test');
    const insumoId = await conSaldoEnCentral('10');
    const transferencia = await enviada(insumoId, '4');
    const salida = await prisma.movimientoStock.findFirstOrThrow({
      where: { transferenciaId: transferencia.id },
    });

    const r = await api.post(`/api/movimientos/${salida.id}/reversa`, {});
    expect(r.status).toBe(409);
    expect(codigoError(r)).toBe('MOVIMIENTO_DE_TRANSFERENCIA');
  });
});

describe('permisos y sucursales', () => {
  async function encargadoSoloDe(sucursalId: string): Promise<string> {
    await entrarComo('dueno@panaderia.test');
    const email = `encargado-${String(Date.now())}-${String(Math.random()).slice(2, 6)}@panaderia.test`;
    const alta = await api.post('/api/usuarios', {
      email,
      nombre: 'Encargado de una sola',
      rol: 'ENCARGADO',
      password: PASSWORD_DEV,
      sucursalIds: [sucursalId],
    });
    expect(alta.status).toBe(201);
    return email;
  }

  it('el empleado no envía ni recibe', async () => {
    await entrarComo('dueno@panaderia.test');
    const insumoId = await conSaldoEnCentral('10');
    const transferencia = await enviada(insumoId, '2');

    api.olvidarCookies();
    await entrarComo('empleado@panaderia.test');
    expect((await enviar(insumoId, '1')).status).toBe(403);
    expect((await recibir(transferencia, [])).status).toBe(403);
  });

  it('el encargado de Laferrere recibe en Laferrere, pero no envía desde la Central', async () => {
    const email = await encargadoSoloDe(laferrereId);
    const insumoId = await conSaldoEnCentral('10');
    const transferencia = await enviada(insumoId, '2');

    api.olvidarCookies();
    await entrarComo(email);
    expect((await enviar(insumoId, '1')).status).toBe(403);
    // No puede anularla: anula quien envía.
    const anular = await api.post(`/api/transferencias/${transferencia.id}/anular`, {
      motivo: 'Probando',
    });
    expect(anular.status).toBe(403);
    expect((await recibir(transferencia, [])).status).toBe(200);
  });

  it('el encargado de la Central no confirma lo que llega a Laferrere (C-19)', async () => {
    const email = await encargadoSoloDe(centralId);
    const insumoId = await conSaldoEnCentral('10');
    const transferencia = await enviada(insumoId, '2');

    api.olvidarCookies();
    await entrarComo(email);
    // Sí la ve (es su envío) y la puede anular, pero no recibirla.
    expect((await api.get(`/api/transferencias/${transferencia.id}`)).status).toBe(200);
    expect((await recibir(transferencia, [])).status).toBe(403);
  });

  it('GET /sucursales trae todas las de la empresa, para elegir el destino', async () => {
    const email = await encargadoSoloDe(centralId);
    api.olvidarCookies();
    await entrarComo(email);
    const r = await api.get('/api/sucursales');
    expect(r.status).toBe(200);
    // Aunque solo opere en la Central, Laferrere aparece como destino posible.
    expect((r.cuerpo as { codigo: string }[]).map((s) => s.codigo).sort()).toEqual(['CEN', 'LAF']);
  });
});

describe('concurrencia', () => {
  it('dos personas confirman la misma recepción a la vez: una entra, la otra choca, y el destino suma UNA vez', async () => {
    await entrarComo('dueno@panaderia.test');
    const insumoId = await conSaldoEnCentral('50');
    const transferencia = await enviada(insumoId, '20');

    const [a, b] = await Promise.all([recibir(transferencia, []), recibir(transferencia, [])]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    expect(await saldo(insumoId, laferrereId)).toBe('20');
  });

  it('recibir y anular a la vez: gana una, y el stock queda coherente', async () => {
    await entrarComo('dueno@panaderia.test');
    const insumoId = await conSaldoEnCentral('50');
    const transferencia = await enviada(insumoId, '20');

    const [r, a] = await Promise.all([
      recibir(transferencia, []),
      api.post(`/api/transferencias/${transferencia.id}/anular`, { motivo: 'Carrera' }),
    ]);
    expect([r.status, a.status].sort()).toEqual([200, 409]);

    const central = await saldo(insumoId, centralId);
    const laferrere = await saldo(insumoId, laferrereId);
    // O llegó (30 y 20) o se anuló (50 y 0). Nunca las dos cosas.
    expect([`${central}/${laferrere}`]).toContainEqual(r.status === 200 ? '30/20' : '50/0');
  });
});
