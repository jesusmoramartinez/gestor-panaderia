import { describe, expect, it } from 'vitest';

import {
  aBultosEnteros,
  planificarReposicion,
  type SituacionInsumo,
  sobranteDeCentral,
} from './reposicion.js';

const CEN = 'central';
const LAF = 'laferrere';

function situacion(parcial: Partial<SituacionInsumo> & { sucursalId: string }): SituacionInsumo {
  return {
    insumoId: 'harina',
    saldo: '0',
    stockMinimo: '0',
    stockMaximo: null,
    yaPedido: '0',
    enCamino: '0',
    ...parcial,
  };
}

/** Un plan, con los decimales como texto para comparar fácil. */
function legible(plan: ReturnType<typeof planificarReposicion>[number]) {
  return {
    sucursal: plan.sucursalId,
    estado: plan.estado,
    faltante: plan.faltante.toString(),
    desdeCentral: plan.desdeCentral.toString(),
    aComprar: plan.aComprar.toString(),
  };
}

describe('qué aparece en la reposición', () => {
  it('✅ mínimo 50 y hay 40 → aparece, BAJO, faltan 10', () => {
    const planes = planificarReposicion(
      [situacion({ sucursalId: CEN, saldo: '40', stockMinimo: '50' })],
      CEN,
    );
    expect(planes.map(legible)).toEqual([
      { sucursal: CEN, estado: 'BAJO', faltante: '10', desdeCentral: '0', aComprar: '10' },
    ]);
  });

  it('sin mínimo configurado no aparece, aunque no haya nada', () => {
    // El mínimo es el "avisame". Si no, todo el catálogo nuevo sería crítico.
    expect(planificarReposicion([situacion({ sucursalId: CEN, saldo: '0' })], CEN)).toEqual([]);
  });

  it('lo que está OK no aparece', () => {
    expect(
      planificarReposicion([situacion({ sucursalId: CEN, saldo: '60', stockMinimo: '50' })], CEN),
    ).toEqual([]);
  });

  it('con máximo configurado, se repone hasta el máximo', () => {
    const [plan] = planificarReposicion(
      [situacion({ sucursalId: CEN, saldo: '40', stockMinimo: '50', stockMaximo: '120' })],
      CEN,
    );
    expect(plan?.faltante.toString()).toBe('80');
  });

  it('✅ lo crítico va primero', () => {
    const planes = planificarReposicion(
      [
        situacion({ sucursalId: CEN, insumoId: 'azucar', saldo: '5', stockMinimo: '10' }),
        situacion({ sucursalId: CEN, insumoId: 'levadura', saldo: '0', stockMinimo: '2' }),
      ],
      CEN,
    );
    expect(planes.map((p) => [p.insumoId, p.estado])).toEqual([
      ['levadura', 'CRITICO'],
      ['azucar', 'BAJO'],
    ]);
  });
});

describe('no pedir dos veces', () => {
  it('✅ lo ya pedido se descuenta: con 100 kg pedidos, no falta nada', () => {
    const [plan] = planificarReposicion(
      [
        situacion({
          sucursalId: CEN,
          saldo: '40',
          stockMinimo: '50',
          stockMaximo: '120',
          yaPedido: '100',
        }),
      ],
      CEN,
    );
    // Sigue en alerta (hoy hay 40 y el mínimo es 50), pero ya está resuelto.
    expect(plan?.estado).toBe('BAJO');
    expect(plan?.faltante.toString()).toBe('0');
  });

  it('una parte pedida: falta solo el resto', () => {
    const [plan] = planificarReposicion(
      [
        situacion({
          sucursalId: CEN,
          saldo: '40',
          stockMinimo: '50',
          stockMaximo: '120',
          yaPedido: '30',
        }),
      ],
      CEN,
    );
    expect(plan?.faltante.toString()).toBe('50');
  });

  it('lo que viene en una transferencia también se descuenta', () => {
    const [plan] = planificarReposicion(
      [
        situacion({ sucursalId: CEN, saldo: '0', stockMinimo: '0' }),
        situacion({ sucursalId: LAF, saldo: '10', stockMinimo: '50', enCamino: '25' }),
      ],
      CEN,
    );
    expect(plan?.sucursalId).toBe(LAF);
    expect(plan?.faltante.toString()).toBe('15');
  });
});

describe('la Central abastece a la otra sucursal', () => {
  it('el ejemplo de la nota: a Laferrere le faltan 70, a la Central le sobran 20', () => {
    const planes = planificarReposicion(
      [
        situacion({ sucursalId: CEN, saldo: '120', stockMinimo: '100' }),
        situacion({ sucursalId: LAF, saldo: '10', stockMinimo: '50', stockMaximo: '80' }),
      ],
      CEN,
    );
    expect(planes.map(legible)).toEqual([
      { sucursal: LAF, estado: 'BAJO', faltante: '70', desdeCentral: '20', aComprar: '50' },
    ]);
  });

  it('si a la Central le sobra todo, no se compra nada', () => {
    const [plan] = planificarReposicion(
      [
        situacion({ sucursalId: CEN, saldo: '200', stockMinimo: '100' }),
        situacion({ sucursalId: LAF, saldo: '10', stockMinimo: '50' }),
      ],
      CEN,
    );
    expect(plan?.desdeCentral.toString()).toBe('40');
    expect(plan?.aComprar.toString()).toBe('0');
  });

  it('nunca se le saca a la Central por debajo de su mínimo', () => {
    expect(sobranteDeCentral('90', '100').toString()).toBe('0');
    expect(sobranteDeCentral('-5', '0').toString()).toBe('0');
    expect(sobranteDeCentral('130', '100').toString()).toBe('30');
  });

  it('si la Central también está en alerta, compra para ella y no reparte', () => {
    const planes = planificarReposicion(
      [
        situacion({ sucursalId: CEN, saldo: '40', stockMinimo: '100' }),
        situacion({ sucursalId: LAF, saldo: '10', stockMinimo: '50' }),
      ],
      CEN,
    );
    expect(planes.map(legible)).toEqual([
      { sucursal: CEN, estado: 'BAJO', faltante: '60', desdeCentral: '0', aComprar: '60' },
      { sucursal: LAF, estado: 'BAJO', faltante: '40', desdeCentral: '0', aComprar: '40' },
    ]);
  });

  it('con dos sucursales que necesitan, el sobrante se reparte sin pasarse', () => {
    const planes = planificarReposicion(
      [
        situacion({ sucursalId: CEN, saldo: '130', stockMinimo: '100' }),
        situacion({ sucursalId: 'a', saldo: '0', stockMinimo: '20' }),
        situacion({ sucursalId: 'b', saldo: '0', stockMinimo: '20' }),
      ],
      CEN,
    );
    // Le sobran 30: 20 para la primera y 10 para la segunda.
    expect(
      planes.map((p) => [p.sucursalId, p.desdeCentral.toString(), p.aComprar.toString()]),
    ).toEqual([
      ['a', '20', '0'],
      ['b', '10', '10'],
    ]);
  });

  it('cada sucursal se mira con SUS números (la A no mezcla los de la B)', () => {
    const planes = planificarReposicion(
      [
        situacion({ sucursalId: CEN, saldo: '0', stockMinimo: '0' }),
        situacion({ sucursalId: LAF, saldo: '100', stockMinimo: '50' }),
        situacion({ sucursalId: 'otra', saldo: '5', stockMinimo: '50' }),
      ],
      CEN,
    );
    expect(planes.map((p) => p.sucursalId)).toEqual(['otra']);
  });

  it('sin central, todo se compra', () => {
    const [plan] = planificarReposicion(
      [situacion({ sucursalId: LAF, saldo: '10', stockMinimo: '50' })],
      null,
    );
    expect(plan?.aComprar.toString()).toBe('40');
  });
});

describe('bultos enteros, para arriba', () => {
  it('faltan 60 kg en bolsas de 25 → 3 bolsas (75 kg)', () => {
    const r = aBultosEnteros('60', '25');
    expect([r.bultos.toString(), r.cantidadBase.toString()]).toEqual(['3', '75']);
  });

  it('si da justo, no agrega un bulto de más', () => {
    expect(aBultosEnteros('50', '25').bultos.toString()).toBe('2');
  });

  it('suelto (factor 1) redondea a unidades enteras', () => {
    expect(aBultosEnteros('2.3', '1').bultos.toString()).toBe('3');
  });

  it('el balde de aceite de 18,4 kg', () => {
    const r = aBultosEnteros('30', '18.4');
    expect([r.bultos.toString(), r.cantidadBase.toString()]).toEqual(['2', '36.8']);
  });

  it('nada que comprar → cero bultos', () => {
    expect(aBultosEnteros('0', '25').bultos.toString()).toBe('0');
  });
});
