import { describe, expect, it } from 'vitest';

import { diaEnArgentina, formatearDia, formatearFechaArgentina } from './fecha.js';

describe('formatearFechaArgentina', () => {
  it('convierte un instante UTC a hora de Argentina (UTC-3)', () => {
    const instante = new Date('2026-10-05T23:30:00Z');
    expect(formatearFechaArgentina(instante)).toBe('05/10/2026, 20:30');
  });

  it('cambia de día cuando la hora UTC ya pasó la medianoche', () => {
    // Este es el caso que importa de verdad: el panadero cierra el 14 a las
    // 23:05 y el servidor registra 2026-01-15T02:05:00Z. Si mostráramos la
    // fecha en UTC, el movimiento aparecería el día 15: un día de ventas
    // movido al día siguiente.
    const instante = new Date('2026-01-15T02:05:00Z');
    expect(formatearFechaArgentina(instante)).toBe('14/01/2026, 23:05');
  });

  it('usa el mismo desfase todo el año (Argentina no cambia de hora)', () => {
    const enero = formatearFechaArgentina(new Date('2026-01-15T12:00:00Z'));
    const julio = formatearFechaArgentina(new Date('2026-07-15T12:00:00Z'));
    expect(enero.slice(-5)).toBe('09:00');
    expect(julio.slice(-5)).toBe('09:00');
  });
});

describe('diaEnArgentina', () => {
  it('devuelve el día en formato AAAA-MM-DD', () => {
    expect(diaEnArgentina(new Date('2026-10-08T15:00:00Z'))).toBe('2026-10-08');
  });

  it('a las 22 de Argentina sigue siendo el mismo día, aunque en UTC ya sea mañana', () => {
    // 22:30 del 8 en Argentina = 01:30 del 9 en UTC.
    expect(diaEnArgentina(new Date('2026-10-09T01:30:00Z'))).toBe('2026-10-08');
  });
});

describe('formatearDia', () => {
  it('muestra el día a la argentina', () => {
    expect(formatearDia('2026-10-08')).toBe('08/10/2026');
  });
});
