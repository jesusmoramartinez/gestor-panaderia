import { aDecimal, type Decimal, type Numerico } from './decimal.js';

/**
 * Conversión de unidades de medida.
 *
 * Este módulo es la pieza de la que depende TODO el stock: cada movimiento
 * pasa por acá antes de guardarse. Por eso es deliberadamente aburrido:
 * funciones PURAS, sin base de datos, sin red y sin reloj. Entran datos, sale
 * un número. Es el código más fácil de testear del proyecto y el que más
 * tests tiene.
 *
 * El concepto completo (unidad base, dimensiones, presentaciones, la regla del
 * snapshot) está en docs/aprendizaje/05-unidades-y-conversiones.md
 */

/**
 * Familia de unidades. Solo se convierte DENTRO de una misma dimensión.
 *
 * No existe conversión entre PESO y VOLUMEN porque dependería de la densidad
 * del material: 1 litro de agua pesa 1 kg, 1 de aceite ~0,92 kg y 1 de harina
 * suelta ~0,6 kg. Sin la densidad, la cuenta no existe.
 */
export const DIMENSIONES = ['PESO', 'VOLUMEN', 'UNIDAD'] as const;
export type Dimension = (typeof DIMENSIONES)[number];

/**
 * Lo mínimo que la conversión necesita saber de una unidad.
 *
 * Es un tipo ESTRUCTURAL, no la fila de la base: así este módulo no sabe nada
 * de Prisma y puede correr también en el navegador. Las filas de la base
 * encajan porque tienen estos campos.
 */
export type UnidadConversion = {
  codigo: string;
  dimension: Dimension;
  /** Cuánto vale 1 de esta unidad expresado en la unidad base de su dimensión. */
  factorABase: Numerico;
};

/** Se intentó convertir entre dimensiones distintas (kg → litros). */
export class DimensionIncompatibleError extends Error {
  override readonly name = 'DimensionIncompatibleError';
  readonly codigo = 'DIMENSION_INCOMPATIBLE';

  constructor(
    readonly desde: UnidadConversion,
    readonly hacia: UnidadConversion,
  ) {
    super(
      `No se puede convertir de ${desde.codigo} (${desde.dimension}) a ` +
        `${hacia.codigo} (${hacia.dimension}): son dimensiones distintas.`,
    );
  }
}

/** Una unidad tiene un factor que no sirve (cero o negativo). */
export class FactorInvalidoError extends Error {
  override readonly name = 'FactorInvalidoError';
  readonly codigo = 'FACTOR_INVALIDO';

  constructor(readonly unidad: UnidadConversion) {
    super(
      `La unidad ${unidad.codigo} tiene un factor inválido ` +
        `(${aDecimal(unidad.factorABase).toString()}): tiene que ser mayor que cero.`,
    );
  }
}

/**
 * Convierte una cantidad de una unidad a otra de la MISMA dimensión.
 *
 * La cuenta siempre pasa por la unidad base de la dimensión:
 *
 *   cantidad_destino = cantidad_origen × factor_origen ÷ factor_destino
 *
 *   2500 g → kg :  2500 × 0,001 ÷ 1      = 2,5
 *   2,5 kg → g  :  2,5  × 1     ÷ 0,001  = 2500
 *
 * NO redondea: devuelve el valor exacto. Redondear es una decisión de quien
 * guarda, no de quien calcula, y se hace con redondearCantidad().
 *
 * Lanza en lugar de devolver null: si las dimensiones no coinciden, el insumo
 * está mal configurado y hay que arreglarlo, no estimar un número. Un error
 * avisa; un número inventado ensucia el stock y nadie se da cuenta.
 */
export function convertir(
  cantidad: Numerico,
  desde: UnidadConversion,
  hacia: UnidadConversion,
): Decimal {
  if (desde.dimension !== hacia.dimension) {
    throw new DimensionIncompatibleError(desde, hacia);
  }

  const factorDesde = aDecimal(desde.factorABase);
  const factorHacia = aDecimal(hacia.factorABase);

  if (factorDesde.lessThanOrEqualTo(0)) throw new FactorInvalidoError(desde);
  if (factorHacia.lessThanOrEqualTo(0)) throw new FactorInvalidoError(hacia);

  // Atajo cuando es la misma unidad: evita una multiplicación y una división
  // que, aunque exactas, no hacen falta.
  if (desde.codigo === hacia.codigo) return aDecimal(cantidad);

  return aDecimal(cantidad).times(factorDesde).dividedBy(factorHacia);
}

/**
 * Convierte a la unidad base de la dimensión.
 *
 * Es el caso que más se usa en el sistema: la persona carga "4 bolsas" o
 * "2000 g" y el stock se guarda siempre en la unidad base del insumo.
 */
export function convertirABase(cantidad: Numerico, desde: UnidadConversion): Decimal {
  const factor = aDecimal(desde.factorABase);
  if (factor.lessThanOrEqualTo(0)) throw new FactorInvalidoError(desde);
  return aDecimal(cantidad).times(factor);
}

/** ¿Se puede convertir entre estas dos unidades? Sin lanzar. */
export function sonCompatibles(a: UnidadConversion, b: UnidadConversion): boolean {
  return a.dimension === b.dimension;
}
