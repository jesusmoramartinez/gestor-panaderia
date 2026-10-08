import { describe, expect, it } from 'vitest';

import {
  accionesDeTransferencia,
  diferenciaDeTransferencia,
  movimientosAlRecibir,
} from './transferencias.js';

/** Suma con signo, como el kardex: entradas suman y mermas restan. */
function efectoEnDestino(movimientos: ReturnType<typeof movimientosAlRecibir>): string {
  return movimientos
    .reduce(
      (suma, m) => (m.tipo === 'MERMA' ? suma.minus(m.cantidad) : suma.plus(m.cantidad)),
      diferenciaDeTransferencia('0', '0'),
    )
    .toString();
}

describe('qué se registra al recibir', () => {
  it('salieron 20 y llegaron 18 → entran 20 y hay una merma de 2 (criterio de terminado)', () => {
    const movimientos = movimientosAlRecibir('20', '18');
    expect(movimientos.map((m) => [m.tipo, m.cantidad.toString()])).toEqual([
      ['TRANSFERENCIA_ENTRADA', '20'],
      ['MERMA', '2'],
    ]);
    // El destino sube exactamente lo que llegó.
    expect(efectoEnDestino(movimientos)).toBe('18');
  });

  it('si llegó todo, no hay merma', () => {
    const movimientos = movimientosAlRecibir('20', '20');
    expect(movimientos.map((m) => m.tipo)).toEqual(['TRANSFERENCIA_ENTRADA']);
  });

  it('si no llegó nada, la merma es todo lo enviado y el destino no cambia', () => {
    const movimientos = movimientosAlRecibir('20', '0');
    expect(movimientos.map((m) => [m.tipo, m.cantidad.toString()])).toEqual([
      ['TRANSFERENCIA_ENTRADA', '20'],
      ['MERMA', '20'],
    ]);
    expect(efectoEnDestino(movimientos)).toBe('0');
  });

  it('con decimales no se pierde nada', () => {
    const movimientos = movimientosAlRecibir('2.5', '2.35');
    expect(movimientos[1]?.cantidad.toString()).toBe('0.15');
  });

  it('no puede llegar más de lo que salió', () => {
    expect(() => movimientosAlRecibir('20', '21')).toThrow(/no puede llegar más/);
  });

  it('lo recibido no puede ser negativo', () => {
    expect(() => movimientosAlRecibir('20', '-1')).toThrow();
  });
});

describe('estados de la transferencia', () => {
  it('solo lo que está en tránsito se recibe o se anula', () => {
    expect(accionesDeTransferencia('ENVIADA')).toEqual(['recibir', 'anular']);
    expect(accionesDeTransferencia('RECIBIDA')).toEqual([]);
    expect(accionesDeTransferencia('ANULADA')).toEqual([]);
  });
});
