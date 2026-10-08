import type { InsumoDetalle, ResultadoCarga } from '@panaderia/shared';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { PASSWORD_DEV } from '../prisma/semilla.js';
import { cerrarConexiones, prisma } from '../src/lib/db.js';
import { reiniciarLimitadores } from '../src/modules/auth/service.js';
import { ClienteHttp } from './cliente-http.js';

/**
 * LA CONDICIÓN DE CARRERA DEL STOCK.
 *
 * Este archivo prueba el bug más difícil de esta fase: el que NO se ve
 * programando solo y aparece el primer día con dos tablets en el depósito.
 *
 * Hay 10 kg de levadura. Ana y Beto cargan un consumo de 8 kg al mismo tiempo:
 *
 *   Ana:  lee el saldo → 10.  10 − 8 = 2 ≥ 0, ok.  escribe −8.
 *   Beto: lee el saldo → 10.  10 − 8 = 2 ≥ 0, ok.  escribe −8.
 *   saldo final: −6
 *
 * Las dos validaciones pasaron, cada una por separado era correcta, y el
 * resultado es imposible. El primer test REPRODUCE eso salteando el motor; los
 * siguientes comprueban que, pasando por el motor, no puede ocurrir.
 */

let api: ClienteHttp;
let empresaId: string;
let centralId: string;
let unidadKgId: string;
let usuarioId: string;

beforeAll(async () => {
  api = await ClienteHttp.levantar();

  const empresa = await prisma.empresa.findFirstOrThrow({
    where: { nombre: 'Panadería Laferrere' },
    include: { sucursales: true, unidades: true },
  });
  empresaId = empresa.id;
  centralId = empresa.sucursales.find((s) => s.codigo === 'CEN')?.id ?? '';
  unidadKgId = empresa.unidades.find((u) => u.codigo === 'kg')?.id ?? '';
  usuarioId = (await prisma.usuario.findFirstOrThrow({ where: { email: 'dueno@panaderia.test' } }))
    .id;
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

/** Una promesa que se resuelve desde afuera: sirve para sincronizar dos tareas. */
function puerta(): { promesa: Promise<void>; abrir: () => void } {
  let abrir = (): void => undefined;
  const promesa = new Promise<void>((resolver) => {
    abrir = () => {
      resolver();
    };
  });
  return { promesa, abrir };
}

async function insumoConSaldo(cantidad: string): Promise<string> {
  const creado = await api.post('/api/insumos', {
    nombre: `Insumo carrera ${String(Date.now())}-${String(Math.floor(Math.random() * 1e6))}`,
    codigo: null,
    categoriaId: null,
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

async function saldoEnBase(insumoId: string): Promise<string> {
  const agregado = await prisma.movimientoStock.aggregate({
    where: { empresaId, sucursalId: centralId, insumoId },
    _sum: { cantidadBase: true },
  });
  return agregado._sum.cantidadBase?.toString() ?? '0';
}

// ===========================================================================

describe('el problema que el bloqueo resuelve', () => {
  it('SIN bloqueo, dos consumos simultáneos dejan el stock en negativo', async () => {
    // Este test SALTEA el motor a propósito: escribe directo en la tabla con el
    // mismo razonamiento "leo, valido, escribo" pero sin pedir el candado. Es
    // la demostración de que el candado no es un adorno.
    //
    // Es el único lugar del proyecto que inserta en movimiento_stock sin pasar
    // por registrarMovimientos, y existe únicamente para documentar el bug.
    await entrarComo('dueno@panaderia.test');
    const insumoId = await insumoConSaldo('10');

    const yaLei = puerta();
    const yaLeyoElOtro = puerta();

    /** El razonamiento ingenuo: leer el saldo, validar, escribir. */
    async function consumirSinBloquear(avisar: () => void, esperar: Promise<void>): Promise<void> {
      await prisma.$transaction(async (tx) => {
        const agregado = await tx.movimientoStock.aggregate({
          where: { empresaId, sucursalId: centralId, insumoId },
          _sum: { cantidadBase: true },
        });
        const saldo = Number(agregado._sum.cantidadBase?.toString() ?? '0');

        // Las dos transacciones leen ANTES de que la otra escriba.
        avisar();
        await esperar;

        // La validación pasa en las dos: 10 − 8 = 2 ≥ 0.
        expect(saldo - 8).toBeGreaterThanOrEqual(0);

        await tx.$executeRaw`
          INSERT INTO movimiento_stock
            (empresa_id, sucursal_id, insumo_id, tipo, cantidad_base, cantidad_ingresada,
             unidad_ingresada_id, factor_conversion, fecha, usuario_id, operacion_id)
          VALUES (${empresaId}::uuid, ${centralId}::uuid, ${insumoId}::uuid, 'CONSUMO',
                  -8, 8, ${unidadKgId}::uuid, 1, now(), ${usuarioId}::uuid, gen_random_uuid())`;
      });
    }

    await Promise.all([
      consumirSinBloquear(yaLei.abrir, yaLeyoElOtro.promesa),
      consumirSinBloquear(yaLeyoElOtro.abrir, yaLei.promesa),
    ]);

    // EL RESULTADO IMPOSIBLE: se sacaron 16 de 10.
    expect(await saldoEnBase(insumoId)).toBe('-6');
  });
});

describe('el bloqueo pesimista del motor', () => {
  it('CON bloqueo, dos consumos simultáneos no pueden dejar el stock negativo', async () => {
    // El mismo escenario, ahora por el camino normal. El candado de
    // insumo_sucursal hace que el segundo espere, lea el saldo ya actualizado
    // y falle como corresponde.
    await entrarComo('dueno@panaderia.test');
    const insumoId = await insumoConSaldo('10');

    const cuerpo = { sucursalId: centralId, lineas: [{ insumoId, cantidad: '8' }] };
    const [primera, segunda] = await Promise.all([
      api.post('/api/movimientos/consumo', cuerpo),
      api.post('/api/movimientos/consumo', cuerpo),
    ]);

    const estados = [primera?.status, segunda?.status].sort((a, b) => (a ?? 0) - (b ?? 0));
    expect(estados).toEqual([201, 409]);
    expect(await saldoEnBase(insumoId)).toBe('2');
  });

  it('con CINCO pedidos simultáneos, entran exactamente los que alcanzan', async () => {
    // Cinco consumos de 3 contra un saldo de 10: como máximo pueden entrar
    // tres (9 ≤ 10). La aserción no depende del orden en que lleguen, solo del
    // invariante, que es lo que lo hace un test confiable y no uno que falla
    // un día de cada diez.
    await entrarComo('dueno@panaderia.test');
    const insumoId = await insumoConSaldo('10');

    const cuerpo = { sucursalId: centralId, lineas: [{ insumoId, cantidad: '3' }] };
    const respuestas = await Promise.all(
      Array.from({ length: 5 }, () => api.post('/api/movimientos/consumo', cuerpo)),
    );

    const exitosas = respuestas.filter((r) => r.status === 201).length;
    const rechazadas = respuestas.filter((r) => r.status === 409).length;

    expect(exitosas).toBe(3);
    expect(rechazadas).toBe(2);
    // Y lo más importante: el saldo nunca quedó negativo.
    expect(await saldoEnBase(insumoId)).toBe('1');
  });

  it('una carga multi-línea simultánea con otra tampoco rompe el saldo', async () => {
    // Dos cargas de dos insumos cada una, cruzadas. Acá importa el ORDEN del
    // bloqueo: si una trabara A→B y la otra B→A, se quedarían esperando
    // mutuamente (un abrazo mortal) y Postgres mataría una con un error 40P01.
    // El motor ordena las claves antes de bloquear, así que no puede pasar.
    await entrarComo('dueno@panaderia.test');
    const a = await insumoConSaldo('10');
    const b = await insumoConSaldo('10');

    const respuestas = await Promise.all([
      api.post('/api/movimientos/consumo', {
        sucursalId: centralId,
        lineas: [
          { insumoId: a, cantidad: '6' },
          { insumoId: b, cantidad: '6' },
        ],
      }),
      api.post('/api/movimientos/consumo', {
        sucursalId: centralId,
        lineas: [
          { insumoId: b, cantidad: '6' },
          { insumoId: a, cantidad: '6' },
        ],
      }),
    ]);

    // Ninguna puede haber fallado con un error interno: o entró, o fue 409.
    for (const respuesta of respuestas) {
      expect([201, 409]).toContain(respuesta.status);
    }
    const exitosas = respuestas.filter((r) => r.status === 201).length;
    expect(exitosas).toBe(1);

    // Y los dos saldos quedaron coherentes: 10 − 6 = 4 en cada uno.
    expect(await saldoEnBase(a)).toBe('4');
    expect(await saldoEnBase(b)).toBe('4');
  });

  it('dos saldos iniciales simultáneos del mismo insumo: solo entra uno', async () => {
    // La regla "el saldo inicial se carga una sola vez" también tiene que
    // aguantar dos clics simultáneos. Sin el candado, los dos leerían "no hay
    // movimientos" y el stock quedaría duplicado.
    await entrarComo('dueno@panaderia.test');
    const creado = await api.post('/api/insumos', {
      nombre: `Insumo doble clic ${String(Date.now())}`,
      codigo: null,
      categoriaId: null,
      unidadBaseId: unidadKgId,
    });
    const insumoId = (creado.cuerpo as InsumoDetalle).id;

    const cuerpo = { sucursalId: centralId, lineas: [{ insumoId, cantidad: '100' }] };
    const respuestas = await Promise.all([
      api.post('/api/movimientos/saldo-inicial', cuerpo),
      api.post('/api/movimientos/saldo-inicial', cuerpo),
    ]);

    const exitosas = respuestas.filter((r) => r.status === 201);
    expect(exitosas).toHaveLength(1);
    expect(await saldoEnBase(insumoId)).toBe('100');
    expect((exitosas[0]?.cuerpo as ResultadoCarga).saldos[0]?.saldo).toBe('100');
  });
});
