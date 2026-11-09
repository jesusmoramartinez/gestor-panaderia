import { describe, expect, it } from 'vitest';

import {
  cuentaDeCompra,
  cuentaDeRenglon,
  diasEntre,
  estadoDePago,
  type RenglonAcopio,
  validarPago,
} from './acopio.js';
import { aDecimal } from './decimal.js';

/** 100 bolsas de 25 kg a $20.000 la bolsa, con `llegaron` bolsas entregadas. */
function harina(llegaron: number, precio: string | null = '20000'): RenglonAcopio {
  return {
    cantidad: '100',
    cantidadBase: '2500',
    recibidoBase: String(llegaron * 25),
    factor: '25',
    precioUnitario: precio,
  };
}

describe('cuenta de un renglón', () => {
  it('el caso de Marcelo: compró 100, llegaron 20 + 20 → le deben 60 bolsas y su valor', () => {
    const cuenta = cuentaDeRenglon(harina(40));
    expect(cuenta.recibido.toString()).toBe('40');
    expect(cuenta.pendiente.toString()).toBe('60');
    expect(cuenta.pendienteBase.toString()).toBe('1500');
    expect(cuenta.valorTotal?.toString()).toBe('2000000');
    expect(cuenta.valorRecibido?.toString()).toBe('800000');
    expect(cuenta.valorPendiente?.toString()).toBe('1200000');
  });

  it('completo: no le deben nada', () => {
    const cuenta = cuentaDeRenglon(harina(100));
    expect(cuenta.pendiente.toString()).toBe('0');
    expect(cuenta.valorPendiente?.toString()).toBe('0');
  });

  it('sin precio cargado: las cantidades sí, la plata no (null, no cero)', () => {
    const cuenta = cuentaDeRenglon(harina(40, null));
    expect(cuenta.pendiente.toString()).toBe('60');
    expect(cuenta.valorPendiente).toBeNull();
    expect(cuenta.valorTotal).toBeNull();
  });

  it('en unidad base (sin presentación, factor 1): 30 kg pedidos, 12 llegaron', () => {
    const cuenta = cuentaDeRenglon({
      cantidad: '30',
      cantidadBase: '30',
      recibidoBase: '12',
      factor: '1',
      precioUnitario: '1500',
    });
    expect(cuenta.pendiente.toString()).toBe('18');
    expect(cuenta.valorPendiente?.toString()).toBe('27000');
  });

  it('decimales sin perder centavos: 3 cajas a $1.234,5678', () => {
    const cuenta = cuentaDeRenglon({
      cantidad: '3',
      cantidadBase: '36',
      recibidoBase: '12',
      factor: '12',
      precioUnitario: '1234.5678',
    });
    expect(cuenta.valorTotal?.toString()).toBe('3703.7034');
    expect(cuenta.valorPendiente?.toString()).toBe('2469.1356');
  });
});

describe('cuenta de una compra', () => {
  it('pagó todo por adelantado y llegó una parte: pagada, y el proveedor tiene plata suya', () => {
    const cuenta = cuentaDeCompra([harina(40)], '2000000');
    expect(cuenta.total?.toString()).toBe('2000000');
    expect(cuenta.estadoPago).toBe('PAGADA');
    expect(cuenta.saldo?.toString()).toBe('0');
    // Pagó 2.000.000 y recibió por 800.000: hay 1.200.000 suyos sin entregar.
    expect(cuenta.adelantadoSinEntregar.toString()).toBe('1200000');
  });

  it('sin pagos: no hay adelanto aunque le deban mercadería', () => {
    const cuenta = cuentaDeCompra([harina(40)], '0');
    expect(cuenta.estadoPago).toBe('SIN_PAGO');
    expect(cuenta.saldo?.toString()).toBe('2000000');
    expect(cuenta.adelantadoSinEntregar.toString()).toBe('0');
  });

  it('pagó menos de lo que ya llegó: el adelanto es cero, no negativo', () => {
    const cuenta = cuentaDeCompra([harina(40)], '500000');
    expect(cuenta.estadoPago).toBe('PAGO_PARCIAL');
    expect(cuenta.adelantadoSinEntregar.toString()).toBe('0');
    expect(cuenta.saldo?.toString()).toBe('1500000');
  });

  it('varios insumos en la misma compra (C-21): suma todos', () => {
    const azucar: RenglonAcopio = {
      cantidad: '10',
      cantidadBase: '500',
      recibidoBase: '0',
      factor: '50',
      precioUnitario: '30000',
    };
    const cuenta = cuentaDeCompra([harina(100), azucar], '2300000');
    expect(cuenta.total?.toString()).toBe('2300000');
    expect(cuenta.valorPendiente.toString()).toBe('300000');
    expect(cuenta.adelantadoSinEntregar.toString()).toBe('300000');
  });

  it('un renglón sin precio: no hay total (no es "el total sin ese renglón")', () => {
    const cuenta = cuentaDeCompra([harina(0), harina(0, null)], '0');
    expect(cuenta.total).toBeNull();
    expect(cuenta.saldo).toBeNull();
    expect(cuenta.renglonesSinPrecio).toBe(1);
  });
});

describe('estado de pago', () => {
  it('sale de los números', () => {
    expect(estadoDePago(aDecimal('100'), aDecimal('0'))).toBe('SIN_PAGO');
    expect(estadoDePago(aDecimal('100'), aDecimal('40'))).toBe('PAGO_PARCIAL');
    expect(estadoDePago(aDecimal('100'), aDecimal('100'))).toBe('PAGADA');
  });
});

describe('validar un pago', () => {
  it('se puede pagar justo el saldo', () => {
    expect(validarPago(cuentaDeCompra([harina(0)], '0'), '2000000')).toEqual({ valido: true });
  });

  it('no se puede pagar más que el saldo (el cero de más al tipear)', () => {
    const resultado = validarPago(cuentaDeCompra([harina(0)], '1500000'), '600000');
    expect(resultado.valido).toBe(false);
    if (!resultado.valido && resultado.motivo === 'EXCEDE_TOTAL') {
      expect(resultado.saldo.toString()).toBe('500000');
    } else {
      expect.fail('tenía que ser EXCEDE_TOTAL');
    }
  });

  it('sin total (falta un precio) no se puede pagar', () => {
    expect(validarPago(cuentaDeCompra([harina(0, null)], '0'), '1')).toEqual({
      valido: false,
      motivo: 'SIN_TOTAL',
    });
  });
});

describe('días entre dos días', () => {
  it('cuenta días de calendario', () => {
    expect(diasEntre('2026-11-01', '2026-11-08')).toBe(7);
    expect(diasEntre('2026-11-08', '2026-11-08')).toBe(0);
    // Cruza el fin de mes y de año.
    expect(diasEntre('2026-12-30', '2027-01-02')).toBe(3);
  });
});
