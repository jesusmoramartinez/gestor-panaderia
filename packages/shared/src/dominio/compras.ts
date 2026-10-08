import { aDecimal, type Decimal, type Numerico, redondearDinero } from './decimal.js';
import type { TipoMovimiento } from './stock.js';

/**
 * La lógica de las compras, en funciones PURAS: el costo promedio ponderado,
 * la máquina de estados de la orden de compra y la comparación de precios.
 *
 * Igual que stock.ts: sin base de datos, sin red, sin reloj. Por eso la parte
 * más delicada de la fase —la cuenta de la plata— se testea sin levantar nada.
 * El concepto completo está en docs/aprendizaje/16-fase-8-compras-y-costo-promedio.md
 */

// ===========================================================================
// Costo promedio ponderado (CPP)
// ===========================================================================

/**
 * Lo mínimo que hace falta saber de un movimiento para valuar el stock.
 *
 * Es un subconjunto de `movimiento_stock`. Pedir solo esto (y no la fila
 * entera) hace que la función se pueda probar con tres líneas de datos.
 */
export type MovimientoParaCosto = {
  id: string;
  tipo: TipoMovimiento;
  /** Con signo, en la unidad base del insumo. */
  cantidadBase: Numerico;
  /** Solo importa en las COMPRAS: lo que costó cada unidad base que entró. */
  costoUnitario: Numerico | null;
  /** Si es una REVERSA, a qué movimiento anula. */
  revierteAId: string | null;
};

/**
 * RECONSTRUYE el costo promedio de un insumo recorriendo TODOS sus movimientos.
 *
 * LA FÓRMULA, con los números de PLAN.md 3.7:
 *
 *   Hay 100 kg a $1.000/kg       → valor en depósito = $100.000
 *   Llegan 50 kg a $1.300/kg     → valor que entra   =  $65.000
 *   nuevo promedio = (100.000 + 65.000) / (100 + 50) = $1.100/kg
 *
 * LAS CUATRO REGLAS (cada una tiene su test):
 *
 *   1. Solo las COMPRAS mueven el promedio. Un consumo, una merma o un ajuste
 *      cambian CUÁNTO hay, pero no lo que costó: si había 100 kg a $1.000 y se
 *      usan 40, los 60 que quedan siguen costando $1.000 cada uno.
 *   2. Stock sin costo conocido (el saldo inicial se cargó sin precio) toma el
 *      precio de la primera compra. Decisión del cliente.
 *   3. Si no había stock (o estaba en negativo, forzado), el precio de la
 *      compra nueva manda: promediar contra una cantidad negativa da números
 *      sin sentido, incluso costos negativos.
 *   4. Una compra ANULADA y su reversa se saltean las DOS, como si nunca
 *      hubieran existido. Es lo que hace que anular una recepción devuelva el
 *      promedio exactamente al valor anterior.
 *
 * POR QUÉ RECONSTRUIR Y NO "DESHACER" CON UNA RESTA
 *
 * El promedio no se puede deshacer con la fórmula al revés sin perder
 * precisión (cada paso redondea), y además, si en el medio hubo consumos, la
 * cantidad contra la que se promedió ya no es la misma. Recorrer los
 * movimientos desde el principio da SIEMPRE el número correcto, y la misma
 * función sirve de herramienta de reparación si algún día el valor guardado
 * se corrompe. Es la misma idea que el stock: un valor derivado necesita una
 * función que lo reconstruya desde los hechos.
 *
 * Los movimientos tienen que venir ORDENADOS por fecha del hecho (el orden
 * importa: una compra antes o después de un consumo pondera distinto).
 *
 * Devuelve `null` si nunca hubo una compra: el costo es desconocido, que es
 * distinto de "cuesta cero".
 */
export function calcularCostoPromedio(movimientos: readonly MovimientoParaCosto[]): Decimal | null {
  // Regla 4: las compras anuladas, y las reversas que las anulan.
  const tipoPorId = new Map(movimientos.map((m) => [m.id, m.tipo]));
  const comprasAnuladas = new Set(
    movimientos
      .filter((m) => m.tipo === 'REVERSA' && m.revierteAId !== null)
      .map((m) => m.revierteAId)
      .filter((id): id is string => id !== null && tipoPorId.get(id) === 'COMPRA'),
  );

  let cantidad = aDecimal('0');
  let promedio: Decimal | null = null;

  for (const movimiento of movimientos) {
    if (comprasAnuladas.has(movimiento.id)) continue;
    if (
      movimiento.tipo === 'REVERSA' &&
      movimiento.revierteAId !== null &&
      comprasAnuladas.has(movimiento.revierteAId)
    ) {
      continue;
    }

    const q = aDecimal(movimiento.cantidadBase);

    if (movimiento.tipo === 'COMPRA') {
      if (movimiento.costoUnitario === null) {
        // Una compra sin costo es un bug (la base lo impide con un CHECK):
        // mejor fallar que promediar con un cero inventado.
        throw new Error(`La compra ${movimiento.id} no tiene costo unitario.`);
      }
      const costo = aDecimal(movimiento.costoUnitario);

      // Reglas 2 y 3: sin costo conocido o sin stock, el precio nuevo manda.
      promedio =
        promedio === null || cantidad.lessThanOrEqualTo(0)
          ? costo
          : cantidad.times(promedio).plus(q.times(costo)).dividedBy(cantidad.plus(q));
    }

    // Regla 1: todo lo demás solo cambia cuánto hay.
    cantidad = cantidad.plus(q);
  }

  // Se redondea UNA vez, al final, a la escala con que se guarda. Redondear en
  // cada paso acumularía error en un insumo con cientos de compras.
  return promedio === null ? null : redondearDinero(promedio);
}

/**
 * El costo de UNA unidad base a partir del precio de una presentación.
 *
 *   bolsa de 25 kg a $25.000  →  $25.000 / 25 = $1.000 por kg
 *
 * Es el número que se guarda en el movimiento: el kardex está en unidad base,
 * así que el costo también tiene que estarlo.
 */
export function costoPorUnidadBase(precioPresentacion: Numerico, factor: Numerico): Decimal {
  const divisor = aDecimal(factor);
  if (divisor.lessThanOrEqualTo(0)) {
    throw new Error(
      `El factor de una presentación tiene que ser positivo (${divisor.toString()}).`,
    );
  }
  return redondearDinero(aDecimal(precioPresentacion).dividedBy(divisor));
}

// ===========================================================================
// La orden de compra: una máquina de estados
// ===========================================================================

/**
 * Los estados de una orden de compra.
 *
 *   BORRADOR   la está armando el dueño; todavía no se le pidió al proveedor
 *   PEDIDA     se le pidió; no llegó nada
 *   PARCIAL    llegó una parte; el resto está pendiente
 *   RECIBIDA   llegó todo
 *   CERRADA    llegó una parte y el resto NO va a llegar (cerrada con faltante)
 *   CANCELADA  no se compró nada
 *
 * PEDIDA, PARCIAL y RECIBIDA no se eligen: se CALCULAN a partir de lo
 * recibido (ver `estadoSegunRecibido`). Los otros tres son decisiones de una
 * persona.
 */
export const ESTADOS_ORDEN = [
  'BORRADOR',
  'PEDIDA',
  'PARCIAL',
  'RECIBIDA',
  'CERRADA',
  'CANCELADA',
] as const;
export type EstadoOrden = (typeof ESTADOS_ORDEN)[number];

/**
 * Las acciones que una persona puede hacer sobre una orden, y desde qué
 * estados.
 *
 * Una MÁQUINA DE ESTADOS es exactamente esto: una lista cerrada de estados y,
 * para cada uno, qué se puede hacer. Lo que no está en la tabla no se puede, y
 * no hace falta un `if` desparramado en cada pantalla para recordarlo.
 *
 *   - editar:    solo mientras no llegó nada (después, lo pedido es historia)
 *   - pedir:     el borrador pasa a pedido
 *   - recibir:   solo lo que ya se pidió y todavía tiene pendiente
 *   - cancelar:  solo si no llegó nada; si llegó algo, es "cerrar"
 *   - cerrar:    "lo que falta no va a llegar"; solo si llegó una parte
 */
export const ACCIONES_ORDEN = ['editar', 'pedir', 'recibir', 'cancelar', 'cerrar'] as const;
export type AccionOrden = (typeof ACCIONES_ORDEN)[number];

const ACCIONES_POR_ESTADO: Record<EstadoOrden, readonly AccionOrden[]> = {
  BORRADOR: ['editar', 'pedir', 'cancelar'],
  PEDIDA: ['editar', 'recibir', 'cancelar'],
  PARCIAL: ['recibir', 'cerrar'],
  RECIBIDA: [],
  CERRADA: [],
  CANCELADA: [],
};

export function puedeHacer(estado: EstadoOrden, accion: AccionOrden): boolean {
  return ACCIONES_POR_ESTADO[estado].includes(accion);
}

export function accionesPosibles(estado: EstadoOrden): readonly AccionOrden[] {
  return ACCIONES_POR_ESTADO[estado];
}

/** Lo pedido y lo recibido de una línea, en unidad base. */
export type AvanceLinea = { pedido: Numerico; recibido: Numerico };

/** Lo que falta recibir. Nunca negativo: si llegó de más, no falta nada. */
export function pendienteDe(linea: AvanceLinea): Decimal {
  const falta = aDecimal(linea.pedido).minus(aDecimal(linea.recibido));
  return falta.greaterThan(0) ? falta : aDecimal('0');
}

/**
 * El estado de una orden que ya se pidió, según lo que llegó.
 *
 * Se llama después de cada recepción y de cada anulación: anular la única
 * recepción de una orden RECIBIDA la devuelve a PEDIDA, sin que nadie tenga
 * que acordarse de "reabrirla".
 */
export function estadoSegunRecibido(
  lineas: readonly AvanceLinea[],
): 'PEDIDA' | 'PARCIAL' | 'RECIBIDA' {
  const algoLlego = lineas.some((linea) => aDecimal(linea.recibido).greaterThan(0));
  if (!algoLlego) return 'PEDIDA';
  const faltaAlgo = lineas.some((linea) => pendienteDe(linea).greaterThan(0));
  return faltaAlgo ? 'PARCIAL' : 'RECIBIDA';
}

/**
 * El estado nuevo de una orden después de recibir o de anular una recepción.
 *
 * Los estados que decidió una persona se respetan: si el dueño CERRÓ la orden
 * con faltante y después se anula una de sus recepciones, falta más, pero la
 * orden sigue cerrada (ya dijo que lo que falta no va a llegar).
 */
export function recalcularEstadoOrden(
  estadoActual: EstadoOrden,
  lineas: readonly AvanceLinea[],
): EstadoOrden {
  if (estadoActual === 'BORRADOR' || estadoActual === 'CERRADA' || estadoActual === 'CANCELADA') {
    return estadoActual;
  }
  return estadoSegunRecibido(lineas);
}

/**
 * ¿La entrega está atrasada? (pedido C-8 del cliente)
 *
 * Solo puede estar atrasado lo que todavía se espera: una orden PEDIDA o
 * PARCIAL cuya fecha estimada ya pasó. Las fechas son días de calendario en
 * formato 'AAAA-MM-DD', y ese formato tiene una propiedad muy útil: ordenarlo
 * como texto es lo mismo que ordenarlo como fecha.
 *
 * `hoy` se recibe como parámetro (y en hora de Argentina): la función sigue
 * siendo pura y el test no depende del reloj.
 */
export function estaAtrasada(
  estado: EstadoOrden,
  fechaEntregaEstimada: string | null,
  hoy: string,
): boolean {
  if (fechaEntregaEstimada === null) return false;
  if (estado !== 'PEDIDA' && estado !== 'PARCIAL') return false;
  return fechaEntregaEstimada < hoy;
}

// ===========================================================================
// Comparación de precios entre proveedores (pedido C-6 del cliente)
// ===========================================================================

export type ComparacionPrecio = 'MAS_BARATO' | 'MAS_CARO' | null;

/**
 * Marca cuál proveedor de un mismo insumo sale más barato y cuál más caro.
 *
 * Se compara el costo POR UNIDAD BASE, no el precio de lista: una bolsa de
 * 50 kg a $39.500 parece más cara que una de 25 kg a $25.000, pero el kilo
 * sale $790 contra $1.000.
 *
 * Recibe los costos en el mismo orden que los proveedores y devuelve una
 * marca por cada uno. Sin precio no hay comparación (null). Con menos de dos
 * precios tampoco: "el más barato de uno" no le dice nada a nadie. Y si todos
 * cuestan lo mismo, nadie es más barato que nadie.
 */
export function compararCostos(costos: readonly (Numerico | null)[]): ComparacionPrecio[] {
  const conPrecio = costos.filter((costo): costo is Numerico => costo !== null).map(aDecimal);
  if (conPrecio.length < 2) return costos.map(() => null);

  const minimo = conPrecio.reduce((a, b) => (b.lessThan(a) ? b : a));
  const maximo = conPrecio.reduce((a, b) => (b.greaterThan(a) ? b : a));
  if (minimo.equals(maximo)) return costos.map(() => null);

  return costos.map((costo) => {
    if (costo === null) return null;
    const valor = aDecimal(costo);
    if (valor.equals(minimo)) return 'MAS_BARATO';
    if (valor.equals(maximo)) return 'MAS_CARO';
    return null;
  });
}
