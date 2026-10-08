import { aDecimal, type Decimal, type Numerico } from './decimal.js';

/**
 * La lógica de las transferencias, en funciones PURAS (sin base ni reloj).
 * El concepto completo está en docs/aprendizaje/17-fase-9-transferencias.md
 */

export const ESTADOS_TRANSFERENCIA = ['ENVIADA', 'RECIBIDA', 'ANULADA'] as const;
export type EstadoTransferencia = (typeof ESTADOS_TRANSFERENCIA)[number];

export const ACCIONES_TRANSFERENCIA = ['recibir', 'anular'] as const;
export type AccionTransferencia = (typeof ACCIONES_TRANSFERENCIA)[number];

/**
 * La máquina de estados más chica del sistema: solo lo que está EN TRÁNSITO
 * se puede recibir o anular.
 *
 * Una transferencia RECIBIDA no se anula: la mercadería ya está en el otro
 * depósito y ya se pudo haber usado. Si se mandó de más, se corrige con otra
 * transferencia en sentido contrario, que deja los dos hechos registrados.
 */
const ACCIONES_POR_ESTADO: Record<EstadoTransferencia, readonly AccionTransferencia[]> = {
  ENVIADA: ['recibir', 'anular'],
  RECIBIDA: [],
  ANULADA: [],
};

export function accionesDeTransferencia(
  estado: EstadoTransferencia,
): readonly AccionTransferencia[] {
  return ACCIONES_POR_ESTADO[estado];
}

/** Lo que se registra en el DESTINO por una línea, al recibir. */
export type MovimientoDeRecepcion = {
  tipo: 'TRANSFERENCIA_ENTRADA' | 'MERMA';
  /** Sin signo: el signo lo pone el tipo. */
  cantidad: Decimal;
};

/**
 * QUÉ MOVIMIENTOS GENERA RECIBIR UNA LÍNEA. Decisión del cliente al arrancar
 * la Fase 9: la diferencia es una MERMA en el destino.
 *
 *   salieron 20 kg, llegaron 18   →   ENTRADA +20   y   MERMA −2
 *   salieron 20 kg, llegaron 20   →   ENTRADA +20
 *   salieron 20 kg, llegaron 0    →   ENTRADA +20   y   MERMA −20
 *
 * ¿Por qué entra lo ENVIADO y no lo recibido? Para que cada kilo quede
 * explicado por un movimiento con nombre. Si entraran solo 18, la empresa
 * tendría 2 kg menos que antes sin ningún movimiento que diga dónde fueron:
 * el origen dice "salieron 20", el destino "entraron 18", y los 2 del medio
 * no estarían en ningún lado. Con la merma, la suma de las dos sucursales
 * baja exactamente lo que dice la merma, y aparece en los informes con su
 * motivo ("Diferencia en transferencia").
 *
 * ¿Por qué NO una merma en el origen (como decía el primer plan)? Porque el
 * origen ya descontó los 20 al enviar: una merma ahí lo haría bajar 22.
 *
 * Lanza si lo recibido es negativo o mayor que lo enviado: recibir MÁS de lo
 * que salió no tiene sentido físico (sería un error de carga).
 */
export function movimientosAlRecibir(
  enviada: Numerico,
  recibida: Numerico,
): MovimientoDeRecepcion[] {
  const salio = aDecimal(enviada);
  const llego = aDecimal(recibida);
  if (salio.lessThanOrEqualTo(0)) throw new Error('Lo enviado tiene que ser positivo.');
  if (llego.lessThan(0)) throw new Error('Lo recibido no puede ser negativo.');
  if (llego.greaterThan(salio)) {
    throw new Error(
      `Se recibieron ${llego.toString()} y salieron ${salio.toString()}: no puede llegar más de lo que salió.`,
    );
  }

  const movimientos: MovimientoDeRecepcion[] = [{ tipo: 'TRANSFERENCIA_ENTRADA', cantidad: salio }];
  const diferencia = salio.minus(llego);
  if (diferencia.greaterThan(0)) movimientos.push({ tipo: 'MERMA', cantidad: diferencia });
  return movimientos;
}

/** Cuánto se perdió en el camino. Cero si llegó todo. */
export function diferenciaDeTransferencia(enviada: Numerico, recibida: Numerico): Decimal {
  return aDecimal(enviada).minus(aDecimal(recibida));
}
