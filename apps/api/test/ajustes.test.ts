import type { InsumoDetalle, ResultadoAjuste, ResultadoCarga } from '@panaderia/shared';
import { ResultadoAjusteSchema } from '@panaderia/shared';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { PASSWORD_DEV } from '../prisma/semilla.js';
import { cerrarConexiones, prisma } from '../src/lib/db.js';
import { reiniciarLimitadores } from '../src/modules/auth/service.js';
import { ClienteHttp } from './cliente-http.js';

/**
 * AJUSTAR EL STOCK A LO CONTADO (Fase 7).
 *
 * La idea del módulo entra en una frase: la persona carga CUÁNTO HAY, no la
 * diferencia. El sistema calcula `contado − saldo` y escribe un AJUSTE por cada
 * insumo donde no coincide.
 *
 * El invariante que recorre todo este archivo:
 *   después de un ajuste, el saldo es EXACTAMENTE lo que se contó.
 */

let api: ClienteHttp;
let empresaId: string;
let centralId: string;
let laferrereId: string;
let unidadKgId: string;
let motivoConteoId: string;
let motivoVencidoId: string;

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
  motivoConteoId =
    empresa.motivos.find((m) => m.nombre === 'Diferencia de conteo' && m.tipoAplicable === 'AJUSTE')
      ?.id ?? '';
  motivoVencidoId =
    empresa.motivos.find((m) => m.nombre === 'Vencido' && m.tipoAplicable === 'MERMA')?.id ?? '';
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

function ajuste(cuerpo: unknown): ResultadoAjuste {
  return cuerpo as ResultadoAjuste;
}
function codigoError(respuesta: { cuerpo: unknown }): string {
  return (respuesta.cuerpo as { codigo: string }).codigo;
}
function detallesError(respuesta: { cuerpo: unknown }): Record<string, string> {
  return (respuesta.cuerpo as { detalles: Record<string, string> }).detalles;
}

function nombreNuevo(prefijo: string): string {
  return `${prefijo} ${String(Date.now())}-${String(Math.floor(Math.random() * 1000000))}`;
}

/** Un insumo nuevo con el saldo pedido, para que cada test sea independiente. */
async function conSaldo(cantidad: string, sucursalId = centralId): Promise<string> {
  const creado = await api.post('/api/insumos', {
    nombre: nombreNuevo('Insumo ajuste'),
    codigo: null,
    categoriaId: null,
    unidadBaseId: unidadKgId,
  });
  expect(creado.status).toBe(201);
  const insumoId = (creado.cuerpo as InsumoDetalle).id;

  const inicial = await api.post('/api/movimientos/saldo-inicial', {
    sucursalId,
    lineas: [{ insumoId, cantidad }],
  });
  expect(inicial.status).toBe(201);
  return insumoId;
}

async function saldoEnBase(insumoId: string, sucursalId = centralId): Promise<string> {
  const agregado = await prisma.movimientoStock.aggregate({
    where: { empresaId, sucursalId, insumoId },
    _sum: { cantidadBase: true },
  });
  return agregado._sum.cantidadBase?.toString() ?? '0';
}

function ajustar(lineas: { insumoId: string; cantidadContada: string }[], extra = {}) {
  return api.post('/api/movimientos/ajuste', {
    sucursalId: centralId,
    motivoId: motivoConteoId,
    lineas,
    ...extra,
  });
}

// ===========================================================================

describe('se carga lo CONTADO, no la diferencia', () => {
  it('EL INVARIANTE: después del ajuste el saldo es exactamente lo contado', async () => {
    await entrarComo('dueno@panaderia.test');
    const insumoId = await conSaldo('70');

    const r = await ajustar([{ insumoId, cantidadContada: '62' }]);

    expect(r.status).toBe(200);
    expect(ResultadoAjusteSchema.safeParse(r.cuerpo).success).toBe(true);
    expect(await saldoEnBase(insumoId)).toBe('62');

    // El informe cuenta la historia completa.
    const linea = ajuste(r.cuerpo).lineas[0];
    expect(linea?.saldoAnterior).toBe('70');
    expect(linea?.contado).toBe('62');
    expect(linea?.diferencia).toBe('-8');
    expect(linea?.ajustado).toBe(true);

    // Y el movimiento que se escribió es un AJUSTE negativo.
    const movimiento = ajuste(r.cuerpo).movimientos[0];
    expect(movimiento?.tipo).toBe('AJUSTE');
    expect(movimiento?.cantidadBase).toBe('-8');
    expect(movimiento?.motivo?.nombre).toBe('Diferencia de conteo');
  });

  it('si hay MÁS de lo que dice el sistema, el ajuste es positivo', async () => {
    await entrarComo('dueno@panaderia.test');
    const insumoId = await conSaldo('70');

    const r = await ajustar([{ insumoId, cantidadContada: '75,5' }]);

    expect(r.status).toBe(200);
    expect(await saldoEnBase(insumoId)).toBe('75.5');
    expect(ajuste(r.cuerpo).lineas[0]?.diferencia).toBe('5.5');
    expect(ajuste(r.cuerpo).movimientos[0]?.cantidadBase).toBe('5.5');
  });

  it('contar CERO es válido, y es el caso más común ("se terminó")', async () => {
    // Las otras cargas exigen una cantidad mayor que cero; un conteo no.
    await entrarComo('dueno@panaderia.test');
    const insumoId = await conSaldo('12,5');

    const r = await ajustar([{ insumoId, cantidadContada: '0' }]);

    expect(r.status).toBe(200);
    expect(await saldoEnBase(insumoId)).toBe('0');
    expect(ajuste(r.cuerpo).lineas[0]?.diferencia).toBe('-12.5');
  });

  it('REGLA: si la cuenta coincide NO se escribe ningún movimiento', async () => {
    // Un movimiento de cero no significa nada, el CHECK de la base lo
    // rechazaría, y ensuciaría el historial con filas donde no pasó nada.
    await entrarComo('dueno@panaderia.test');
    const insumoId = await conSaldo('40');

    const r = await ajustar([{ insumoId, cantidadContada: '40' }]);

    expect(r.status).toBe(200);
    const datos = ajuste(r.cuerpo);
    // La línea SÍ se informa (contar y que esté bien es un resultado)...
    expect(datos.lineas[0]?.diferencia).toBe('0');
    expect(datos.lineas[0]?.ajustado).toBe(false);
    // ...pero no se escribió nada.
    expect(datos.operacionId).toBeNull();
    expect(datos.movimientos).toEqual([]);

    const ajustes = await prisma.movimientoStock.count({ where: { insumoId, tipo: 'AJUSTE' } });
    expect(ajustes).toBe(0);
    expect(await saldoEnBase(insumoId)).toBe('40');
  });

  it('en una carga mixta, solo las líneas con diferencia generan movimiento', async () => {
    await entrarComo('dueno@panaderia.test');
    const iguales = await conSaldo('100');
    const falta = await conSaldo('50');
    const sobra = await conSaldo('20');

    const r = await ajustar([
      { insumoId: iguales, cantidadContada: '100' },
      { insumoId: falta, cantidadContada: '45' },
      { insumoId: sobra, cantidadContada: '23' },
    ]);

    expect(r.status).toBe(200);
    const datos = ajuste(r.cuerpo);
    expect(datos.lineas).toHaveLength(3);
    expect(datos.movimientos).toHaveLength(2);
    expect(datos.lineas.filter((l) => l.ajustado)).toHaveLength(2);

    // Los tres saldos quedan en lo contado.
    expect(await saldoEnBase(iguales)).toBe('100');
    expect(await saldoEnBase(falta)).toBe('45');
    expect(await saldoEnBase(sobra)).toBe('23');

    // Y los dos movimientos comparten la misma operación.
    const operaciones = new Set(datos.movimientos.map((m) => m.operacionId));
    expect(operaciones.size).toBe(1);
    expect([...operaciones][0]).toBe(datos.operacionId);
  });

  it('el ajuste ARREGLA un stock que quedó negativo', async () => {
    // Es justo para lo que sirve: alguien forzó una salida, el saldo quedó en
    // negativo, se cuenta el depósito y se pone el número real.
    await entrarComo('dueno@panaderia.test');
    const insumoId = await conSaldo('5');
    const forzado = await api.post('/api/movimientos/consumo', {
      sucursalId: centralId,
      lineas: [{ insumoId, cantidad: '20' }],
      forzar: true,
    });
    expect(forzado.status).toBe(201);
    expect(await saldoEnBase(insumoId)).toBe('-15');

    const r = await ajustar([{ insumoId, cantidadContada: '3' }]);

    expect(r.status).toBe(200);
    expect(ajuste(r.cuerpo).lineas[0]?.diferencia).toBe('18'); // 3 − (−15)
    expect(await saldoEnBase(insumoId)).toBe('3');
  });

  it('REGLA: un ajuste NUNCA puede dejar el stock negativo', async () => {
    // No hace falta ninguna validación para esto: como lo contado no puede ser
    // negativo, el saldo resultante tampoco. Por eso el ajuste no lleva
    // `forzar`. Este test lo deja escrito para que no se rompa sin que nadie
    // se dé cuenta.
    await entrarComo('dueno@panaderia.test');
    const insumoId = await conSaldo('100');

    const r = await ajustar([{ insumoId, cantidadContada: '-5' }]);
    expect(r.status).toBe(400);
    expect(detallesError(r)['lineas.0.cantidadContada']).toBe('No puede ser negativo');
    expect(await saldoEnBase(insumoId)).toBe('100');
  });

  it('un insumo nunca tocado se puede ajustar: pasa de 0 a lo contado', async () => {
    await entrarComo('dueno@panaderia.test');
    const creado = await api.post('/api/insumos', {
      nombre: nombreNuevo('Insumo sin tocar'),
      codigo: null,
      categoriaId: null,
      unidadBaseId: unidadKgId,
    });
    const insumoId = (creado.cuerpo as InsumoDetalle).id;

    const r = await ajustar([{ insumoId, cantidadContada: '8' }]);
    expect(r.status).toBe(200);
    expect(ajuste(r.cuerpo).lineas[0]?.saldoAnterior).toBe('0');
    expect(await saldoEnBase(insumoId)).toBe('8');
  });
});

describe('el motivo del ajuste', () => {
  it('REGLA: es obligatorio', async () => {
    await entrarComo('dueno@panaderia.test');
    const insumoId = await conSaldo('10');

    const r = await api.post('/api/movimientos/ajuste', {
      sucursalId: centralId,
      lineas: [{ insumoId, cantidadContada: '8' }],
    });

    expect(r.status).toBe(400);
    expect(detallesError(r)['motivoId']).toBe('Hay que elegir un motivo');
    expect(await saldoEnBase(insumoId)).toBe('10');
  });

  it('REGLA: tiene que ser un motivo de AJUSTE, no de merma', async () => {
    // "Vencido" es un motivo de merma: en un ajuste no explica nada, y si se
    // aceptara, el informe de pérdidas mezclaría cosas distintas.
    await entrarComo('dueno@panaderia.test');
    const insumoId = await conSaldo('10');

    const r = await ajustar([{ insumoId, cantidadContada: '8' }], { motivoId: motivoVencidoId });

    expect(r.status).toBe(400);
    expect(detallesError(r)['motivoId']).toMatch(/no se puede usar/);
    expect(await saldoEnBase(insumoId)).toBe('10');
  });

  it('la nota de la operación queda en cada movimiento', async () => {
    await entrarComo('dueno@panaderia.test');
    const insumoId = await conSaldo('10');

    const r = await ajustar([{ insumoId, cantidadContada: '8' }], {
      notas: 'Revisé el depósito B el lunes',
    });

    expect(r.status).toBe(200);
    expect(ajuste(r.cuerpo).movimientos[0]?.notas).toBe('Revisé el depósito B el lunes');
  });
});

describe('permisos y aislamiento del ajuste', () => {
  it('el empleado NO puede ajustar el stock', async () => {
    // Es el tercer permiso delicado: cambia el saldo sin que haya pasado nada
    // físico, así que es la forma más fácil de tapar un faltante.
    await entrarComo('empleado@panaderia.test');
    const r = await api.post('/api/movimientos/ajuste', {
      sucursalId: laferrereId,
      motivoId: motivoConteoId,
      lineas: [{ insumoId: '11111111-1111-4111-8111-999999999999', cantidadContada: '1' }],
    });
    expect(r.status).toBe(403);
    expect(codigoError(r)).toBe('SIN_PERMISO');
  });

  it('el encargado sí puede, en SU sucursal', async () => {
    await entrarComo('encargado@panaderia.test');
    const insumoId = await conSaldo('10', laferrereId);

    const r = await api.post('/api/movimientos/ajuste', {
      sucursalId: laferrereId,
      motivoId: motivoConteoId,
      lineas: [{ insumoId, cantidadContada: '7' }],
    });
    expect(r.status).toBe(200);
    expect(await saldoEnBase(insumoId, laferrereId)).toBe('7');
  });

  it('no se puede ajustar una sucursal donde no operás', async () => {
    await entrarComo('empleado@vecina.test');
    const r = await api.post('/api/movimientos/ajuste', {
      sucursalId: centralId,
      motivoId: motivoConteoId,
      lineas: [{ insumoId: '11111111-1111-4111-8111-999999999999', cantidadContada: '1' }],
    });
    // 403 antes que 404: el middleware corta sin llegar a la base.
    expect([403]).toContain(r.status);
  });

  it('no se puede ajustar un insumo de otra empresa', async () => {
    const ajeno = await prisma.insumo.findFirstOrThrow({
      where: { empresa: { nombre: { contains: 'Vecina' } } },
    });
    await entrarComo('dueno@panaderia.test');

    const r = await ajustar([{ insumoId: ajeno.id, cantidadContada: '1' }]);
    expect(r.status).toBe(400);

    const colados = await prisma.movimientoStock.count({
      where: { insumoId: ajeno.id, empresaId },
    });
    expect(colados).toBe(0);
  });

  it('el mismo insumo dos veces en el mismo ajuste se rechaza', async () => {
    await entrarComo('dueno@panaderia.test');
    const insumoId = await conSaldo('10');

    const r = await ajustar([
      { insumoId, cantidadContada: '8' },
      { insumoId, cantidadContada: '9' },
    ]);
    expect(r.status).toBe(400);
    expect(detallesError(r)['lineas']).toMatch(/repetido/);
  });
});

describe('el ajuste es un movimiento como cualquier otro', () => {
  it('aparece en el historial y se puede anular', async () => {
    await entrarComo('dueno@panaderia.test');
    const insumoId = await conSaldo('70');
    const r = await ajustar([{ insumoId, cantidadContada: '62' }]);
    const movimientoId = ajuste(r.cuerpo).movimientos[0]?.id ?? '';

    const historial = await api.get(`/api/insumos/${insumoId}/movimientos?sucursalId=${centralId}`);
    const items = (historial.cuerpo as { items: { tipo: string }[] }).items;
    expect(items.map((m) => m.tipo)).toEqual(['AJUSTE', 'SALDO_INICIAL']);

    // Y se anula como cualquier movimiento: el contra-asiento devuelve el saldo.
    const reversa = await api.post(`/api/movimientos/${movimientoId}/reversa`, {
      notas: 'Conté mal',
    });
    expect(reversa.status).toBe(201);
    expect(await saldoEnBase(insumoId)).toBe('70');
    expect((reversa.cuerpo as ResultadoCarga).movimientos[0]?.cantidadBase).toBe('8');
  });

  it('el ajuste aparece en la pantalla de stock con el saldo nuevo', async () => {
    await entrarComo('dueno@panaderia.test');
    const insumoId = await conSaldo('70');
    await ajustar([{ insumoId, cantidadContada: '62' }]);

    const stock = await api.get(`/api/stock?sucursalId=${centralId}&limite=200`);
    const items = (
      stock.cuerpo as { items: { insumoId: string; saldo: string; cantidadMovimientos: number }[] }
    ).items;
    const fila = items.find((i) => i.insumoId === insumoId);
    expect(fila?.saldo).toBe('62');
    expect(fila?.cantidadMovimientos).toBe(2);
  });
});

describe('concurrencia del ajuste', () => {
  it('dos ajustes simultáneos del mismo insumo no se pisan', async () => {
    // SIN candado: los dos leen 70; A escribe −8 y B escribe −5, y el saldo
    // queda en 57, que NO es ninguna de las dos cuentas.
    // CON candado: B espera, lee 62 y calcula 65 − 62 = +3. Saldo final 65,
    // que es exactamente lo que contó el último. Los dos movimientos tienen
    // sentido leídos en el historial.
    await entrarComo('dueno@panaderia.test');
    const insumoId = await conSaldo('70');

    const respuestas = await Promise.all([
      ajustar([{ insumoId, cantidadContada: '62' }]),
      ajustar([{ insumoId, cantidadContada: '65' }]),
    ]);

    for (const respuesta of respuestas) expect(respuesta.status).toBe(200);

    // El saldo final es el de UNA de las dos cuentas, nunca una mezcla.
    const saldo = await saldoEnBase(insumoId);
    expect(['62', '65']).toContain(saldo);

    // Y la suma de los dos ajustes lleva de 70 a ese saldo, exacto.
    const ajustes = await prisma.movimientoStock.findMany({
      where: { insumoId, tipo: 'AJUSTE' },
      select: { cantidadBase: true },
    });
    const total = ajustes.reduce((suma, fila) => suma + Number(fila.cantidadBase), 70);
    expect(String(total)).toBe(saldo);
  });

  it('un ajuste y un consumo simultáneos dejan el stock coherente', async () => {
    await entrarComo('dueno@panaderia.test');
    const insumoId = await conSaldo('100');

    const [, consumo] = await Promise.all([
      ajustar([{ insumoId, cantidadContada: '50' }]),
      api.post('/api/movimientos/consumo', {
        sucursalId: centralId,
        lineas: [{ insumoId, cantidad: '30' }],
      }),
    ]);

    expect(consumo?.status).toBe(201);
    // Según quién llegue primero: 50−30=20, o 50 (el ajuste pisa el consumo).
    // Lo que NO puede pasar es un número que no salga de la suma del kardex.
    const saldo = await saldoEnBase(insumoId);
    expect(['20', '50']).toContain(saldo);
  });
});
