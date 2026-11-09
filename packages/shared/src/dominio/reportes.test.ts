import { describe, expect, it } from 'vitest';

import {
  comparacionDeProveedores,
  type CompraReporte,
  cumplimientoDeProveedores,
  type EntregaReporte,
  entregasPorSemana,
  gastoPorInsumo,
  gastoPorMes,
  gastoPorProveedor,
  lunesDe,
  mesesEntre,
  type PagoReporte,
  pagosPorMedio,
  preciosPagados,
} from './reportes.js';

/**
 * Un juego de datos chico, armado para que cada número se pueda sacar a
 * mano. Las horas son 15:00 UTC (mediodía en Argentina): ningún hecho cae
 * en el día equivocado por la zona horaria.
 *
 *   Compra 1 · Molino    10/09  100 bolsas harina a $20.000  RECIBIDA el 20/09
 *   Compra 2 · Molino    05/10   50 bolsas harina a $22.000  PARCIAL (llegaron 20)
 *   Compra 3 · Mayorista 12/10   10 bolsas harina a $21.000  RECIBIDA el mismo día
 *                                 4 bolsas azúcar a $30.000
 *   Compra 4 · Mayorista 20/10    5 bolsas harina a $1       CANCELADA (no cuenta)
 */
const molino = { id: 'p1', nombre: 'Molino' };
const mayorista = { id: 'p2', nombre: 'Mayorista' };
const harina = { id: 'i1', nombre: 'Harina 000', unidad: 'kg' };
const azucar = { id: 'i2', nombre: 'Azúcar', unidad: 'kg' };

function renglon(
  insumo: typeof harina,
  bolsas: number,
  precio: string,
  llegaron: number,
  factor = 25,
) {
  return {
    insumo,
    presentacion: `Bolsa ${String(factor)} kg`,
    cantidad: String(bolsas),
    cantidadBase: String(bolsas * factor),
    factor: String(factor),
    precioUnitario: precio,
    recibidoBase: String(llegaron * factor),
  };
}

const compras: CompraReporte[] = [
  {
    id: 'c1',
    numero: 1,
    estado: 'RECIBIDA',
    pedidaAt: '2026-09-10T15:00:00Z',
    proveedor: molino,
    renglones: [renglon(harina, 100, '20000', 100)],
    ultimaEntregaAt: '2026-09-20T15:00:00Z',
  },
  {
    id: 'c2',
    numero: 2,
    estado: 'PARCIAL',
    pedidaAt: '2026-10-05T15:00:00Z',
    proveedor: molino,
    renglones: [renglon(harina, 50, '22000', 20)],
    ultimaEntregaAt: '2026-10-06T15:00:00Z',
  },
  {
    id: 'c3',
    numero: 3,
    estado: 'RECIBIDA',
    pedidaAt: '2026-10-12T15:00:00Z',
    proveedor: mayorista,
    renglones: [renglon(harina, 10, '21000', 10), renglon(azucar, 4, '30000', 4, 50)],
    ultimaEntregaAt: '2026-10-12T16:00:00Z',
  },
  {
    id: 'c4',
    numero: 4,
    estado: 'CANCELADA',
    pedidaAt: '2026-10-20T15:00:00Z',
    proveedor: mayorista,
    renglones: [renglon(harina, 5, '1', 0)],
    ultimaEntregaAt: null,
  },
];

const pagos: PagoReporte[] = [
  { fecha: '2026-09-10T15:00:00Z', monto: '2000000', medio: 'TRANSFERENCIA', proveedor: molino },
  { fecha: '2026-10-05T15:00:00Z', monto: '1100000', medio: 'MERCADO_PAGO', proveedor: molino },
  { fecha: '2026-10-12T15:00:00Z', monto: '330000', medio: 'EFECTIVO', proveedor: mayorista },
];

describe('ayudas de fechas', () => {
  it('los meses de un período, inclusive, cruzando el año', () => {
    expect(mesesEntre('2026-11-15', '2027-02-01')).toEqual([
      '2026-11',
      '2026-12',
      '2027-01',
      '2027-02',
    ]);
  });

  it('el lunes de la semana', () => {
    expect(lunesDe('2026-09-20')).toBe('2026-09-14'); // domingo → el lunes anterior
    expect(lunesDe('2026-10-12')).toBe('2026-10-12'); // ya es lunes
    expect(lunesDe('2026-10-06')).toBe('2026-10-05'); // martes
  });
});

describe('4. gasto por mes', () => {
  it('✅ comprado y pagado por mes; el mes sin nada aparece en cero; la cancelada no cuenta', () => {
    expect(gastoPorMes(compras, pagos, '2026-09-01', '2026-11-15')).toEqual([
      { mes: '2026-09', comprado: '2000000', pagado: '2000000' },
      // 1.100.000 + 210.000 + 120.000. La cancelada ($5) no está.
      { mes: '2026-10', comprado: '1430000', pagado: '1430000' },
      { mes: '2026-11', comprado: '0', pagado: '0' },
    ]);
  });
});

describe('5. gasto por proveedor y por insumo', () => {
  it('por proveedor, el que más se lleva primero', () => {
    expect(gastoPorProveedor(compras)).toEqual([
      { proveedor: molino, compras: 2, comprado: '3100000' },
      { proveedor: mayorista, compras: 1, comprado: '330000' },
    ]);
  });

  it('por insumo, con la cantidad en kg', () => {
    expect(gastoPorInsumo(compras)).toEqual([
      {
        insumo: { id: 'i1', nombre: 'Harina 000' },
        unidad: 'kg',
        cantidadBase: '4000',
        comprado: '3310000',
      },
      {
        insumo: { id: 'i2', nombre: 'Azúcar' },
        unidad: 'kg',
        cantidadBase: '200',
        comprado: '120000',
      },
    ]);
  });
});

describe('6. pagos por medio', () => {
  it('totales y por mes', () => {
    const reporte = pagosPorMedio(pagos, '2026-09-01', '2026-10-31');
    expect(reporte.totales).toEqual([
      { medio: 'EFECTIVO', pagos: 1, total: '330000' },
      { medio: 'TRANSFERENCIA', pagos: 1, total: '2000000' },
      { medio: 'MERCADO_PAGO', pagos: 1, total: '1100000' },
    ]);
    expect(reporte.porMes).toEqual([
      { mes: '2026-09', EFECTIVO: '0', TRANSFERENCIA: '2000000', MERCADO_PAGO: '0' },
      { mes: '2026-10', EFECTIVO: '330000', TRANSFERENCIA: '0', MERCADO_PAGO: '1100000' },
    ]);
  });
});

describe('7. evolución del precio', () => {
  it('cada precio pagado, por kg, en orden de fecha', () => {
    const deHarina = preciosPagados(compras).filter((p) => p.insumoId === 'i1');
    expect(deHarina.map((p) => [p.compraNumero, p.precioUnitario, p.precioPorUnidadBase])).toEqual([
      [1, '20000', '800'],
      [2, '22000', '880'],
      [3, '21000', '840'],
    ]);
  });
});

describe('8. comparación de proveedores', () => {
  it('✅ promedio ponderado por kg, mínimo, máximo, último, y quién es más barato', () => {
    const [azucarFila, harinaFila] = comparacionDeProveedores(compras);
    // Molino: (2.000.000 + 1.100.000) / 3.750 kg = 826,6667/kg.
    expect(harinaFila?.proveedores).toEqual([
      {
        proveedor: molino,
        compras: 2,
        cantidadBase: '3750',
        promedio: '826.6667',
        minimo: '800',
        maximo: '880',
        ultimo: '880',
        masBarato: true,
      },
      {
        proveedor: mayorista,
        compras: 1,
        cantidadBase: '250',
        promedio: '840',
        minimo: '840',
        maximo: '840',
        ultimo: '840',
        masBarato: false,
      },
    ]);
    // Con un solo proveedor no hay "más barato": no hay con quién comparar.
    expect(azucarFila?.insumo.nombre).toBe('Azúcar');
    expect(azucarFila?.proveedores[0]?.masBarato).toBe(false);
  });
});

describe('9. cumplimiento', () => {
  it('✅ completas, abiertas, canceladas, días y cuánto del valor llegó', () => {
    expect(cumplimientoDeProveedores(compras)).toEqual([
      {
        proveedor: mayorista,
        compras: 2,
        completas: 1,
        cerradasConFaltante: 0,
        abiertas: 0,
        canceladas: 1,
        diasPromedio: 0,
        porcentajeEntregado: 100,
      },
      {
        proveedor: molino,
        compras: 2,
        completas: 1,
        cerradasConFaltante: 0,
        abiertas: 1,
        canceladas: 0,
        diasPromedio: 10,
        // (2.000.000 + 20 × 22.000) / 3.100.000 = 78,7 %
        porcentajeEntregado: 79,
      },
    ]);
  });
});

describe('10. entregas por semana', () => {
  it('agrupadas por semana (de lunes), la más reciente primero', () => {
    const entregas: EntregaReporte[] = [
      {
        id: 'e1',
        numero: 1,
        fecha: '2026-09-20T15:00:00Z',
        proveedor: molino,
        sucursal: 'Catán',
        compraNumero: 1,
        renglones: [
          { insumo: harina, presentacion: 'Bolsa 25 kg', cantidad: '100', precioUnitario: '20000' },
        ],
      },
      {
        id: 'e3',
        numero: 3,
        fecha: '2026-10-12T15:00:00Z',
        proveedor: mayorista,
        sucursal: 'Laferrere',
        compraNumero: 3,
        renglones: [
          { insumo: harina, presentacion: 'Bolsa 25 kg', cantidad: '10', precioUnitario: '21000' },
          { insumo: azucar, presentacion: 'Bolsa 50 kg', cantidad: '4', precioUnitario: '30000' },
        ],
      },
    ];
    const semanas = entregasPorSemana(entregas);
    expect(semanas.map((s) => [s.semana, s.entregas, s.valor, s.renglones.length])).toEqual([
      ['2026-10-12', 1, '330000', 2],
      ['2026-09-14', 1, '2000000', 1],
    ]);
    expect(semanas[0]?.renglones[0]?.sucursal).toBe('Laferrere');
  });
});
