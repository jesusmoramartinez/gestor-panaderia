import { describe, expect, it } from 'vitest';

import {
  accionesPosibles,
  calcularCostoPromedio,
  compararCostos,
  costoPorUnidadBase,
  estaAtrasada,
  ESTADOS_ORDEN,
  estadoSegunRecibido,
  type MovimientoParaCosto,
  pendienteDe,
  puedeHacer,
  recalcularEstadoOrden,
} from './compras.js';

/** Arma movimientos de prueba sin tener que escribir todos los campos. */
let siguienteId = 0;
function mov(
  tipo: MovimientoParaCosto['tipo'],
  cantidadBase: string,
  costoUnitario: string | null = null,
  revierteAId: string | null = null,
): MovimientoParaCosto {
  siguienteId += 1;
  return { id: `m${String(siguienteId)}`, tipo, cantidadBase, costoUnitario, revierteAId };
}

describe('costo promedio ponderado', () => {
  it('el ejemplo de PLAN.md 3.7: 100 kg a $1.000 + 50 kg a $1.300 = $1.100/kg', () => {
    // Este es EL test de la fase: el criterio de "terminado" lo nombra.
    const movimientos = [mov('COMPRA', '100', '1000'), mov('COMPRA', '50', '1300')];
    expect(calcularCostoPromedio(movimientos)?.toString()).toBe('1100');
  });

  it('sin ninguna compra el costo es desconocido (null), no cero', () => {
    expect(calcularCostoPromedio([])).toBeNull();
    expect(calcularCostoPromedio([mov('SALDO_INICIAL', '70')])).toBeNull();
  });

  it('la primera compra fija el costo', () => {
    expect(calcularCostoPromedio([mov('COMPRA', '25', '740')])?.toString()).toBe('740');
  });

  it('un consumo cambia cuánto hay, pero no lo que costó', () => {
    // 100 kg a $1.000, se usan 40: los 60 que quedan siguen costando $1.000.
    const movimientos = [mov('COMPRA', '100', '1000'), mov('CONSUMO', '-40')];
    expect(calcularCostoPromedio(movimientos)?.toString()).toBe('1000');
  });

  it('el consumo SÍ cambia cuánto pesa la compra siguiente en el promedio', () => {
    // 100 a $1.000, se usan 40 → quedan 60 a $1.000. Llegan 60 a $1.300.
    // (60 × 1.000 + 60 × 1.300) / 120 = $1.150. Sin el consumo daría 1.112,5.
    const movimientos = [
      mov('COMPRA', '100', '1000'),
      mov('CONSUMO', '-40'),
      mov('COMPRA', '60', '1300'),
    ];
    expect(calcularCostoPromedio(movimientos)?.toString()).toBe('1150');
  });

  it('el stock sin costo (saldo inicial) toma el precio de la primera compra', () => {
    // Decisión del cliente. Si promediáramos 70 kg a $0 con 25 kg a $740, el
    // costo daría $194,74/kg: un número inventado que haría parecer regalada
    // la harina.
    const movimientos = [mov('SALDO_INICIAL', '70'), mov('COMPRA', '25', '740')];
    expect(calcularCostoPromedio(movimientos)?.toString()).toBe('740');
  });

  it('las mermas y los ajustes tampoco mueven el promedio', () => {
    const movimientos = [
      mov('COMPRA', '100', '1000'),
      mov('MERMA', '-5'),
      mov('AJUSTE', '3'),
      mov('AJUSTE', '-2'),
    ];
    expect(calcularCostoPromedio(movimientos)?.toString()).toBe('1000');
  });

  it('si el stock estaba en cero o negativo, el precio nuevo manda', () => {
    // 10 a $1.000, se consumen 15 (forzado) → −5. Llegan 20 a $1.300.
    // Promediar contra −5 daría (−5 × 1.000 + 20 × 1.300) / 15 = $1.400: más
    // caro que cualquier compra real. El precio nuevo es lo único con sentido.
    const movimientos = [
      mov('COMPRA', '10', '1000'),
      mov('CONSUMO', '-15'),
      mov('COMPRA', '20', '1300'),
    ];
    expect(calcularCostoPromedio(movimientos)?.toString()).toBe('1300');
  });

  it('una compra anulada y su reversa no cuentan: el promedio vuelve al valor anterior', () => {
    const antes = [mov('COMPRA', '100', '1000')];
    const compra = mov('COMPRA', '50', '1300');
    const reversa = mov('REVERSA', '-50', '1300', compra.id);

    expect(calcularCostoPromedio([...antes, compra])?.toString()).toBe('1100');
    expect(calcularCostoPromedio([...antes, compra, reversa])?.toString()).toBe('1000');
  });

  it('anular la ÚNICA compra deja el costo desconocido otra vez', () => {
    const compra = mov('COMPRA', '25', '740');
    const reversa = mov('REVERSA', '-25', '740', compra.id);
    expect(calcularCostoPromedio([compra, reversa])).toBeNull();
  });

  it('la reversa de un CONSUMO no se saltea: solo devuelve cantidad', () => {
    const consumo = mov('CONSUMO', '-40');
    const movimientos = [
      mov('COMPRA', '100', '1000'),
      consumo,
      mov('REVERSA', '40', null, consumo.id),
      mov('COMPRA', '100', '1300'),
    ];
    // Hay 100 (el consumo se anuló) → (100 × 1.000 + 100 × 1.300) / 200 = 1.150
    expect(calcularCostoPromedio(movimientos)?.toString()).toBe('1150');
  });

  it('redondea a 4 decimales una sola vez, al final', () => {
    // (3 × 1 + 7 × 2) / 10 = 1,7 exacto; (1 × 1 + 2 × 2) / 3 = 1,6666…
    const periodico = [mov('COMPRA', '1', '1'), mov('COMPRA', '2', '2')];
    expect(calcularCostoPromedio(periodico)?.toString()).toBe('1.6667');
  });

  it('una compra sin costo es un bug y se rechaza', () => {
    expect(() => calcularCostoPromedio([mov('COMPRA', '10', null)])).toThrow(/costo unitario/);
  });
});

describe('costo por unidad base', () => {
  it('bolsa de 25 kg a $25.000 → $1.000/kg (criterio de terminado)', () => {
    expect(costoPorUnidadBase('25000', '25').toString()).toBe('1000');
  });

  it('bolsa de 50 kg a $39.500 → $790/kg', () => {
    expect(costoPorUnidadBase('39500', '50').toString()).toBe('790');
  });

  it('balde de aceite de 18,4 kg a $52.000 → redondeado a 4 decimales', () => {
    // 52.000 / 18,4 = 2.826,0869565… → 2.826,087
    expect(costoPorUnidadBase('52000', '18.4').toString()).toBe('2826.087');
  });

  it('rechaza un factor cero o negativo', () => {
    expect(() => costoPorUnidadBase('100', '0')).toThrow();
  });
});

describe('máquina de estados de la orden', () => {
  it('todos los estados tienen su lista de acciones', () => {
    for (const estado of ESTADOS_ORDEN) {
      expect(accionesPosibles(estado), estado).toBeDefined();
    }
  });

  it('solo se edita lo que todavía no empezó a llegar', () => {
    expect(puedeHacer('BORRADOR', 'editar')).toBe(true);
    expect(puedeHacer('PEDIDA', 'editar')).toBe(true);
    expect(puedeHacer('PARCIAL', 'editar')).toBe(false);
    expect(puedeHacer('RECIBIDA', 'editar')).toBe(false);
  });

  it('no se recibe un borrador: primero hay que pedirlo', () => {
    expect(puedeHacer('BORRADOR', 'recibir')).toBe(false);
    expect(puedeHacer('PEDIDA', 'recibir')).toBe(true);
    expect(puedeHacer('PARCIAL', 'recibir')).toBe(true);
  });

  it('cancelar es solo si no llegó nada; si llegó algo, es cerrar', () => {
    expect(puedeHacer('PEDIDA', 'cancelar')).toBe(true);
    expect(puedeHacer('PARCIAL', 'cancelar')).toBe(false);
    expect(puedeHacer('PARCIAL', 'cerrar')).toBe(true);
    expect(puedeHacer('PEDIDA', 'cerrar')).toBe(false);
  });

  it('los estados finales no admiten ninguna acción', () => {
    for (const estado of ['RECIBIDA', 'CERRADA', 'CANCELADA'] as const) {
      expect(accionesPosibles(estado), estado).toHaveLength(0);
    }
  });
});

describe('estado según lo recibido', () => {
  it('10 pedidas, 4 recibidas → PARCIAL con 6 pendientes (criterio de terminado)', () => {
    // En bolsas para leerlo fácil; en el sistema son 250 kg y 100 kg.
    const linea = { pedido: '250', recibido: '100' };
    expect(estadoSegunRecibido([linea])).toBe('PARCIAL');
    expect(pendienteDe(linea).toString()).toBe('150');
  });

  it('cuando llega el resto → RECIBIDA, sin pendientes', () => {
    const linea = { pedido: '250', recibido: '250' };
    expect(estadoSegunRecibido([linea])).toBe('RECIBIDA');
    expect(pendienteDe(linea).toString()).toBe('0');
  });

  it('nada recibido → PEDIDA', () => {
    expect(estadoSegunRecibido([{ pedido: '250', recibido: '0' }])).toBe('PEDIDA');
  });

  it('con varias líneas, basta una incompleta para que siga PARCIAL', () => {
    expect(
      estadoSegunRecibido([
        { pedido: '250', recibido: '250' },
        { pedido: '10', recibido: '0' },
      ]),
    ).toBe('PARCIAL');
  });

  it('anular la única recepción de una orden RECIBIDA la devuelve a PEDIDA', () => {
    expect(recalcularEstadoOrden('RECIBIDA', [{ pedido: '250', recibido: '0' }])).toBe('PEDIDA');
  });

  it('una orden CERRADA sigue cerrada aunque se anule una recepción', () => {
    // El dueño ya dijo que lo que falta no va a llegar: eso no cambia.
    expect(recalcularEstadoOrden('CERRADA', [{ pedido: '250', recibido: '0' }])).toBe('CERRADA');
  });
});

describe('entrega atrasada (C-8)', () => {
  it('una orden pedida cuya fecha ya pasó está atrasada', () => {
    expect(estaAtrasada('PEDIDA', '2026-10-07', '2026-10-08')).toBe(true);
    expect(estaAtrasada('PARCIAL', '2026-10-07', '2026-10-08')).toBe(true);
  });

  it('el mismo día de la entrega todavía no está atrasada', () => {
    expect(estaAtrasada('PEDIDA', '2026-10-08', '2026-10-08')).toBe(false);
  });

  it('lo que ya no se espera nunca está atrasado', () => {
    for (const estado of ['BORRADOR', 'RECIBIDA', 'CERRADA', 'CANCELADA'] as const) {
      expect(estaAtrasada(estado, '2026-01-01', '2026-10-08'), estado).toBe(false);
    }
  });

  it('sin fecha estimada no hay atraso', () => {
    expect(estaAtrasada('PEDIDA', null, '2026-10-08')).toBe(false);
  });
});

describe('comparar precios entre proveedores (C-6)', () => {
  it('marca el más barato y el más caro', () => {
    expect(compararCostos(['1000', '790', '850'])).toEqual(['MAS_CARO', 'MAS_BARATO', null]);
  });

  it('con un solo precio no hay comparación', () => {
    expect(compararCostos(['1000', null])).toEqual([null, null]);
  });

  it('sin precio no se marca', () => {
    expect(compararCostos(['1000', null, '790'])).toEqual(['MAS_CARO', null, 'MAS_BARATO']);
  });

  it('si todos cuestan lo mismo, nadie es más barato', () => {
    expect(compararCostos(['1000', '1000.0'])).toEqual([null, null]);
  });
});
