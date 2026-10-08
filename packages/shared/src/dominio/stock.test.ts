import { describe, expect, it } from 'vitest';

import { aDecimal } from './decimal.js';
import {
  calcularSaldo,
  conSignoDelTipo,
  esEntrada,
  esFechaFutura,
  esSalida,
  ESTADOS_STOCK,
  estadoDeStock,
  factorDeConversion,
  requiereMotivo,
  SENTIDO_POR_TIPO,
  signoValido,
  TIPOS_MOVIMIENTO,
} from './stock.js';
import { DimensionIncompatibleError, type UnidadConversion } from './unidades.js';

const KG: UnidadConversion = { codigo: 'kg', dimension: 'PESO', factorABase: '1' };
const G: UnidadConversion = { codigo: 'g', dimension: 'PESO', factorABase: '0.001' };
const LITRO: UnidadConversion = { codigo: 'l', dimension: 'VOLUMEN', factorABase: '1' };

describe('el signo según el tipo de movimiento', () => {
  it('todos los tipos están en la tabla de sentidos', () => {
    // Si mañana se agrega un tipo al enum y nadie le define el sentido, este
    // test falla. Es la red que evita que un tipo nuevo entre sin signo.
    for (const tipo of TIPOS_MOVIMIENTO) {
      expect(SENTIDO_POR_TIPO[tipo], tipo).toBeDefined();
    }
    expect(Object.keys(SENTIDO_POR_TIPO)).toHaveLength(TIPOS_MOVIMIENTO.length);
  });

  it('las entradas suman y las salidas restan', () => {
    const entradas = ['SALDO_INICIAL', 'COMPRA', 'TRANSFERENCIA_ENTRADA'] as const;
    const salidas = ['CONSUMO', 'MERMA', 'TRANSFERENCIA_SALIDA'] as const;
    expect(entradas.every((tipo) => esEntrada(tipo))).toBe(true);
    expect(salidas.every((tipo) => esSalida(tipo))).toBe(true);
    // AJUSTE y REVERSA no son ni una cosa ni la otra.
    expect(esEntrada('AJUSTE')).toBe(false);
    expect(esSalida('AJUSTE')).toBe(false);
    expect(esEntrada('REVERSA')).toBe(false);
    expect(esSalida('REVERSA')).toBe(false);
  });

  it('una entrada en negativo no es válida, y una salida en positivo tampoco', () => {
    expect(signoValido('SALDO_INICIAL', '100')).toBe(true);
    expect(signoValido('SALDO_INICIAL', '-100')).toBe(false);
    expect(signoValido('CONSUMO', '-30')).toBe(true);
    // Este es EL caso peligroso: un consumo en positivo SUMARÍA stock.
    expect(signoValido('CONSUMO', '30')).toBe(false);
  });

  it('el cero nunca es válido, para ningún tipo', () => {
    for (const tipo of TIPOS_MOVIMIENTO) {
      expect(signoValido(tipo, '0'), tipo).toBe(false);
    }
  });

  it('AJUSTE y REVERSA admiten los dos signos', () => {
    for (const tipo of ['AJUSTE', 'REVERSA'] as const) {
      expect(signoValido(tipo, '5'), tipo).toBe(true);
      expect(signoValido(tipo, '-5'), tipo).toBe(true);
    }
  });

  it('conSignoDelTipo niega las salidas y deja las entradas', () => {
    // La persona tipea 30 sin signo; el sistema decide.
    expect(conSignoDelTipo('CONSUMO', '30').toString()).toBe('-30');
    expect(conSignoDelTipo('MERMA', '2.5').toString()).toBe('-2.5');
    expect(conSignoDelTipo('SALDO_INICIAL', '100').toString()).toBe('100');
  });

  it('conSignoDelTipo se niega a adivinar el signo de un AJUSTE o una REVERSA', () => {
    // Si lo adivinara, un ajuste de conteo quedaría siempre para el mismo
    // lado y la mitad de los conteos daría al revés.
    expect(() => conSignoDelTipo('AJUSTE', '5')).toThrow(/los dos sentidos/);
    expect(() => conSignoDelTipo('REVERSA', '5')).toThrow(/los dos sentidos/);
  });

  it('conSignoDelTipo rechaza una cantidad que ya viene con signo', () => {
    expect(() => conSignoDelTipo('CONSUMO', '-30')).toThrow(/cantidad positiva/);
    expect(() => conSignoDelTipo('CONSUMO', '0')).toThrow(/cantidad positiva/);
  });

  it('el motivo es obligatorio solo en merma y ajuste', () => {
    expect(requiereMotivo('MERMA')).toBe(true);
    expect(requiereMotivo('AJUSTE')).toBe(true);
    expect(requiereMotivo('CONSUMO')).toBe(false);
    expect(requiereMotivo('SALDO_INICIAL')).toBe(false);
    expect(requiereMotivo('REVERSA')).toBe(false);
  });
});

describe('calcularSaldo', () => {
  it('suma los movimientos con su signo', () => {
    // El kardex del ejemplo de la nota 03: 100 - 30 + 50 - 2,50 = 117,50
    const kardex = [
      { cantidadBase: '100' },
      { cantidadBase: '-30' },
      { cantidadBase: '50' },
      { cantidadBase: '-2.5' },
    ];
    expect(calcularSaldo(kardex).toString()).toBe('117.5');
  });

  it('sin movimientos el saldo es cero, no null ni NaN', () => {
    expect(calcularSaldo([]).toString()).toBe('0');
  });

  it('da exacto donde los números de JavaScript ya se habrían desviado', () => {
    // Mil consumos de 100 g en un insumo que se lleva en kg: 0,1 cada uno.
    const movimientos = Array.from({ length: 1000 }, () => ({ cantidadBase: '-0.1' }));
    expect(calcularSaldo(movimientos).toString()).toBe('-100');

    // El contraste, para que se vea de qué estamos hablando:
    let conFloat = 0;
    for (let i = 0; i < 1000; i += 1) conFloat -= 0.1;
    expect(conFloat).not.toBe(-100);
  });

  it('un saldo negativo es un resultado posible, no un error', () => {
    // Pasa cuando alguien forzó una salida con permiso especial. El cálculo no
    // opina: informa. Quien decide si se permite es el servicio.
    expect(calcularSaldo([{ cantidadBase: '10' }, { cantidadBase: '-25' }]).toString()).toBe('-15');
  });

  it('una reversa devuelve el saldo EXACTO al valor anterior', () => {
    const antes = calcularSaldo([{ cantidadBase: '100' }]);
    const conConsumo = calcularSaldo([{ cantidadBase: '100' }, { cantidadBase: '-33.333333' }]);
    const conReversa = calcularSaldo([
      { cantidadBase: '100' },
      { cantidadBase: '-33.333333' },
      { cantidadBase: '33.333333' },
    ]);
    expect(conConsumo.equals(antes)).toBe(false);
    expect(conReversa.equals(antes)).toBe(true);
  });
});

describe('factorDeConversion', () => {
  it('es el número que multiplica la cantidad tipeada', () => {
    expect(factorDeConversion(G, KG).toString()).toBe('0.001');
    expect(factorDeConversion(KG, G).toString()).toBe('1000');
    expect(factorDeConversion(KG, KG).toString()).toBe('1');
  });

  it('vale la igualdad cantidadBase = cantidadIngresada × factor', () => {
    // Es el invariante que el motor verifica antes de insertar, y lo que hace
    // que el historial pueda decir "cargó 2000 g = 2 kg".
    const factor = factorDeConversion(G, KG);
    expect(aDecimal('2000').times(factor).toString()).toBe('2');
  });

  it('se niega a convertir entre peso y volumen', () => {
    // Dependería de la densidad del material, que el sistema no conoce.
    expect(() => factorDeConversion(KG, LITRO)).toThrow(DimensionIncompatibleError);
  });
});

describe('estadoDeStock (el semáforo)', () => {
  it('sin stock o en negativo es CRITICO', () => {
    expect(estadoDeStock('0', '50')).toBe('CRITICO');
    expect(estadoDeStock('-10', '50')).toBe('CRITICO');
    // Incluso sin mínimo configurado: no tener nada siempre es crítico.
    expect(estadoDeStock('0', '0')).toBe('CRITICO');
  });

  it('por debajo del mínimo es BAJO', () => {
    expect(estadoDeStock('40', '50')).toBe('BAJO');
    expect(estadoDeStock('49.999999', '50')).toBe('BAJO');
  });

  it('justo en el mínimo todavía es OK', () => {
    // El mínimo es el punto a partir del cual hay que reponer, no el punto en
    // el que ya es tarde.
    expect(estadoDeStock('50', '50')).toBe('OK');
  });

  it('con mínimo en cero nunca avisa, salvo que no haya nada', () => {
    // Mínimo 0 = "no me avises de este insumo". Sin esta salvedad los 28
    // insumos del catálogo aparecerían en rojo antes de configurar nada.
    expect(estadoDeStock('1', '0')).toBe('OK');
    expect(estadoDeStock('0.000001', '0')).toBe('OK');
  });

  it('devuelve siempre uno de los estados declarados', () => {
    const casos: readonly [string, string][] = [
      ['-1', '0'],
      ['0', '10'],
      ['5', '10'],
      ['10', '10'],
      ['100', '10'],
    ];
    for (const [saldo, minimo] of casos) {
      expect(ESTADOS_STOCK).toContain(estadoDeStock(saldo, minimo));
    }
  });
});

describe('esFechaFutura', () => {
  const ahora = new Date('2026-10-08T12:00:00Z');

  it('una fecha de mañana es futura', () => {
    expect(esFechaFutura(new Date('2026-10-09T12:00:00Z'), ahora)).toBe(true);
  });

  it('una fecha de ayer no lo es: una merma del sábado se carga el lunes', () => {
    expect(esFechaFutura(new Date('2026-10-07T12:00:00Z'), ahora)).toBe(false);
  });

  it('tolera unos minutos de adelanto: el reloj de la tablet puede estar mal', () => {
    const dosMinutosDespues = new Date(ahora.getTime() + 2 * 60 * 1000);
    expect(esFechaFutura(dosMinutosDespues, ahora)).toBe(false);

    const diezMinutosDespues = new Date(ahora.getTime() + 10 * 60 * 1000);
    expect(esFechaFutura(diezMinutosDespues, ahora)).toBe(true);
  });
});
