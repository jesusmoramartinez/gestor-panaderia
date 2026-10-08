import { aDecimal, type Decimal, type Numerico } from './decimal.js';
import { type UnidadConversion, convertir, DimensionIncompatibleError } from './unidades.js';

/**
 * La lógica del kardex, en funciones PURAS.
 *
 * Igual que unidades.ts: sin base de datos, sin red, sin reloj. Entran datos,
 * sale un número o un booleano. Esa es la razón por la que el servicio de
 * stock —la parte peligrosa del sistema— se puede testear sin levantar nada.
 *
 * El concepto completo está en docs/aprendizaje/03-kardex-stock-calculado.md
 */

/**
 * Qué clase de hecho movió el stock. Tiene que coincidir con el enum
 * `TipoMovimiento` del schema de Prisma.
 *
 * En la Fase 6 se usan SALDO_INICIAL, CONSUMO, MERMA y REVERSA. Los otros
 * cuatro ya están porque el signo esperado de cada tipo es parte del contrato
 * y porque el CHECK de la base los nombra.
 */
export const TIPOS_MOVIMIENTO = [
  'SALDO_INICIAL',
  'COMPRA',
  'CONSUMO',
  'MERMA',
  'AJUSTE',
  'TRANSFERENCIA_SALIDA',
  'TRANSFERENCIA_ENTRADA',
  'REVERSA',
] as const;
export type TipoMovimiento = (typeof TIPOS_MOVIMIENTO)[number];

/** Qué signo admite cada tipo de movimiento. */
export type SentidoMovimiento = 'ENTRADA' | 'SALIDA' | 'AMBOS';

/**
 * EL INVARIANTE CENTRAL DEL KARDEX, en TypeScript.
 *
 * Es el mismo que el CHECK `movimiento_signo_segun_tipo` de la base. Está
 * escrito dos veces a propósito, y no es duplicación por descuido:
 *
 *   - acá, para poder rechazar el dato con un mensaje en español antes de
 *     tocar la base (un error de CHECK es ilegible para el usuario);
 *   - en la base, porque es la única garantía que sigue valiendo si alguien
 *     escribe en la tabla por fuera del servicio.
 *
 * Hay un test que recorre este objeto y verifica que los dos coincidan.
 *
 * AJUSTE y REVERSA admiten los dos signos por naturaleza: un conteo físico
 * puede dar de más o de menos, y una reversa va siempre en el sentido
 * contrario al movimiento que anula.
 */
export const SENTIDO_POR_TIPO: Record<TipoMovimiento, SentidoMovimiento> = {
  SALDO_INICIAL: 'ENTRADA',
  COMPRA: 'ENTRADA',
  TRANSFERENCIA_ENTRADA: 'ENTRADA',
  CONSUMO: 'SALIDA',
  MERMA: 'SALIDA',
  TRANSFERENCIA_SALIDA: 'SALIDA',
  AJUSTE: 'AMBOS',
  REVERSA: 'AMBOS',
};

/**
 * Los tipos que no se pueden registrar sin decir por qué.
 *
 * Una merma sin motivo es stock que desapareció sin explicación, y un ajuste
 * sin motivo es peor: alguien cambió el número y no se sabe en nombre de qué.
 * El consumo no lo necesita: el motivo es obvio (se usó para producir).
 */
export const TIPOS_CON_MOTIVO_OBLIGATORIO: readonly TipoMovimiento[] = ['MERMA', 'AJUSTE'];

export function requiereMotivo(tipo: TipoMovimiento): boolean {
  return TIPOS_CON_MOTIVO_OBLIGATORIO.includes(tipo);
}

export function esEntrada(tipo: TipoMovimiento): boolean {
  return SENTIDO_POR_TIPO[tipo] === 'ENTRADA';
}

export function esSalida(tipo: TipoMovimiento): boolean {
  return SENTIDO_POR_TIPO[tipo] === 'SALIDA';
}

/**
 * ¿Este signo es válido para este tipo?
 *
 * Nunca es válido el cero: un movimiento de cero no significa nada (ni entró
 * ni salió nada) y solo ensuciaría el historial.
 */
export function signoValido(tipo: TipoMovimiento, cantidadBase: Numerico): boolean {
  const cantidad = aDecimal(cantidadBase);
  if (cantidad.isZero()) return false;

  switch (SENTIDO_POR_TIPO[tipo]) {
    case 'ENTRADA':
      return cantidad.greaterThan(0);
    case 'SALIDA':
      return cantidad.lessThan(0);
    case 'AMBOS':
      return true;
  }
}

/**
 * Le pone a una cantidad el signo que le corresponde por su tipo.
 *
 * La persona tipea "30 kg de consumo", sin signo: pensar en signos es tarea
 * del sistema. Esta función es el único lugar donde se decide, así que no hay
 * forma de que un módulo se olvide de negar una salida.
 *
 * Para AJUSTE y REVERSA no alcanza con el tipo (van en los dos sentidos): el
 * signo tiene que venir decidido, y por eso lanza.
 */
export function conSignoDelTipo(tipo: TipoMovimiento, cantidadSinSigno: Numerico): Decimal {
  const cantidad = aDecimal(cantidadSinSigno);
  if (cantidad.lessThanOrEqualTo(0)) {
    throw new Error(
      `conSignoDelTipo espera una cantidad positiva y recibió ${cantidad.toString()}: ` +
        'el signo lo pone el tipo del movimiento, no quien carga.',
    );
  }

  switch (SENTIDO_POR_TIPO[tipo]) {
    case 'ENTRADA':
      return cantidad;
    case 'SALIDA':
      return cantidad.negated();
    case 'AMBOS':
      throw new Error(
        `El tipo ${tipo} va en los dos sentidos: su signo no se puede deducir del tipo.`,
      );
  }
}

/**
 * EL SALDO ES UNA SUMA. Esta función es todo el secreto del kardex.
 *
 * Se usa Decimal y no `number` por una razón que se puede medir: sumar 0,1
 * mil veces con números de JavaScript da 99,9999999999986, y un saldo de stock
 * que arrastra ese error deja de cuadrar con la realidad. Hay un test que lo
 * muestra en docs/aprendizaje/04 y en decimal.test.ts.
 */
export function calcularSaldo(movimientos: readonly { cantidadBase: Numerico }[]): Decimal {
  return movimientos.reduce(
    (saldo, movimiento) => saldo.plus(aDecimal(movimiento.cantidadBase)),
    aDecimal('0'),
  );
}

/**
 * El FACTOR que se guarda como snapshot en el movimiento.
 *
 * `convertir` devuelve la cantidad convertida; esto devuelve el número por el
 * que se multiplicó, para poder guardarlo. Son dos cosas distintas y las dos
 * hacen falta: la cantidad es el dato de hoy, el factor es lo que permite
 * reconstruir la cuenta en cinco años, aunque alguien haya corregido la unidad
 * en el medio.
 *
 *   factor(g → kg) = 0,001 ÷ 1 = 0,001     → 2000 g × 0,001 = 2 kg
 *   factor(kg → g) = 1 ÷ 0,001 = 1000      → 2,5 kg × 1000  = 2500 g
 *
 * Y vale siempre esta igualdad, que el motor verifica antes de insertar:
 *
 *   cantidadBase = cantidadIngresada × factor
 */
export function factorDeConversion(desde: UnidadConversion, hacia: UnidadConversion): Decimal {
  if (desde.dimension !== hacia.dimension) {
    throw new DimensionIncompatibleError(desde, hacia);
  }
  // Se reusa convertir() en lugar de repetir la división: el factor es,
  // exactamente, "a cuánto equivale 1 de la unidad de origen".
  return convertir('1', desde, hacia);
}

/**
 * El semáforo de la pantalla de stock.
 *
 *   CRITICO — no hay nada, o está en negativo: hay que comprar hoy.
 *   BAJO    — hay, pero por debajo del mínimo de esa sucursal.
 *   OK      — alcanza.
 *
 * Un mínimo en cero significa "no me avises de este insumo", así que nunca da
 * BAJO: sin esa salvedad, los 28 insumos del catálogo aparecerían en rojo el
 * día uno, antes de que nadie configure nada, y el semáforo no serviría.
 */
export const ESTADOS_STOCK = ['CRITICO', 'BAJO', 'OK'] as const;
export type EstadoStock = (typeof ESTADOS_STOCK)[number];

export function estadoDeStock(saldo: Numerico, stockMinimo: Numerico): EstadoStock {
  const actual = aDecimal(saldo);
  const minimo = aDecimal(stockMinimo);

  if (actual.lessThanOrEqualTo(0)) return 'CRITICO';
  if (minimo.greaterThan(0) && actual.lessThan(minimo)) return 'BAJO';
  return 'OK';
}

/**
 * ¿Esta fecha está en el futuro?
 *
 * Un movimiento con fecha futura rompe cualquier pregunta del tipo "¿cuánto
 * había el día 5?", y además aparecería primero en el historial para siempre.
 *
 * El "ahora" se recibe como parámetro en lugar de llamar a `new Date()`
 * adentro: así la función sigue siendo pura y el test no depende del reloj.
 * La tolerancia existe porque el reloj de la tablet del depósito puede estar
 * unos minutos adelantado, y eso no es un error de carga.
 */
export const TOLERANCIA_FECHA_FUTURA_MS = 5 * 60 * 1000;

export function esFechaFutura(
  fecha: Date,
  ahora: Date,
  toleranciaMs = TOLERANCIA_FECHA_FUTURA_MS,
): boolean {
  return fecha.getTime() > ahora.getTime() + toleranciaMs;
}
