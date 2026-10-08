import { describe, expect, it } from 'vitest';

import {
  aDecimal,
  Decimal,
  esDecimalValido,
  ESCALA_CANTIDAD,
  ESCALA_DINERO,
  formatearCantidad,
  normalizarNumero,
  redondearCantidad,
  redondearDinero,
} from './decimal.js';

describe('aritmética decimal exacta', () => {
  it('0.1 + 0.2 da exactamente 0.3 (con number no)', () => {
    expect(aDecimal('0.1').plus('0.2').equals('0.3')).toBe(true);
    // El contraste, para que quede claro de qué estamos hablando:
    expect(0.1 + 0.2).not.toBe(0.3);
  });

  it('sumar mil movimientos de 0,1 kg da exactamente 100 kg', () => {
    // Este es EL escenario del kardex: el stock es la suma de los
    // movimientos. Con float, mil movimientos de 0,1 kg dan
    // 99,9999999999986, y entonces "¿hay 100 kg?" responde que no.
    let flotante = 0;
    for (let i = 0; i < 1000; i++) flotante += 0.1;
    expect(flotante).not.toBe(100);

    let decimal = aDecimal('0');
    for (let i = 0; i < 1000; i++) decimal = decimal.plus('0.1');
    expect(decimal.equals(100)).toBe(true);
    expect(decimal.toString()).toBe('100');
  });

  it('nunca usa notación exponencial al convertir a texto', () => {
    // Por defecto decimal.js escribiría "1e-7" y "1e+25". Son correctos pero
    // ilegibles, y al guardarlos o mostrarlos generan confusión. Lo fijamos
    // con toExpNeg/toExpPos en la configuración del módulo.
    expect(aDecimal('0.0000001').toString()).toBe('0.0000001');
    expect(aDecimal('10000000000000000000000000').toString()).toBe('10000000000000000000000000');
  });

  it('acepta texto o un Decimal, y devuelve siempre un Decimal', () => {
    expect(aDecimal('2.5').toString()).toBe('2.5');
    expect(aDecimal(aDecimal('2.5')).toString()).toBe('2.5');
    expect(aDecimal('2.5')).toBeInstanceOf(Decimal);
  });
});

describe('redondeo', () => {
  it('las cantidades se guardan con 6 decimales', () => {
    expect(ESCALA_CANTIDAD).toBe(6);
    expect(redondearCantidad('2.0000004').toString()).toBe('2');
    expect(redondearCantidad('2.0000005').toString()).toBe('2.000001');
    expect(redondearCantidad('2.5').toString()).toBe('2.5');
  });

  it('el dinero se guarda con 4 decimales', () => {
    expect(ESCALA_DINERO).toBe(4);
    // 25.000 pesos la bolsa ÷ 25 kg = 1.000 exacto
    expect(redondearDinero(aDecimal('25000').dividedBy(25)).toString()).toBe('1000');
    // Un precio que no divide exacto: 25.000 ÷ 7 kg
    expect(redondearDinero(aDecimal('25000').dividedBy(7)).toString()).toBe('3571.4286');
  });

  it('redondea "mitad hacia arriba", también con negativos', () => {
    // Elegimos ROUND_HALF_UP porque es lo que espera cualquier persona.
    // Con negativos "arriba" significa alejándose del cero, que es lo
    // razonable para una salida de stock.
    expect(aDecimal('0.5').toDecimalPlaces(0).toString()).toBe('1');
    expect(aDecimal('1.5').toDecimalPlaces(0).toString()).toBe('2');
    expect(aDecimal('-0.5').toDecimalPlaces(0).toString()).toBe('-1');
  });
});

describe('formatearCantidad', () => {
  it('usa el formato argentino: coma decimal y punto de miles', () => {
    expect(formatearCantidad('1234.5')).toBe('1.234,5');
  });

  it('no muestra ceros al final', () => {
    expect(formatearCantidad('2.500000')).toBe('2,5');
    expect(formatearCantidad('25')).toBe('25');
  });

  it('no pierde dígitos en números grandes', () => {
    // Formatear pasando por `number` deformaría esto en ...680. Por eso
    // formatearCantidad le pasa a Intl el TEXTO y no un number.
    expect(formatearCantidad('123456789012345678.123456')).toBe('123.456.789.012.345.678,123456');
  });

  it('respeta el máximo de decimales que se le pida', () => {
    expect(formatearCantidad('2.123456789', 2)).toBe('2,12');
    expect(formatearCantidad('0.000001', 2)).toBe('0');
  });
});

describe('normalizarNumero', () => {
  it('interpreta la coma como separador decimal (como se escribe acá)', () => {
    expect(normalizarNumero('2,5')).toBe('2.5');
    expect(normalizarNumero('0,001')).toBe('0.001');
  });

  it('descarta los puntos de miles cuando hay coma decimal', () => {
    expect(normalizarNumero('1.234,5')).toBe('1234.5');
    expect(normalizarNumero('1.234.567,89')).toBe('1234567.89');
  });

  it('si no hay coma, el punto es el separador decimal', () => {
    // Es lo que escribe un input type="number" y lo que manda cualquier API.
    expect(normalizarNumero('2.5')).toBe('2.5');
    expect(normalizarNumero('25')).toBe('25');
  });

  it('ignora los espacios alrededor', () => {
    expect(normalizarNumero('  2,5  ')).toBe('2.5');
  });

  it('no valida: devuelve el texto raro tal cual para que falle quien debe', () => {
    expect(normalizarNumero('abc')).toBe('abc');
  });
});

describe('esDecimalValido', () => {
  it('acepta las formas que puede escribir una persona', () => {
    for (const valido of ['2.5', '2,5', '1.234,5', '0', '-3', '25']) {
      expect(esDecimalValido(valido), valido).toBe(true);
    }
  });

  it('rechaza lo que no es un número', () => {
    for (const invalido of ['', '  ', 'abc', '2,5,5', '1..2', '2 kg']) {
      expect(esDecimalValido(invalido), JSON.stringify(invalido)).toBe(false);
    }
  });
});
