/**
 * LA CUENTA DEL ACOPIO (Etapa 2): qué me deben y cuánto pagué.
 *
 * Marcelo paga por adelantado ("100 bolsas de harina") y el proveedor le
 * entrega por tandas ("20 esta semana"). De cada compra salen dos cuentas
 * que se mueven por separado:
 *
 *   MERCADERÍA                       PLATA
 *     comprado   100 bolsas            total     $100X
 *     entregado   40                   pagado    $100X
 *     ME DEBEN    60                   SALDO     $0  → pagada
 *
 * Todo lo de este archivo son funciones PURAS: reciben números y devuelven
 * números, sin base de datos. Por eso se prueban solas (acopio.test.ts) y las
 * usan igual la API y la pantalla.
 *
 * Una regla del cliente (C-22) hace que las cuentas sean exactas: CADA COMPRA
 * MANTIENE SU PRECIO. Lo que me deben en plata es lo pendiente × el precio de
 * ESA compra, no un precio de hoy ni un promedio.
 */
import { type EstadoOrden, pendienteDe } from './compras.js';
import { aDecimal, Decimal, type Numerico, redondearCantidad, redondearDinero } from './decimal.js';

/** Un renglón de una compra, como lo guarda la base. */
export type RenglonAcopio = {
  /** En presentaciones: 100 (bolsas). */
  cantidad: Numerico;
  /** Lo mismo en unidad base: 2500 (kg). */
  cantidadBase: Numerico;
  /** Lo que llegó, en unidad base, sumando las entregas CONFIRMADAS. */
  recibidoBase: Numerico;
  /** Cuánta unidad base trae una presentación: 25. */
  factor: Numerico;
  /** Precio de UNA presentación. Null = todavía no se cargó. */
  precioUnitario: Numerico | null;
};

export type CuentaRenglon = {
  /** Lo que llegó, en presentaciones: 40 bolsas. */
  recibido: Decimal;
  /** Lo que me deben, en presentaciones: 60 bolsas. */
  pendiente: Decimal;
  /** Lo que me deben, en unidad base: 1500 kg. */
  pendienteBase: Decimal;
  /** Lo que vale todo el renglón: 100 × precio. Null sin precio. */
  valorTotal: Decimal | null;
  /** Lo que vale lo que ya llegó. */
  valorRecibido: Decimal | null;
  /** Lo que vale lo que me deben: 60 × precio. */
  valorPendiente: Decimal | null;
};

/**
 * Las cuentas de un renglón.
 *
 * Las cantidades en presentaciones salen de dividir la unidad base por el
 * factor CONGELADO en la compra (no el de hoy): "llegaron 40 de las bolsas
 * que pedí" se mide con la misma vara con que se pidió.
 */
export function cuentaDeRenglon(renglon: RenglonAcopio): CuentaRenglon {
  const factor = aDecimal(renglon.factor);
  const pendienteBase = pendienteDe({
    pedido: renglon.cantidadBase,
    recibido: renglon.recibidoBase,
  });
  const pendiente = redondearCantidad(pendienteBase.dividedBy(factor));
  const recibido = redondearCantidad(aDecimal(renglon.recibidoBase).dividedBy(factor));

  if (renglon.precioUnitario === null) {
    return {
      recibido,
      pendiente,
      pendienteBase,
      valorTotal: null,
      valorRecibido: null,
      valorPendiente: null,
    };
  }
  const precio = aDecimal(renglon.precioUnitario);
  return {
    recibido,
    pendiente,
    pendienteBase,
    valorTotal: redondearDinero(aDecimal(renglon.cantidad).times(precio)),
    valorRecibido: redondearDinero(recibido.times(precio)),
    valorPendiente: redondearDinero(pendiente.times(precio)),
  };
}

// ===========================================================================
// Pagos
// ===========================================================================

export const MEDIOS_PAGO = ['EFECTIVO', 'TRANSFERENCIA', 'MERCADO_PAGO'] as const;
export type MedioPago = (typeof MEDIOS_PAGO)[number];

export const ESTADOS_PAGO = ['SIN_PAGO', 'PAGO_PARCIAL', 'PAGADA'] as const;

/**
 * En qué estados de la compra se puede registrar un pago: desde que se pidió.
 * Un BORRADOR todavía no es una compra, y una CANCELADA ya no lo es. Una
 * CERRADA con faltante sí: puede quedar un saldo por pagar de lo que llegó.
 */
export function sePuedePagar(estado: EstadoOrden): boolean {
  return (
    estado === 'PEDIDA' || estado === 'PARCIAL' || estado === 'RECIBIDA' || estado === 'CERRADA'
  );
}
export type EstadoPago = (typeof ESTADOS_PAGO)[number];

export type CuentaCompra = {
  /**
   * Lo que vale la compra entera. Null si algún renglón no tiene precio:
   * un total sin algunos renglones no es el total, y pagar contra él
   * dejaría la compra "pagada" sin estarlo.
   */
  total: Decimal | null;
  /** Suma de los renglones CON precio (lo que se puede saber). */
  valorRecibido: Decimal;
  valorPendiente: Decimal;
  /** Renglones sin precio: la pantalla avisa que falta cargarlo. */
  renglonesSinPrecio: number;
  pagado: Decimal;
  /** Lo que falta pagar. Null sin total. Nunca negativo. */
  saldo: Decimal | null;
  estadoPago: EstadoPago;
  /**
   * PLATA ADELANTADA SIN ENTREGAR: lo pagado que todavía no se convirtió en
   * mercadería. Es plata de Marcelo que hoy tiene el proveedor.
   *
   * Pagó $100X y llegó por $40X → el proveedor tiene $60X suyos. Si pagó
   * solo $30X y llegó por $40X, el adelanto es 0 (no se puede deber menos que
   * nada: ahí el que debe es él, y eso lo dice el saldo).
   *
   * En una compra CERRADA con faltante o CANCELADA, esto mismo es la PLATA A
   * FAVOR: lo que el proveedor le tiene que devolver, porque no va a entregar.
   */
  adelantadoSinEntregar: Decimal;
};

/** El estado de pago sale de los números: nadie lo elige. */
export function estadoDePago(total: Decimal | null, pagado: Decimal): EstadoPago {
  if (pagado.isZero()) return 'SIN_PAGO';
  if (total !== null && pagado.greaterThanOrEqualTo(total)) return 'PAGADA';
  return 'PAGO_PARCIAL';
}

/** Las cuentas de una compra entera, con lo que se pagó (pagos no anulados). */
export function cuentaDeCompra(
  renglones: readonly RenglonAcopio[],
  pagado: Numerico,
): CuentaCompra {
  const cuentas = renglones.map(cuentaDeRenglon);
  const cero = aDecimal('0');
  const sumar = (elegir: (cuenta: CuentaRenglon) => Decimal | null) =>
    cuentas.reduce((suma, cuenta) => suma.plus(elegir(cuenta) ?? cero), cero);

  const renglonesSinPrecio = cuentas.filter((cuenta) => cuenta.valorTotal === null).length;
  const total =
    renglonesSinPrecio > 0 ? null : redondearDinero(sumar((cuenta) => cuenta.valorTotal));
  const valorRecibido = redondearDinero(sumar((cuenta) => cuenta.valorRecibido));
  const pagadoDecimal = redondearDinero(pagado);
  const saldo = total === null ? null : Decimal.max(total.minus(pagadoDecimal), cero);
  const adelantado = pagadoDecimal.minus(valorRecibido);

  return {
    total,
    valorRecibido,
    valorPendiente: redondearDinero(sumar((cuenta) => cuenta.valorPendiente)),
    renglonesSinPrecio,
    pagado: pagadoDecimal,
    saldo,
    estadoPago: estadoDePago(total, pagadoDecimal),
    adelantadoSinEntregar: adelantado.greaterThan(0) ? adelantado : cero,
  };
}

/**
 * ¿Se puede registrar este pago?
 *
 * Dos reglas (Etapa 2):
 *   - sin el precio de todos los renglones no hay total, y sin total no se
 *     sabe si se está pagando de más;
 *   - no se paga más que el total. Marcelo paga por adelantado, y un pago de
 *     más casi siempre es un cero de más al tipear.
 */
export type ValidacionPago =
  | { valido: true }
  | { valido: false; motivo: 'SIN_TOTAL' }
  | { valido: false; motivo: 'EXCEDE_TOTAL'; saldo: Decimal };

export function validarPago(cuenta: CuentaCompra, monto: Numerico): ValidacionPago {
  if (cuenta.total === null || cuenta.saldo === null) return { valido: false, motivo: 'SIN_TOTAL' };
  if (aDecimal(monto).greaterThan(cuenta.saldo)) {
    return { valido: false, motivo: 'EXCEDE_TOTAL', saldo: cuenta.saldo };
  }
  return { valido: true };
}

// ===========================================================================
// Fechas
// ===========================================================================

/**
 * Días de calendario entre dos días 'AAAA-MM-DD' ("hace cuánto pagué").
 *
 * Con días y no con instantes: la compra del lunes a las 23 h y la del martes
 * a las 8 h están a un día, aunque entre una y otra haya 9 horas. Se calcula
 * sobre medianoche UTC de cada día, así el cambio de horario no corre nada.
 */
export function diasEntre(desde: string, hasta: string): number {
  const MS_POR_DIA = 86_400_000;
  return Math.round(
    (Date.parse(`${hasta}T00:00:00Z`) - Date.parse(`${desde}T00:00:00Z`)) / MS_POR_DIA,
  );
}
