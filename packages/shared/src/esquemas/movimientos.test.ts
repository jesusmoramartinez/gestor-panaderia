import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import {
  CargarConsumoSchema,
  CargarMermaSchema,
  CargarSaldoInicialSchema,
  FiltroStockSchema,
  LineaMovimientoSchema,
} from './movimientos.js';

const SUCURSAL = '11111111-1111-4111-8111-111111111111';
const INSUMO_A = '22222222-2222-4222-8222-222222222222';
const INSUMO_B = '33333333-3333-4333-8333-333333333333';
const MOTIVO = '44444444-4444-4444-8444-444444444444';

function errorDe(esquema: z.ZodType, entrada: unknown, campo: string): string | null {
  const resultado = esquema.safeParse(entrada);
  if (resultado.success) return null;
  return resultado.error.issues.find((i) => i.path.join('.') === campo)?.message ?? null;
}

function consumo(datos: Record<string, unknown> = {}) {
  return {
    sucursalId: SUCURSAL,
    lineas: [{ insumoId: INSUMO_A, cantidad: '30' }],
    ...datos,
  };
}

describe('LineaMovimientoSchema', () => {
  it('acepta una cantidad escrita a la argentina y la normaliza', () => {
    const linea = LineaMovimientoSchema.parse({ insumoId: INSUMO_A, cantidad: '2.500,75' });
    expect(linea.cantidad).toBe('2500.75');
  });

  it('RECHAZA una cantidad negativa: el signo lo pone el tipo, no quien carga', () => {
    // Si aceptara "-30" en un consumo, el movimiento quedaría en positivo y
    // SUMARÍA stock. Es el bug silencioso que el kardex no perdona.
    expect(
      errorDe(LineaMovimientoSchema, { insumoId: INSUMO_A, cantidad: '-30' }, 'cantidad'),
    ).toBe('Tiene que ser mayor que cero');
  });

  it('rechaza el cero: un movimiento de cero no significa nada', () => {
    expect(errorDe(LineaMovimientoSchema, { insumoId: INSUMO_A, cantidad: '0' }, 'cantidad')).toBe(
      'Tiene que ser mayor que cero',
    );
  });

  it('la unidad es opcional: sin ella se usa la unidad base del insumo', () => {
    expect(LineaMovimientoSchema.parse({ insumoId: INSUMO_A, cantidad: '1' }).unidadId).toBeNull();
    expect(
      LineaMovimientoSchema.parse({ insumoId: INSUMO_A, cantidad: '1', unidadId: '' }).unidadId,
    ).toBeNull();
  });
});

describe('las tres cargas', () => {
  it('exigen al menos una línea', () => {
    expect(errorDe(CargarConsumoSchema, consumo({ lineas: [] }), 'lineas')).toBe(
      'Hay que cargar al menos una línea',
    );
  });

  it('RECHAZAN el mismo insumo dos veces en la misma carga', () => {
    // Dos líneas del mismo insumo darían dos "cantidades" en una sola
    // operación y harían ambiguo el control de stock negativo: ¿se compara
    // contra el saldo antes o después de la primera? Mejor pedir una sola.
    const r = errorDe(
      CargarConsumoSchema,
      consumo({
        lineas: [
          { insumoId: INSUMO_A, cantidad: '10' },
          { insumoId: INSUMO_A, cantidad: '5' },
        ],
      }),
      'lineas',
    );
    expect(r).toMatch(/repetido/);
  });

  it('aceptan insumos distintos en la misma carga', () => {
    const r = CargarConsumoSchema.safeParse(
      consumo({
        lineas: [
          { insumoId: INSUMO_A, cantidad: '10' },
          { insumoId: INSUMO_B, cantidad: '5' },
        ],
      }),
    );
    expect(r.success).toBe(true);
  });

  it('la fecha es opcional y acepta una del pasado', () => {
    // La merma del sábado se carga el lunes.
    const r = CargarConsumoSchema.parse(consumo({ fecha: '2026-01-15T10:30:00.000Z' }));
    expect(r.fecha).toBe('2026-01-15T10:30:00.000Z');
    expect(CargarConsumoSchema.parse(consumo({ fecha: '' })).fecha).toBeNull();
  });

  it('RECHAZA una fecha futura', () => {
    // Rompería cualquier pregunta del tipo "¿cuánto había el día 5?" y
    // quedaría primera en el historial para siempre.
    const manana = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    expect(errorDe(CargarConsumoSchema, consumo({ fecha: manana }), 'fecha')).toBe(
      'La fecha no puede estar en el futuro',
    );
  });

  it('`forzar` es false si no se manda', () => {
    expect(CargarConsumoSchema.parse(consumo()).forzar).toBe(false);
  });

  it('el saldo inicial NO acepta forzar ni motivo: Zod descarta los campos que no declara', () => {
    // Un saldo inicial es una entrada: nunca puede dejar el stock negativo, así
    // que `forzar` no significa nada. Y no lleva motivo.
    const r = CargarSaldoInicialSchema.parse(consumo({ forzar: true, motivoId: MOTIVO }));
    expect(r).not.toHaveProperty('forzar');
    expect(r).not.toHaveProperty('motivoId');
  });
});

describe('CargarMermaSchema', () => {
  it('EXIGE el motivo', () => {
    // Una merma sin motivo es stock que desapareció sin explicación, y
    // entonces no se puede responder "¿cuánto perdimos por vencimiento?".
    expect(errorDe(CargarMermaSchema, consumo(), 'motivoId')).toBe('Hay que elegir un motivo');
    expect(errorDe(CargarMermaSchema, consumo({ motivoId: '' }), 'motivoId')).toBeDefined();
  });

  it('con motivo es válida', () => {
    expect(CargarMermaSchema.safeParse(consumo({ motivoId: MOTIVO })).success).toBe(true);
  });
});

describe('FiltroStockSchema', () => {
  it('EXIGE la sucursal: el stock es de una sucursal, nunca de la empresa', () => {
    expect(errorDe(FiltroStockSchema, {}, 'sucursalId')).toBe('Hay que elegir una sucursal');
  });

  it('soloAlertas llega como texto desde el query string', () => {
    expect(FiltroStockSchema.parse({ sucursalId: SUCURSAL, soloAlertas: 'true' }).soloAlertas).toBe(
      true,
    );
    expect(FiltroStockSchema.parse({ sucursalId: SUCURSAL }).soloAlertas).toBe(false);
  });
});
