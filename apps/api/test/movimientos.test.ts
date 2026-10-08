import type {
  HistorialMovimientos,
  InsumoDetalle,
  Motivo,
  ResultadoCarga,
  StockPorSucursal,
} from '@panaderia/shared';
import {
  HistorialMovimientosSchema,
  ResultadoCargaSchema,
  SENTIDO_POR_TIPO,
  StockPorSucursalSchema,
  TIPOS_MOVIMIENTO,
} from '@panaderia/shared';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { PASSWORD_DEV } from '../prisma/semilla.js';
import { cerrarConexiones, prisma } from '../src/lib/db.js';
import { reiniciarLimitadores } from '../src/modules/auth/service.js';
import { ClienteHttp } from './cliente-http.js';

let api: ClienteHttp;
let empresaId: string;
let centralId: string;
let laferrereId: string;
let unidadKgId: string;
let unidadGramoId: string;
let unidadLitroId: string;
let motivoVencidoId: string;
let motivoConteoId: string;

beforeAll(async () => {
  api = await ClienteHttp.levantar();

  const empresa = await prisma.empresa.findFirstOrThrow({
    where: { nombre: 'Panadería Laferrere' },
    include: { sucursales: true, unidades: true, motivos: true },
  });
  empresaId = empresa.id;
  centralId = empresa.sucursales.find((s) => s.codigo === 'CEN')?.id ?? '';
  laferrereId = empresa.sucursales.find((s) => s.codigo === 'LAF')?.id ?? '';
  unidadKgId = empresa.unidades.find((u) => u.codigo === 'kg')?.id ?? '';
  unidadGramoId = empresa.unidades.find((u) => u.codigo === 'g')?.id ?? '';
  unidadLitroId = empresa.unidades.find((u) => u.codigo === 'l')?.id ?? '';
  motivoVencidoId =
    empresa.motivos.find((m) => m.nombre === 'Vencido' && m.tipoAplicable === 'MERMA')?.id ?? '';
  motivoConteoId = empresa.motivos.find((m) => m.nombre === 'Diferencia de conteo')?.id ?? '';
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

function carga(cuerpo: unknown): ResultadoCarga {
  return cuerpo as ResultadoCarga;
}
function stock(cuerpo: unknown): StockPorSucursal {
  return cuerpo as StockPorSucursal;
}
function historial(cuerpo: unknown): HistorialMovimientos {
  return cuerpo as HistorialMovimientos;
}
function codigoError(respuesta: { cuerpo: unknown }): string {
  return (respuesta.cuerpo as { codigo: string }).codigo;
}
function mensajeError(respuesta: { cuerpo: unknown }): string {
  return (respuesta.cuerpo as { mensaje: string }).mensaje;
}
function detallesError(respuesta: { cuerpo: unknown }): Record<string, string> {
  return (respuesta.cuerpo as { detalles: Record<string, string> }).detalles;
}

function nombreNuevo(prefijo: string): string {
  return `${prefijo} ${String(Date.now())}-${String(Math.floor(Math.random() * 1000000))}`;
}

/**
 * Un insumo NUEVO para cada test.
 *
 * Es lo que hace que los tests de stock sean independientes: si todos
 * movieran la "Harina 000" de la semilla, el saldo dependería del orden en que
 * corrieron y un test podría pasar o fallar según el día.
 */
async function insumoNuevo(unidadBaseId = unidadKgId): Promise<string> {
  const r = await api.post('/api/insumos', {
    nombre: nombreNuevo('Insumo stock'),
    codigo: null,
    categoriaId: null,
    unidadBaseId,
  });
  expect(r.status, 'crear insumo de prueba').toBe(201);
  return (r.cuerpo as InsumoDetalle).id;
}

/** Deja un insumo con stock inicial y devuelve su id. */
async function conSaldoInicial(cantidad: string, sucursalId = centralId): Promise<string> {
  const insumoId = await insumoNuevo();
  const r = await api.post('/api/movimientos/saldo-inicial', {
    sucursalId,
    lineas: [{ insumoId, cantidad }],
  });
  expect(r.status, 'cargar saldo inicial').toBe(201);
  return insumoId;
}

async function saldoDe(insumoId: string, sucursalId = centralId): Promise<string> {
  const r = await api.get(`/api/insumos/${insumoId}/movimientos?sucursalId=${sucursalId}`);
  expect(r.status).toBe(200);
  return historial(r.cuerpo).saldo;
}

// ===========================================================================

describe('el saldo es la SUMA de los movimientos', () => {
  it('EL CASO DE PLAN.md: 100 de saldo inicial y un consumo de 30 → quedan 70', async () => {
    await entrarComo('dueno@panaderia.test');
    const insumoId = await conSaldoInicial('100');

    const consumo = await api.post('/api/movimientos/consumo', {
      sucursalId: centralId,
      lineas: [{ insumoId, cantidad: '30' }],
    });

    expect(consumo.status).toBe(201);
    expect(ResultadoCargaSchema.safeParse(consumo.cuerpo).success).toBe(true);
    // El resultado de la carga ya informa el saldo nuevo: la pantalla no
    // necesita otro pedido para mostrar "quedan 70".
    expect(carga(consumo.cuerpo).saldos[0]?.saldo).toBe('70');

    const respuesta = await api.get(`/api/insumos/${insumoId}/movimientos?sucursalId=${centralId}`);
    expect(HistorialMovimientosSchema.safeParse(respuesta.cuerpo).success).toBe(true);
    const h = historial(respuesta.cuerpo);
    expect(h.saldo).toBe('70');
    // Y el historial tiene DOS filas, con usuario y fecha.
    expect(h.total).toBe(2);
    expect(h.items.map((m) => m.tipo)).toEqual(['CONSUMO', 'SALDO_INICIAL']);
    for (const movimiento of h.items) {
      expect(movimiento.usuario.nombre).toBe('Dueño');
      expect(new Date(movimiento.fecha).getTime()).not.toBeNaN();
    }
  });

  it('el signo lo pone el tipo: la entrada queda en + y la salida en −', async () => {
    await entrarComo('dueno@panaderia.test');
    const insumoId = await conSaldoInicial('50');
    await api.post('/api/movimientos/consumo', {
      sucursalId: centralId,
      lineas: [{ insumoId, cantidad: '20' }],
    });

    const filas = await prisma.movimientoStock.findMany({
      where: { insumoId, sucursalId: centralId },
      select: { tipo: true, cantidadBase: true, cantidadIngresada: true },
    });

    const inicial = filas.find((f) => f.tipo === 'SALDO_INICIAL');
    const consumo = filas.find((f) => f.tipo === 'CONSUMO');
    expect(inicial?.cantidadBase.toString()).toBe('50');
    expect(consumo?.cantidadBase.toString()).toBe('-20');
    // Y la cantidad TIPEADA queda siempre positiva: el signo es del sistema.
    expect(consumo?.cantidadIngresada.toString()).toBe('20');
  });

  it('el stock de una sucursal NO afecta el de la otra', async () => {
    await entrarComo('dueno@panaderia.test');
    const insumoId = await conSaldoInicial('100', centralId);

    expect(await saldoDe(insumoId, centralId)).toBe('100');
    // El stock pertenece a una sucursal, nunca a la empresa.
    expect(await saldoDe(insumoId, laferrereId)).toBe('0');
  });

  it('un insumo sin ningún movimiento tiene saldo 0, no null', async () => {
    await entrarComo('dueno@panaderia.test');
    const insumoId = await insumoNuevo();
    expect(await saldoDe(insumoId)).toBe('0');
  });
});

describe('conversión de unidades integrada', () => {
  it('EL CASO DE PLAN.md: cargar 2000 g de un insumo que se lleva en kg descuenta 2', async () => {
    await entrarComo('dueno@panaderia.test');
    const insumoId = await conSaldoInicial('10');

    const r = await api.post('/api/movimientos/consumo', {
      sucursalId: centralId,
      lineas: [{ insumoId, cantidad: '2000', unidadId: unidadGramoId }],
    });

    expect(r.status).toBe(201);
    expect(await saldoDe(insumoId)).toBe('8');

    // Y el movimiento guarda las TRES cosas que permiten reconstruir la cuenta
    // dentro de cinco años: lo que se tipeó, en qué unidad, y con qué factor.
    const movimiento = carga(r.cuerpo).movimientos[0];
    expect(movimiento?.cantidadIngresada).toBe('2000');
    expect(movimiento?.unidadIngresada.codigo).toBe('g');
    expect(movimiento?.factorConversion).toBe('0.001');
    expect(movimiento?.cantidadBase).toBe('-2');
  });

  it('vale la igualdad cantidadBase = cantidadIngresada × factor', async () => {
    await entrarComo('dueno@panaderia.test');
    const insumoId = await conSaldoInicial('10');
    await api.post('/api/movimientos/consumo', {
      sucursalId: centralId,
      lineas: [{ insumoId, cantidad: '1500', unidadId: unidadGramoId }],
    });

    const fila = await prisma.movimientoStock.findFirstOrThrow({
      where: { insumoId, tipo: 'CONSUMO' },
    });
    const recalculado = fila.cantidadIngresada.times(fila.factorConversion);
    expect(recalculado.abs().toString()).toBe(fila.cantidadBase.abs().toString());
  });

  it('RECHAZA convertir entre peso y volumen', async () => {
    // Dependería de la densidad del material: 1 litro de agua pesa 1 kg, de
    // aceite ~0,92 y de harina suelta ~0,6. Sin la densidad no hay cuenta.
    await entrarComo('dueno@panaderia.test');
    const insumoId = await conSaldoInicial('10');

    const r = await api.post('/api/movimientos/consumo', {
      sucursalId: centralId,
      lineas: [{ insumoId, cantidad: '1', unidadId: unidadLitroId }],
    });

    expect(r.status).toBe(400);
    expect(codigoError(r)).toBe('DIMENSION_INCOMPATIBLE');
    expect(mensajeError(r)).toMatch(/dimensiones distintas/);
    // Y no se escribió nada.
    expect(await saldoDe(insumoId)).toBe('10');
  });

  it('rechaza una cantidad tan chica que se redondearía a cero', async () => {
    // 0,0001 g en un insumo que se lleva en kg es 0,0000001 kg, y la columna
    // tiene 6 decimales: redondearía a cero y el CHECK lo rechazaría con un
    // error ilegible. Mejor avisarlo con un mensaje entendible.
    await entrarComo('dueno@panaderia.test');
    const insumoId = await conSaldoInicial('10');

    const r = await api.post('/api/movimientos/consumo', {
      sucursalId: centralId,
      lineas: [{ insumoId, cantidad: '0,0001', unidadId: unidadGramoId }],
    });

    expect(r.status).toBe(400);
    expect(detallesError(r)['cantidad']).toMatch(/demasiado chica/);
  });
});

describe('la regla de stock negativo', () => {
  it('EL CASO DE PLAN.md: consumir más de lo que hay da 409 y dice cuánto hay', async () => {
    await entrarComo('dueno@panaderia.test');
    const insumoId = await conSaldoInicial('12,5');

    const r = await api.post('/api/movimientos/consumo', {
      sucursalId: centralId,
      lineas: [{ insumoId, cantidad: '20' }],
    });

    expect(r.status).toBe(409);
    expect(codigoError(r)).toBe('STOCK_INSUFICIENTE');
    // El mensaje tiene que traer el número: un "no se puede" pelado obliga a
    // la persona a irse a otra pantalla a averiguarlo.
    expect(mensajeError(r)).toContain('12,5');
    expect(mensajeError(r)).toContain('20');
    expect(mensajeError(r)).toContain('Central');

    // Y el saldo quedó intacto.
    expect(await saldoDe(insumoId)).toBe('12.5');
  });

  it('el empleado NO puede forzar: pide forzar y de todas formas recibe 409', async () => {
    await entrarComo('encargado@panaderia.test');
    const insumoId = await conSaldoInicial('5', laferrereId);
    api.olvidarCookies();
    reiniciarLimitadores();

    await entrarComo('empleado@panaderia.test');
    const r = await api.post('/api/movimientos/consumo', {
      sucursalId: laferrereId,
      lineas: [{ insumoId, cantidad: '50' }],
      forzar: true,
    });

    expect(r.status).toBe(409);
    expect(codigoError(r)).toBe('STOCK_INSUFICIENTE');
  });

  it('EL CASO DE PLAN.md: el dueño lo fuerza → queda negativo, marcado, y auditado', async () => {
    await entrarComo('dueno@panaderia.test');
    const insumoId = await conSaldoInicial('12,5');

    const r = await api.post('/api/movimientos/consumo', {
      sucursalId: centralId,
      lineas: [{ insumoId, cantidad: '20' }],
      forzar: true,
    });

    expect(r.status).toBe(201);
    expect(await saldoDe(insumoId)).toBe('-7.5');

    // El movimiento queda MARCADO como forzado: el historial tiene que poder
    // mostrar que ahí hubo una decisión, no un dato normal.
    const movimiento = carga(r.cuerpo).movimientos[0];
    expect(movimiento?.forzado).toBe(true);

    // Y hay una fila de auditoría con su propia acción, para poder preguntar
    // "¿cuántas veces se forzó este mes y quién?".
    const auditoria = await prisma.auditoria.findFirst({
      where: { accion: 'FORZAR_STOCK_NEGATIVO', entidadId: insumoId },
      include: { usuario: true },
    });
    expect(auditoria).not.toBeNull();
    expect(auditoria?.usuario?.email).toBe('dueno@panaderia.test');
  });

  it('forzar no marca los movimientos que NO hicieron falta forzar', async () => {
    await entrarComo('dueno@panaderia.test');
    const conMucho = await conSaldoInicial('1000');
    const conPoco = await conSaldoInicial('1');

    const r = await api.post('/api/movimientos/consumo', {
      sucursalId: centralId,
      lineas: [
        { insumoId: conMucho, cantidad: '10' },
        { insumoId: conPoco, cantidad: '10' },
      ],
      forzar: true,
    });

    expect(r.status).toBe(201);
    const porInsumo = new Map(carga(r.cuerpo).movimientos.map((m) => [m.insumo.id, m.forzado]));
    expect(porInsumo.get(conMucho)).toBe(false);
    expect(porInsumo.get(conPoco)).toBe(true);
  });

  it('AGREGAR stock a un saldo negativo no necesita permiso especial', async () => {
    // El resultado sigue siendo negativo, pero está MEJORANDO: trabarlo sería
    // dejar el stock roto para siempre.
    await entrarComo('dueno@panaderia.test');
    const insumoId = await conSaldoInicial('1');
    await api.post('/api/movimientos/consumo', {
      sucursalId: centralId,
      lineas: [{ insumoId, cantidad: '10' }],
      forzar: true,
    });
    expect(await saldoDe(insumoId)).toBe('-9');

    // Un movimiento que suma: pasa sin forzar, aunque el saldo siga negativo.
    const movimiento = await prisma.movimientoStock.findFirstOrThrow({
      where: { insumoId, tipo: 'CONSUMO' },
    });
    const reversa = await api.post(`/api/movimientos/${movimiento.id}/reversa`, {});
    expect(reversa.status).toBe(201);
    expect(await saldoDe(insumoId)).toBe('1');
  });

  it('el control corre contra el saldo ACUMULADO, no contra cada movimiento', async () => {
    await entrarComo('dueno@panaderia.test');
    const insumoId = await conSaldoInicial('10');

    // Tres consumos de 4: los dos primeros entran, el tercero no.
    for (const esperado of [201, 201]) {
      const r = await api.post('/api/movimientos/consumo', {
        sucursalId: centralId,
        lineas: [{ insumoId, cantidad: '4' }],
      });
      expect(r.status).toBe(esperado);
    }
    expect(await saldoDe(insumoId)).toBe('2');

    const tercero = await api.post('/api/movimientos/consumo', {
      sucursalId: centralId,
      lineas: [{ insumoId, cantidad: '4' }],
    });
    expect(tercero.status).toBe(409);
  });
});

describe('TODO o NADA: la transacción', () => {
  it('EL CASO DE PLAN.md: 6 líneas, la 4ª inválida → no se registra NINGUNA', async () => {
    await entrarComo('dueno@panaderia.test');

    // Cinco insumos con stock de sobra y uno con stock insuficiente, en 4º lugar.
    const conStock = await Promise.all([
      conSaldoInicial('100'),
      conSaldoInicial('100'),
      conSaldoInicial('100'),
      conSaldoInicial('100'),
      conSaldoInicial('100'),
    ]);
    const sinStock = await conSaldoInicial('1');

    const lineas = [
      { insumoId: conStock[0] ?? '', cantidad: '10' },
      { insumoId: conStock[1] ?? '', cantidad: '10' },
      { insumoId: conStock[2] ?? '', cantidad: '10' },
      { insumoId: sinStock, cantidad: '999' }, // ← la cuarta
      { insumoId: conStock[3] ?? '', cantidad: '10' },
      { insumoId: conStock[4] ?? '', cantidad: '10' },
    ];

    const r = await api.post('/api/movimientos/consumo', { sucursalId: centralId, lineas });
    expect(r.status).toBe(409);

    // LA VERIFICACIÓN QUE IMPORTA: en la tabla no quedó ni un consumo.
    const consumos = await prisma.movimientoStock.count({
      where: { tipo: 'CONSUMO', insumoId: { in: [...conStock, sinStock] } },
    });
    expect(consumos).toBe(0);

    // Y los saldos siguen enteros.
    for (const insumoId of conStock) {
      expect(await saldoDe(insumoId)).toBe('100');
    }
    expect(await saldoDe(sinStock)).toBe('1');
  });

  it('una línea con un insumo inexistente tampoco deja nada a medias', async () => {
    await entrarComo('dueno@panaderia.test');
    const bueno = await conSaldoInicial('100');

    const r = await api.post('/api/movimientos/consumo', {
      sucursalId: centralId,
      lineas: [
        { insumoId: bueno, cantidad: '10' },
        { insumoId: '11111111-1111-4111-8111-999999999999', cantidad: '5' },
      ],
    });

    expect(r.status).toBe(400);
    expect(await saldoDe(bueno)).toBe('100');
  });

  it('las 6 líneas válidas comparten el mismo operacionId', async () => {
    // Es lo que permite mostrar la carga junta en el historial y, más
    // adelante, anularla completa.
    await entrarComo('dueno@panaderia.test');
    const insumos = await Promise.all([conSaldoInicial('100'), conSaldoInicial('100')]);

    const r = await api.post('/api/movimientos/consumo', {
      sucursalId: centralId,
      lineas: insumos.map((insumoId) => ({ insumoId, cantidad: '5' })),
    });

    expect(r.status).toBe(201);
    const resultado = carga(r.cuerpo);
    expect(resultado.movimientos).toHaveLength(2);
    for (const movimiento of resultado.movimientos) {
      expect(movimiento.operacionId).toBe(resultado.operacionId);
    }
  });
});

describe('mermas', () => {
  it('registra una merma con su motivo', async () => {
    await entrarComo('dueno@panaderia.test');
    const insumoId = await conSaldoInicial('20');

    const r = await api.post('/api/movimientos/merma', {
      sucursalId: centralId,
      motivoId: motivoVencidoId,
      lineas: [{ insumoId, cantidad: '2,5' }],
      notas: 'Se mojó el estante de abajo',
    });

    expect(r.status).toBe(201);
    expect(await saldoDe(insumoId)).toBe('17.5');
    const movimiento = carga(r.cuerpo).movimientos[0];
    expect(movimiento?.tipo).toBe('MERMA');
    expect(movimiento?.motivo?.nombre).toBe('Vencido');
    expect(movimiento?.notas).toBe('Se mojó el estante de abajo');
  });

  it('REGLA: sin motivo no hay merma', async () => {
    await entrarComo('dueno@panaderia.test');
    const insumoId = await conSaldoInicial('20');

    const r = await api.post('/api/movimientos/merma', {
      sucursalId: centralId,
      lineas: [{ insumoId, cantidad: '1' }],
    });

    expect(r.status).toBe(400);
    expect(detallesError(r)['motivoId']).toBeDefined();
  });

  it('REGLA: el motivo tiene que servir para ESE tipo de movimiento', async () => {
    // "Diferencia de conteo" es un motivo de AJUSTE: en una merma no explica
    // nada, y si se aceptara, el informe de pérdidas mezclaría peras con
    // manzanas.
    await entrarComo('dueno@panaderia.test');
    const insumoId = await conSaldoInicial('20');

    const r = await api.post('/api/movimientos/merma', {
      sucursalId: centralId,
      motivoId: motivoConteoId,
      lineas: [{ insumoId, cantidad: '1' }],
    });

    expect(r.status).toBe(400);
    expect(detallesError(r)['motivoId']).toMatch(/no se puede usar/);
  });

  it('el empleado puede cargar mermas de su sucursal: es su trabajo', async () => {
    await entrarComo('encargado@panaderia.test');
    const insumoId = await conSaldoInicial('20', laferrereId);
    api.olvidarCookies();
    reiniciarLimitadores();

    await entrarComo('empleado@panaderia.test');
    const r = await api.post('/api/movimientos/merma', {
      sucursalId: laferrereId,
      motivoId: motivoVencidoId,
      lineas: [{ insumoId, cantidad: '1' }],
    });
    expect(r.status).toBe(201);
  });

  it('el empleado NO puede cargar en una sucursal que no es la suya', async () => {
    // El empleado de la semilla está asignado solo a LAF.
    await entrarComo('empleado@panaderia.test');
    const r = await api.post('/api/movimientos/merma', {
      sucursalId: centralId,
      motivoId: motivoVencidoId,
      lineas: [{ insumoId: '11111111-1111-4111-8111-999999999999', cantidad: '1' }],
    });
    expect(r.status).toBe(403);
    expect(codigoError(r)).toBe('SUCURSAL_NO_PERMITIDA');
  });
});

describe('el saldo inicial', () => {
  it('REGLA: se carga UNA sola vez por insumo y sucursal', async () => {
    // Sin esta regla, un doble clic duplicaría el stock en silencio.
    await entrarComo('dueno@panaderia.test');
    const insumoId = await conSaldoInicial('100');

    const r = await api.post('/api/movimientos/saldo-inicial', {
      sucursalId: centralId,
      lineas: [{ insumoId, cantidad: '100' }],
    });

    expect(r.status).toBe(409);
    expect(codigoError(r)).toBe('SALDO_INICIAL_YA_CARGADO');
    expect(await saldoDe(insumoId)).toBe('100');
  });

  it('pero sí se puede cargar en la OTRA sucursal', async () => {
    await entrarComo('dueno@panaderia.test');
    const insumoId = await conSaldoInicial('100', centralId);

    const r = await api.post('/api/movimientos/saldo-inicial', {
      sucursalId: laferrereId,
      lineas: [{ insumoId, cantidad: '40' }],
    });

    expect(r.status).toBe(201);
    expect(await saldoDe(insumoId, centralId)).toBe('100');
    expect(await saldoDe(insumoId, laferrereId)).toBe('40');
  });

  it('REGLA: no se le carga saldo inicial a un insumo inactivo', async () => {
    await entrarComo('dueno@panaderia.test');
    const insumoId = await insumoNuevo();
    await api.post(`/api/insumos/${insumoId}/desactivar`);

    const r = await api.post('/api/movimientos/saldo-inicial', {
      sucursalId: centralId,
      lineas: [{ insumoId, cantidad: '10' }],
    });
    expect(r.status).toBe(400);
    expect(detallesError(r)['insumoId']).toMatch(/inactivo/);
  });

  it('el empleado no carga saldo inicial', async () => {
    await entrarComo('empleado@panaderia.test');
    const r = await api.post('/api/movimientos/saldo-inicial', {
      sucursalId: laferrereId,
      lineas: [{ insumoId: '11111111-1111-4111-8111-999999999999', cantidad: '1' }],
    });
    expect(r.status).toBe(403);
    expect(codigoError(r)).toBe('SIN_PERMISO');
  });
});

describe('la reversa (contra-asiento)', () => {
  it('EL CASO DE PLAN.md: anulo el consumo de 30 → el saldo vuelve a 100 y el original SIGUE', async () => {
    await entrarComo('dueno@panaderia.test');
    const insumoId = await conSaldoInicial('100');
    const consumo = await api.post('/api/movimientos/consumo', {
      sucursalId: centralId,
      lineas: [{ insumoId, cantidad: '30' }],
    });
    const movimientoId = carga(consumo.cuerpo).movimientos[0]?.id ?? '';
    expect(await saldoDe(insumoId)).toBe('70');

    const r = await api.post(`/api/movimientos/${movimientoId}/reversa`, {
      notas: 'Me equivoqué de insumo',
    });

    expect(r.status).toBe(201);
    // El saldo vuelve EXACTO.
    expect(await saldoDe(insumoId)).toBe('100');

    const h = historial(
      (await api.get(`/api/insumos/${insumoId}/movimientos?sucursalId=${centralId}`)).cuerpo,
    );
    // TRES filas, no una: el original no desapareció.
    expect(h.total).toBe(3);
    expect(h.items.map((m) => m.tipo).sort()).toEqual(['CONSUMO', 'REVERSA', 'SALDO_INICIAL']);

    const reversa = h.items.find((m) => m.tipo === 'REVERSA');
    expect(reversa?.cantidadBase).toBe('30');
    expect(reversa?.revierteAId).toBe(movimientoId);
    expect(reversa?.notas).toBe('Me equivoqué de insumo');

    // Y el original queda marcado como anulado, para que la pantalla no
    // ofrezca anularlo otra vez.
    const original = h.items.find((m) => m.id === movimientoId);
    expect(original?.revertido).toBe(true);
    expect(original?.cantidadBase).toBe('-30');
  });

  it('la reversa devuelve el saldo exacto incluso con decimales', async () => {
    await entrarComo('dueno@panaderia.test');
    const insumoId = await conSaldoInicial('100');
    const consumo = await api.post('/api/movimientos/consumo', {
      sucursalId: centralId,
      lineas: [{ insumoId, cantidad: '33,333333' }],
    });
    const movimientoId = carga(consumo.cuerpo).movimientos[0]?.id ?? '';

    await api.post(`/api/movimientos/${movimientoId}/reversa`, {});
    expect(await saldoDe(insumoId)).toBe('100');
  });

  it('la reversa de un movimiento cargado en gramos vuelve exacto', async () => {
    // Acá está la razón por la que la reversa se arma con la cantidad BASE y
    // no recalculando desde la cantidad tipeada: si el factor de la unidad
    // cambiara, recalcular daría otro número.
    await entrarComo('dueno@panaderia.test');
    const insumoId = await conSaldoInicial('10');
    const consumo = await api.post('/api/movimientos/consumo', {
      sucursalId: centralId,
      lineas: [{ insumoId, cantidad: '2500', unidadId: unidadGramoId }],
    });
    expect(await saldoDe(insumoId)).toBe('7.5');

    const movimientoId = carga(consumo.cuerpo).movimientos[0]?.id ?? '';
    await api.post(`/api/movimientos/${movimientoId}/reversa`, {});
    expect(await saldoDe(insumoId)).toBe('10');
  });

  it('REGLA: un movimiento no se puede revertir DOS veces', async () => {
    await entrarComo('dueno@panaderia.test');
    const insumoId = await conSaldoInicial('100');
    const consumo = await api.post('/api/movimientos/consumo', {
      sucursalId: centralId,
      lineas: [{ insumoId, cantidad: '30' }],
    });
    const movimientoId = carga(consumo.cuerpo).movimientos[0]?.id ?? '';

    expect((await api.post(`/api/movimientos/${movimientoId}/reversa`, {})).status).toBe(201);
    const segunda = await api.post(`/api/movimientos/${movimientoId}/reversa`, {});

    expect(segunda.status).toBe(409);
    expect(codigoError(segunda)).toBe('MOVIMIENTO_YA_REVERTIDO');
    // Y el saldo no se movió de más.
    expect(await saldoDe(insumoId)).toBe('100');
  });

  it('REGLA: una reversa no se puede anular', async () => {
    await entrarComo('dueno@panaderia.test');
    const insumoId = await conSaldoInicial('100');
    const consumo = await api.post('/api/movimientos/consumo', {
      sucursalId: centralId,
      lineas: [{ insumoId, cantidad: '30' }],
    });
    const r = await api.post(
      `/api/movimientos/${carga(consumo.cuerpo).movimientos[0]?.id ?? ''}/reversa`,
      {},
    );
    const reversaId = carga(r.cuerpo).movimientos[0]?.id ?? '';

    const segunda = await api.post(`/api/movimientos/${reversaId}/reversa`, {});
    expect(segunda.status).toBe(409);
    expect(codigoError(segunda)).toBe('NO_SE_ANULA_UNA_REVERSA');
  });

  it('anular una ENTRADA respeta la regla de stock negativo', async () => {
    // Saldo inicial 100, se consumieron 70, quedan 30. Anular el saldo
    // inicial dejaría el stock en -70: tiene que avisar, no hacerlo callado.
    await entrarComo('dueno@panaderia.test');
    const insumoId = await conSaldoInicial('100');
    await api.post('/api/movimientos/consumo', {
      sucursalId: centralId,
      lineas: [{ insumoId, cantidad: '70' }],
    });

    const inicial = await prisma.movimientoStock.findFirstOrThrow({
      where: { insumoId, tipo: 'SALDO_INICIAL' },
    });

    const sinForzar = await api.post(`/api/movimientos/${inicial.id}/reversa`, {});
    expect(sinForzar.status).toBe(409);
    expect(codigoError(sinForzar)).toBe('STOCK_INSUFICIENTE');
    expect(await saldoDe(insumoId)).toBe('30');

    // Con permiso y forzando, sí.
    const forzando = await api.post(`/api/movimientos/${inicial.id}/reversa`, { forzar: true });
    expect(forzando.status).toBe(201);
    expect(await saldoDe(insumoId)).toBe('-70');
  });

  it('el empleado no puede anular', async () => {
    await entrarComo('encargado@panaderia.test');
    const insumoId = await conSaldoInicial('100', laferrereId);
    const consumo = await api.post('/api/movimientos/consumo', {
      sucursalId: laferrereId,
      lineas: [{ insumoId, cantidad: '10' }],
    });
    const movimientoId = carga(consumo.cuerpo).movimientos[0]?.id ?? '';
    api.olvidarCookies();
    reiniciarLimitadores();

    await entrarComo('empleado@panaderia.test');
    const r = await api.post(`/api/movimientos/${movimientoId}/reversa`, {});
    expect(r.status).toBe(403);
    expect(codigoError(r)).toBe('SIN_PERMISO');
  });

  it('no se puede anular un movimiento de una sucursal donde no operás', async () => {
    // La reversa no lleva requiereSucursal (la sucursal no viene en el
    // pedido): el chequeo está en el servicio. Este test es el que lo prueba.
    await entrarComo('dueno@panaderia.test');
    const insumoId = await conSaldoInicial('100', centralId);
    const consumo = await api.post('/api/movimientos/consumo', {
      sucursalId: centralId,
      lineas: [{ insumoId, cantidad: '10' }],
    });
    const movimientoId = carga(consumo.cuerpo).movimientos[0]?.id ?? '';

    // Un usuario que solo opera en LAF, pero que SÍ tiene el permiso de anular.
    const soloLaferrere = `encargado-laf-${String(Date.now())}@panaderia.test`;
    const alta = await api.post('/api/usuarios', {
      email: soloLaferrere,
      nombre: 'Encargado de Laferrere',
      rol: 'ENCARGADO',
      password: 'unaClaveLarga123',
      sucursalIds: [laferrereId],
    });
    expect(alta.status).toBe(201);

    api.olvidarCookies();
    reiniciarLimitadores();
    const login = await api.post('/api/auth/login', {
      email: soloLaferrere,
      password: 'unaClaveLarga123',
    });
    expect(login.status).toBe(200);

    const r = await api.post(`/api/movimientos/${movimientoId}/reversa`, {});
    expect(r.status).toBe(403);
    expect(codigoError(r)).toBe('SUCURSAL_NO_PERMITIDA');
  });
});

describe('GET /api/stock', () => {
  it('trae TODOS los insumos activos, con saldo y mínimo, y el semáforo', async () => {
    await entrarComo('dueno@panaderia.test');
    const insumoId = await conSaldoInicial('40');
    // Mínimo 50 en la central: queda por debajo.
    await api.pedir('PUT', `/api/insumos/${insumoId}/sucursales/${centralId}`, {
      stockMinimo: '50',
      activo: true,
    });

    const r = await api.get(`/api/stock?sucursalId=${centralId}`);
    expect(r.status).toBe(200);
    expect(StockPorSucursalSchema.safeParse(r.cuerpo).success).toBe(true);

    const datos = stock(r.cuerpo);
    expect(datos.sucursal.codigo).toBe('CEN');

    const fila = datos.items.find((item) => item.insumoId === insumoId);
    expect(fila?.saldo).toBe('40');
    expect(fila?.stockMinimo).toBe('50');
    expect(fila?.estado).toBe('BAJO');
    expect(fila?.cantidadMovimientos).toBe(1);

    // Y los 28 insumos de la semilla también están, con saldo 0 y en CRITICO:
    // un insumo que nunca se cargó tiene que verse, no ser invisible.
    const harina = datos.items.find((item) => item.nombre === 'Harina 000');
    expect(harina?.saldo).toBe('0');
    expect(harina?.estado).toBe('CRITICO');
    expect(harina?.cantidadMovimientos).toBe(0);
  });

  it('soloAlertas deja afuera lo que está OK, pero el resumen cuenta todo', async () => {
    await entrarComo('dueno@panaderia.test');
    const insumoId = await conSaldoInicial('500');

    const todo = stock((await api.get(`/api/stock?sucursalId=${centralId}`)).cuerpo);
    expect(todo.items.find((i) => i.insumoId === insumoId)?.estado).toBe('OK');

    const alertas = stock(
      (await api.get(`/api/stock?sucursalId=${centralId}&soloAlertas=true`)).cuerpo,
    );
    expect(alertas.items.some((i) => i.insumoId === insumoId)).toBe(false);
    expect(alertas.items.every((i) => i.estado !== 'OK')).toBe(true);
    // El resumen NO cambia: si no, "solo alertas" mostraría 0 en OK y
    // parecería que no hay nada bien.
    expect(alertas.resumen.ok).toBe(todo.resumen.ok);
  });

  it('filtra por búsqueda', async () => {
    await entrarComo('dueno@panaderia.test');
    const datos = stock(
      (await api.get(`/api/stock?sucursalId=${centralId}&busqueda=harina`)).cuerpo,
    );
    expect(datos.items.length).toBeGreaterThanOrEqual(3);
    for (const item of datos.items) expect(item.nombre.toLowerCase()).toContain('harina');
  });

  it('sin sucursalId responde 400, no una lista de todo', async () => {
    // El stock es de una sucursal, nunca de la empresa: pedirlo sin sucursal
    // no es una consulta válida.
    await entrarComo('dueno@panaderia.test');
    const r = await api.get('/api/stock');
    expect(r.status).toBe(400);
  });

  it('el empleado ve el stock de su sucursal pero no el de la otra', async () => {
    await entrarComo('empleado@panaderia.test');
    expect((await api.get(`/api/stock?sucursalId=${laferrereId}`)).status).toBe(200);
    const r = await api.get(`/api/stock?sucursalId=${centralId}`);
    expect(r.status).toBe(403);
    expect(codigoError(r)).toBe('SUCURSAL_NO_PERMITIDA');
  });
});

describe('GET /api/insumos/:id/movimientos', () => {
  it('pagina y trae el total completo', async () => {
    await entrarComo('dueno@panaderia.test');
    const insumoId = await conSaldoInicial('1000');
    for (let i = 0; i < 4; i += 1) {
      await api.post('/api/movimientos/consumo', {
        sucursalId: centralId,
        lineas: [{ insumoId, cantidad: '1' }],
      });
    }

    const pagina = historial(
      (await api.get(`/api/insumos/${insumoId}/movimientos?sucursalId=${centralId}&limite=2`))
        .cuerpo,
    );
    expect(pagina.items).toHaveLength(2);
    expect(pagina.total).toBe(5);
    expect(pagina.saldo).toBe('996');
  });

  it('un insumo de otra empresa responde 404', async () => {
    const ajeno = await prisma.insumo.findFirstOrThrow({
      where: { empresa: { nombre: { contains: 'Vecina' } } },
    });
    await entrarComo('dueno@panaderia.test');
    const r = await api.get(`/api/insumos/${ajeno.id}/movimientos?sucursalId=${centralId}`);
    expect(r.status).toBe(404);
  });
});

describe('GET /api/motivos', () => {
  it('lista los motivos de la empresa y se puede filtrar por tipo', async () => {
    await entrarComo('dueno@panaderia.test');
    const todos = (await api.get('/api/motivos')).cuerpo as Motivo[];
    expect(todos.length).toBe(9);

    const deMerma = (await api.get('/api/motivos?tipo=MERMA')).cuerpo as Motivo[];
    expect(deMerma.length).toBe(4);
    expect(deMerma.every((m) => m.tipoAplicable === 'MERMA')).toBe(true);
    expect(deMerma.map((m) => m.nombre)).toContain('Vencido');
  });
});

describe('el CHECK de la base y la lógica de TypeScript dicen lo mismo', () => {
  it('para cada tipo y cada signo, Postgres acepta exactamente lo que acepta signoValido', async () => {
    // ESTE ES EL TEST QUE JUSTIFICA TENER LA REGLA ESCRITA DOS VECES.
    //
    // El invariante del signo está en SENTIDO_POR_TIPO (TypeScript, para dar
    // un mensaje en español) y en el CHECK movimiento_signo_segun_tipo
    // (Postgres, para que valga aunque alguien escriba por fuera del
    // servicio). Si los dos se desincronizaran, el sistema rechazaría datos
    // buenos o aceptaría datos imposibles. Acá se comparan uno contra uno.
    const empresa = await prisma.empresa.findFirstOrThrow({ where: { id: empresaId } });
    const insumo = await prisma.insumo.findFirstOrThrow({
      where: { empresaId: empresa.id, nombre: 'Harina 000' },
    });
    const usuario = await prisma.usuario.findFirstOrThrow({
      where: { email: 'dueno@panaderia.test' },
    });

    for (const tipo of TIPOS_MOVIMIENTO) {
      for (const cantidad of ['5', '-5']) {
        const esperado = SENTIDO_POR_TIPO[tipo] === 'AMBOS' || esperaSigno(tipo, cantidad);

        // Cada intento en su propia transacción, que siempre se deshace: el
        // test no deja nada escrito en la base.
        let aceptado = true;
        try {
          await prisma.$transaction(async (tx) => {
            await tx.movimientoStock.create({
              data: {
                empresaId: empresa.id,
                sucursalId: centralId,
                insumoId: insumo.id,
                tipo,
                cantidadBase: cantidad,
                cantidadIngresada: '5',
                unidadIngresadaId: unidadKgId,
                factorConversion: '1',
                fecha: new Date(),
                usuarioId: usuario.id,
                operacionId: crypto.randomUUID(),
              },
            });
            // Siempre se deshace: solo queríamos saber si la base lo aceptaba.
            throw new Error('rollback a propósito');
          });
        } catch (error) {
          aceptado = error instanceof Error && error.message === 'rollback a propósito';
        }

        expect(aceptado, `la base y signoValido no coinciden en ${tipo} con ${cantidad}`).toBe(
          esperado,
        );
      }
    }
  });
});

/** Lo que SENTIDO_POR_TIPO dice que se espera, sin usar signoValido. */
function esperaSigno(tipo: (typeof TIPOS_MOVIMIENTO)[number], cantidad: string): boolean {
  const positivo = !cantidad.startsWith('-');
  return SENTIDO_POR_TIPO[tipo] === 'ENTRADA' ? positivo : !positivo;
}
