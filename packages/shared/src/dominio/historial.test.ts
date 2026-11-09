import { describe, expect, it } from 'vitest';

import { formatearDinero } from './decimal.js';
import { armarHistorial, type DatosHistorial } from './historial.js';

const marcelo = { id: '00000000-0000-4000-8000-000000000001', nombre: 'Marcelo' };

function base(cambios: Partial<DatosHistorial> = {}): DatosHistorial {
  return {
    creadaAt: '2026-11-01T12:00:00.000Z',
    pedidaAt: '2026-11-01T12:00:00.500Z',
    cerradaAt: null,
    estado: 'PEDIDA',
    notaCierre: null,
    creadaPor: marcelo,
    cerradaPor: null,
    cantidadInsumos: 1,
    total: '2000000',
    ediciones: [],
    pagos: [],
    entregas: [],
    notas: [],
    ...cambios,
  };
}

function entrega(numero: number, fecha: string, cantidad: string) {
  return {
    id: `00000000-0000-4000-8000-00000000010${String(numero)}`,
    numero,
    fecha,
    sucursal: 'Catán',
    usuario: marcelo,
    renglones: [{ insumo: 'Harina 000', cantidad, presentacion: 'Bolsa 25 kg', unidad: 'kg' }],
    remito: null,
    fotos: 0,
    anuladaAt: null,
    anuladaPor: null,
    motivoAnulacion: null,
  };
}

function pago(fecha: string, monto: string) {
  return {
    fecha,
    monto,
    medio: 'TRANSFERENCIA' as const,
    nota: null,
    usuario: marcelo,
    comprobantes: 1,
    anuladoAt: null,
    anuladoPor: null,
    motivoAnulacion: null,
  };
}

describe('el historial de una compra', () => {
  it('✅ 2 pagos, 3 entregas y una nota: los 6 eventos (más la creación) en orden', () => {
    const eventos = armarHistorial(
      base({
        pagos: [pago('2026-11-01T13:00:00Z', '1000000'), pago('2026-11-03T13:00:00Z', '1000000')],
        entregas: [
          entrega(1, '2026-11-02T10:00:00Z', '20'),
          entrega(2, '2026-11-09T10:00:00Z', '20'),
          entrega(3, '2026-11-16T10:00:00Z', '20'),
        ],
        notas: [
          { fecha: '2026-11-10T09:00:00Z', texto: 'la próxima viene el 16', usuario: marcelo },
        ],
      }),
    );
    expect(eventos.map((e) => e.tipo)).toEqual([
      'CREADA',
      'PAGO',
      'ENTREGA',
      'PAGO',
      'ENTREGA',
      'NOTA',
      'ENTREGA',
    ]);
    expect(eventos[0]?.titulo).toBe('Compra creada y pedida');
    // Intl separa el "$" con un espacio DURO: se arma con la misma función.
    expect(eventos[1]?.titulo).toBe(`Pago de ${formatearDinero('1000000')} · Transferencia`);
    expect(eventos[1]?.detalle).toBe('1 comprobante');
    expect(eventos[2]?.titulo).toBe('Entrega 1 en Catán');
    expect(eventos[2]?.detalle).toBe('20 × Bolsa 25 kg de Harina 000');
    expect(eventos[2]?.recepcionId).not.toBeNull();
    expect(eventos[5]?.detalle).toBe('la próxima viene el 16');
  });

  it('un borrador pedido días después son dos eventos', () => {
    const eventos = armarHistorial(base({ pedidaAt: '2026-11-04T12:00:00Z' }));
    expect(eventos.map((e) => e.titulo)).toEqual([
      'Compra creada como borrador',
      'Marcada como pedida',
    ]);
  });

  it('un pago anulado deja dos eventos: el pago y su anulación, con el motivo', () => {
    const eventos = armarHistorial(
      base({
        pagos: [
          {
            ...pago('2026-11-01T13:00:00Z', '2000000'),
            anuladoAt: '2026-11-02T09:00:00Z',
            anuladoPor: marcelo,
            motivoAnulacion: 'cargué un cero de más',
          },
        ],
      }),
    );
    expect(eventos.map((e) => e.tipo)).toEqual(['CREADA', 'PAGO', 'PAGO_ANULADO']);
    expect(eventos[2]?.detalle).toBe('cargué un cero de más');
  });

  it('el cierre con faltante va al final, con su nota', () => {
    const eventos = armarHistorial(
      base({
        estado: 'CERRADA',
        cerradaAt: '2026-11-20T10:00:00Z',
        notaCierre: 'el molino no tiene más',
        cerradaPor: marcelo,
        entregas: [entrega(1, '2026-11-02T10:00:00Z', '30')],
      }),
    );
    expect(eventos.at(-1)?.titulo).toBe('Cerrada con faltante');
    expect(eventos.at(-1)?.detalle).toBe('el molino no tiene más');
  });

  it('a la misma hora, el orden en que pasan las cosas: el pago antes que su anulación', () => {
    const mismaHora = '2026-11-01T13:00:00Z';
    const eventos = armarHistorial(
      base({
        pagos: [
          {
            ...pago(mismaHora, '10'),
            anuladoAt: mismaHora,
            anuladoPor: marcelo,
            motivoAnulacion: 'x',
          },
        ],
      }),
    );
    expect(eventos.map((e) => e.tipo)).toEqual(['CREADA', 'PAGO', 'PAGO_ANULADO']);
  });
});
