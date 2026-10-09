import { aDecimal, type Decimal, type Numerico } from './decimal.js';
import { type EstadoStock, estadoDeStock } from './stock.js';

/**
 * LA REPOSICIÓN: qué hay que traer, de dónde y cuánto. En funciones PURAS.
 *
 * Decisiones del cliente al arrancar la Fase 10:
 *
 *   1. Una sucursal que no es la central se repone PRIMERO desde la Central,
 *      con lo que a la Central le sobra por encima de su propio mínimo. Lo que
 *      la Central no puede cubrir, se compra.
 *   2. Lo que se compra se redondea PARA ARRIBA a bultos enteros de la
 *      presentación del proveedor: nadie pide 2,4 bolsas.
 *
 * La explicación completa está en docs/aprendizaje/18-fase-10-reposicion.md
 */

/** Lo que se sabe de un insumo en una sucursal, en unidad base. */
export type SituacionInsumo = {
  sucursalId: string;
  insumoId: string;
  saldo: Numerico;
  stockMinimo: Numerico;
  stockMaximo: Numerico | null;
  /** Lo que falta llegar de órdenes PEDIDAS o PARCIALES para esta sucursal. */
  yaPedido: Numerico;
  /** Lo que viene en transferencias en tránsito hacia esta sucursal. */
  enCamino: Numerico;
};

/** El plan para un insumo en alerta. Todo en unidad base. */
export type PlanInsumo = {
  sucursalId: string;
  insumoId: string;
  estado: Exclude<EstadoStock, 'OK'>;
  /** Hasta dónde se repone: el máximo si está configurado, si no, el mínimo. */
  objetivo: Decimal;
  /**
   * Lo que falta para llegar al objetivo, DESCONTANDO lo que ya está pedido y
   * lo que viene en camino (si no, se pediría dos veces). Nunca negativo.
   */
  faltante: Decimal;
  /** La parte que se trae de la Central. */
  desdeCentral: Decimal;
  /** La parte que hay que comprar (antes de redondear a bultos). */
  aComprar: Decimal;
};

const CERO = aDecimal('0');
const maximoEntre = (a: Decimal, b: Decimal) => (a.greaterThan(b) ? a : b);
const minimoEntre = (a: Decimal, b: Decimal) => (a.lessThan(b) ? a : b);

/**
 * Cuánto le SOBRA a la Central de un insumo: lo que tiene por encima de su
 * propio mínimo. Nunca se le saca por debajo del mínimo: la Central es la que
 * produce, y dejarla sin harina para abastecer a otra sucursal sería
 * trasladar el problema.
 *
 * Se cuenta solo lo que está FÍSICAMENTE en el depósito: lo que la Central
 * tiene pedido todavía no llegó y no se puede mandar.
 */
export function sobranteDeCentral(saldo: Numerico, stockMinimo: Numerico): Decimal {
  return maximoEntre(aDecimal(saldo).minus(aDecimal(stockMinimo)), CERO);
}

/**
 * Arma el plan de reposición de toda la empresa.
 *
 * Solo aparecen los insumos CON MÍNIMO CONFIGURADO y EN ALERTA (crítico o
 * bajo, con el mismo semáforo de la pantalla de stock). El orden: primero lo
 * crítico.
 *
 * Si hay varias sucursales que no son la central y les falta lo mismo, el
 * sobrante de la Central se reparte en el orden en que vienen (el que llama
 * las ordena por nombre). Con dos sucursales no hay reparto que hacer, pero
 * la función no puede asumirlo: el sistema se vende a otras panaderías.
 *
 * `centralId` null = la empresa no tiene central: todo se compra.
 */
export function planificarReposicion(
  situaciones: readonly SituacionInsumo[],
  centralId: string | null,
): PlanInsumo[] {
  // Cuánto le sobra a la Central de cada insumo; se va gastando al repartir.
  const sobrante = new Map<string, Decimal>();
  if (centralId !== null) {
    for (const s of situaciones) {
      if (s.sucursalId === centralId) {
        sobrante.set(s.insumoId, sobranteDeCentral(s.saldo, s.stockMinimo));
      }
    }
  }

  const planes: PlanInsumo[] = [];
  for (const s of situaciones) {
    // Sin mínimo configurado, el insumo no entra en la reposición. El mínimo
    // es lo que dice "avisame de este insumo": sin él, los 28 insumos de la
    // semilla aparecerían como "críticos, nada que comprar" el primer día y
    // la lista no serviría (lo encontraron los tests de esta función).
    if (aDecimal(s.stockMinimo).lessThanOrEqualTo(0)) continue;

    const estado = estadoDeStock(s.saldo, s.stockMinimo);
    if (estado === 'OK') continue;

    const saldo = aDecimal(s.saldo);
    const objetivo = s.stockMaximo === null ? aDecimal(s.stockMinimo) : aDecimal(s.stockMaximo);
    const faltante = maximoEntre(
      objetivo.minus(saldo).minus(aDecimal(s.yaPedido)).minus(aDecimal(s.enCamino)),
      CERO,
    );

    let desdeCentral = CERO;
    if (centralId !== null && s.sucursalId !== centralId) {
      const disponible = sobrante.get(s.insumoId) ?? CERO;
      desdeCentral = minimoEntre(faltante, disponible);
      sobrante.set(s.insumoId, disponible.minus(desdeCentral));
    }

    planes.push({
      sucursalId: s.sucursalId,
      insumoId: s.insumoId,
      estado,
      objetivo,
      faltante,
      desdeCentral,
      aComprar: faltante.minus(desdeCentral),
    });
  }

  return planes.sort((a, b) => (a.estado === b.estado ? 0 : a.estado === 'CRITICO' ? -1 : 1));
}

/**
 * Lleva una cantidad a BULTOS ENTEROS, para arriba.
 *
 *   faltan 60 kg, bolsa de 25 kg   →   3 bolsas = 75 kg
 *   faltan 50 kg, bolsa de 25 kg   →   2 bolsas = 50 kg  (justo, no 3)
 *
 * Sin presentación (factor 1, se compra suelto) también redondea a unidades
 * enteras de la unidad base: 2,3 kg → 3 kg. Si el insumo se compra por
 * gramos, la unidad base ya es chica y el redondeo no molesta.
 */
export function aBultosEnteros(
  cantidadBase: Numerico,
  factor: Numerico,
): { bultos: Decimal; cantidadBase: Decimal } {
  const cantidad = aDecimal(cantidadBase);
  const porBulto = aDecimal(factor);
  if (porBulto.lessThanOrEqualTo(0)) throw new Error('El factor tiene que ser positivo.');
  if (cantidad.lessThanOrEqualTo(0)) return { bultos: CERO, cantidadBase: CERO };

  const bultos = cantidad.dividedBy(porBulto).ceil();
  return { bultos, cantidadBase: bultos.times(porBulto) };
}
