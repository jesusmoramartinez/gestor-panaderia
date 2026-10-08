import { describe, expect, it } from 'vitest';

import { aDecimal, redondearCantidad } from './decimal.js';
import {
  convertir,
  convertirABase,
  DimensionIncompatibleError,
  FactorInvalidoError,
  sonCompatibles,
  type UnidadConversion,
} from './unidades.js';

// Las cinco unidades que siembra el sistema. Son datos de prueba, no la base:
// estos tests son puros y no tocan Postgres.
const KG: UnidadConversion = { codigo: 'kg', dimension: 'PESO', factorABase: '1' };
const G: UnidadConversion = { codigo: 'g', dimension: 'PESO', factorABase: '0.001' };
const L: UnidadConversion = { codigo: 'l', dimension: 'VOLUMEN', factorABase: '1' };
const ML: UnidadConversion = { codigo: 'ml', dimension: 'VOLUMEN', factorABase: '0.001' };
const U: UnidadConversion = { codigo: 'u', dimension: 'UNIDAD', factorABase: '1' };

describe('convertir', () => {
  it('kg → g multiplica por mil', () => {
    expect(convertir('1', KG, G).toString()).toBe('1000');
    expect(convertir('2.5', KG, G).toString()).toBe('2500');
  });

  it('g → kg divide por mil', () => {
    expect(convertir('2500', G, KG).toString()).toBe('2.5');
    expect(convertir('500', G, KG).toString()).toBe('0.5');
  });

  it('litros y mililitros funcionan igual', () => {
    expect(convertir('1', L, ML).toString()).toBe('1000');
    expect(convertir('250', ML, L).toString()).toBe('0.25');
  });

  it('a la misma unidad devuelve la misma cantidad', () => {
    expect(convertir('7.25', KG, KG).toString()).toBe('7.25');
    expect(convertir('3', U, U).toString()).toBe('3');
  });

  it('el cero se convierte en cero', () => {
    expect(convertir('0', KG, G).toString()).toBe('0');
  });

  it('convierte cantidades negativas (las salidas de stock lo son)', () => {
    // En el kardex una salida se guarda con signo negativo, así que la
    // conversión tiene que funcionar igual con números negativos.
    expect(convertir('-2.5', KG, G).toString()).toBe('-2500');
    expect(convertir('-500', G, KG).toString()).toBe('-0.5');
  });

  it('mantiene la precisión con decimales largos', () => {
    expect(convertir('0.333333', KG, G).toString()).toBe('333.333');
    expect(convertir('1', G, KG).toString()).toBe('0.001');
  });

  it('ida y vuelta mil veces devuelve EXACTAMENTE el valor original', () => {
    // Es la propiedad que justifica usar Decimal: el stock es una suma de
    // miles de movimientos convertidos, y no puede derivar ni un miligramo.
    let valor = aDecimal('2.5');
    for (let i = 0; i < 1000; i++) {
      valor = convertir(convertir(valor, KG, G), G, KG);
    }
    expect(valor.toString()).toBe('2.5');
    expect(valor.equals('2.5')).toBe(true);
  });

  it('un caso real: 500 g de harina por receta son 0,5 kg de stock', () => {
    expect(convertir('500', G, KG).toString()).toBe('0.5');
  });
});

describe('convertir: errores de dominio', () => {
  it('rechaza convertir entre peso y volumen', () => {
    // 1 litro de agua pesa 1 kg, de aceite ~0,92 y de harina suelta ~0,6.
    // Sin la densidad del insumo, la cuenta no existe: el sistema NO estima.
    expect(() => convertir('1', KG, L)).toThrow(DimensionIncompatibleError);
    expect(() => convertir('1', ML, G)).toThrow(DimensionIncompatibleError);
  });

  it('el error dice qué unidades y qué dimensiones no encajan', () => {
    // Un error de dominio tiene que servirle a quien lo lee para arreglar la
    // configuración, no solo para saber que algo falló.
    expect(() => convertir('1', KG, L)).toThrow(/kg \(PESO\).*l \(VOLUMEN\)/);
  });

  it('rechaza convertir unidades contra "unidad"', () => {
    // No hay forma de saber cuánto pesa "una" cosa sin más información.
    expect(() => convertir('1', U, KG)).toThrow(DimensionIncompatibleError);
  });

  it('rechaza una unidad con factor cero o negativo', () => {
    const rota: UnidadConversion = { codigo: 'rota', dimension: 'PESO', factorABase: '0' };
    const negativa: UnidadConversion = { codigo: 'mala', dimension: 'PESO', factorABase: '-1' };
    expect(() => convertir('1', rota, KG)).toThrow(FactorInvalidoError);
    expect(() => convertir('1', KG, negativa)).toThrow(FactorInvalidoError);
    expect(() => convertirABase('1', rota)).toThrow(FactorInvalidoError);
  });
});

describe('convertirABase', () => {
  it('lleva la cantidad a la unidad base de su dimensión', () => {
    expect(convertirABase('2000', G).toString()).toBe('2');
    expect(convertirABase('2.5', KG).toString()).toBe('2.5');
    expect(convertirABase('750', ML).toString()).toBe('0.75');
  });

  it('funciona con una presentación de compra (el caso de la Fase 4)', () => {
    // Una "bolsa de 25 kg" es, para la conversión, una unidad de PESO con
    // factor 25. Así es como "4 bolsas" se vuelven "100 kg" de stock.
    const bolsa25: UnidadConversion = { codigo: 'bolsa', dimension: 'PESO', factorABase: '25' };
    expect(convertirABase('4', bolsa25).toString()).toBe('100');
    expect(convertir('100', KG, bolsa25).toString()).toBe('4');
  });
});

describe('la conversión y el redondeo son decisiones separadas', () => {
  it('convertir no redondea: devuelve el valor exacto', () => {
    const pizca: UnidadConversion = {
      codigo: 'pizca',
      dimension: 'PESO',
      factorABase: '0.0000001', // 0,1 mg
    };
    // Exacto, con más decimales que los que la base puede guardar.
    // Y en notación decimal, no exponencial ("1e-7"): lo fijamos con
    // toExpNeg en la configuración de decimal.js, porque un valor
    // exponencial es correcto pero ilegible al mostrarlo o guardarlo.
    expect(convertirABase('1', pizca).toString()).toBe('0.0000001');
  });

  it('al guardar, una cantidad más chica que un miligramo se vuelve cero', () => {
    const pizca: UnidadConversion = {
      codigo: 'pizca',
      dimension: 'PESO',
      factorABase: '0.0000001',
    };
    const guardable = redondearCantidad(convertirABase('1', pizca));
    expect(guardable.toString()).toBe('0');
    // Es información útil, no un bug: la base tiene un CHECK que prohíbe
    // movimientos de cantidad cero, así que el sistema va a RECHAZAR ese
    // movimiento en lugar de registrar silenciosamente una nada (Fase 6).
    expect(guardable.isZero()).toBe(true);
  });
});

describe('sonCompatibles', () => {
  it('responde sin lanzar', () => {
    expect(sonCompatibles(KG, G)).toBe(true);
    expect(sonCompatibles(L, ML)).toBe(true);
    expect(sonCompatibles(KG, L)).toBe(false);
    expect(sonCompatibles(U, KG)).toBe(false);
  });
});
