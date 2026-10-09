/**
 * Errores de la aplicación.
 *
 * Un AppError es un error ESPERADO y parte del diseño: "no tenés permiso",
 * "no hay stock suficiente". Lleva tres cosas:
 *   - codigo:  estable y en mayúsculas, para que el frontend pueda reaccionar
 *              sin leer el texto (los textos cambian, los códigos no);
 *   - mensaje: en español, pensado para que lo lea una persona;
 *   - status:  el código HTTP que corresponde.
 *
 * Cualquier otro error (un bug, la base caída) NO es un AppError, y el
 * middleware central lo convierte en un 500 genérico sin filtrar detalles.
 */
export class AppError extends Error {
  override readonly name = 'AppError';

  constructor(
    readonly codigo: string,
    readonly mensaje: string,
    readonly status: number,
    readonly detalles?: unknown,
  ) {
    super(mensaje);
  }
}

/**
 * Los errores que ya sabemos que existen, en un solo lugar.
 * Tenerlos acá evita que el mismo problema se reporte con tres textos
 * distintos según el módulo.
 */
export const errores = {
  noAutenticado: () =>
    new AppError('NO_AUTENTICADO', 'Tenés que iniciar sesión para hacer esto.', 401),

  /**
   * Un único error para "el email no existe" y "la contraseña está mal".
   * A propósito: si dijéramos cuál de los dos falló, cualquiera podría
   * averiguar qué emails están registrados en el sistema.
   */
  credencialesInvalidas: () =>
    new AppError('CREDENCIALES_INVALIDAS', 'Email o contraseña incorrectos.', 401),

  demasiadosIntentos: (esperarSegundos: number) =>
    new AppError(
      'DEMASIADOS_INTENTOS',
      `Demasiados intentos fallidos. Probá de nuevo en ${String(esperarSegundos)} segundos.`,
      429,
      { esperarSegundos },
    ),

  /** El límite GENERAL de pedidos por IP (no el del login). */
  demasiadosPedidos: (esperarSegundos: number) =>
    new AppError(
      'DEMASIADOS_PEDIDOS',
      `Demasiados pedidos seguidos. Probá de nuevo en ${String(esperarSegundos)} segundos.`,
      429,
      { esperarSegundos },
    ),

  sinPermiso: () => new AppError('SIN_PERMISO', 'No tenés permiso para hacer esto.', 403),

  sucursalNoPermitida: () =>
    new AppError('SUCURSAL_NO_PERMITIDA', 'No podés operar en esa sucursal.', 403),

  datosInvalidos: (detalles: unknown) =>
    new AppError('DATOS_INVALIDOS', 'Hay datos inválidos en el pedido.', 400, detalles),

  noEncontrado: (que = 'El recurso') => new AppError('NO_ENCONTRADO', `${que} no existe.`, 404),

  nombreDuplicado: (que: string) => new AppError('NOMBRE_DUPLICADO', `Ya existe ${que}.`, 409),

  /**
   * No hay stock suficiente para la salida que se pidió.
   *
   * Es 409 (conflicto) y no 400: el pedido está bien formado, lo que pasa es
   * que choca con el estado actual del sistema. Y el mensaje DICE CUÁNTO HAY:
   * un "no se puede" sin el número obliga a la persona a irse a otra pantalla
   * a averiguarlo.
   */
  stockInsuficiente: (detalle: {
    insumoId: string;
    insumoNombre: string;
    sucursalNombre: string;
    disponible: string;
    solicitado: string;
    unidad: string;
  }) =>
    new AppError(
      'STOCK_INSUFICIENTE',
      `Hay ${detalle.disponible} ${detalle.unidad} de ${detalle.insumoNombre} en ` +
        `${detalle.sucursalNombre} y querés sacar ${detalle.solicitado} ${detalle.unidad}.`,
      409,
      detalle,
    ),

  /** Se intentó convertir entre dimensiones distintas (kg → litros). */
  dimensionIncompatible: (mensaje: string, detalles?: unknown) =>
    new AppError('DIMENSION_INCOMPATIBLE', mensaje, 400, detalles),

  /** Ya existe una reversa de ese movimiento. El UNIQUE de la base lo respalda. */
  movimientoYaRevertido: () =>
    new AppError(
      'MOVIMIENTO_YA_REVERTIDO',
      'Ese movimiento ya fue anulado: no se puede anular dos veces.',
      409,
    ),
};

/**
 * Convierte cualquier cosa que haya sido lanzada en un texto legible.
 *
 * ¿Por qué hace falta? Porque `error.message` a veces viene VACÍO.
 * Caso real de este proyecto: cuando Postgres no está levantado, Node intenta
 * conectarse a ::1 (IPv6) y a 127.0.0.1 (IPv4), las dos fallan, y agrupa los
 * dos fallos en un AggregateError cuyo propio `message` es "". Si mostrás
 * `error.message` directo, el usuario ve un error vacío y no sabe qué pasó.
 *
 * En JavaScript se puede lanzar CUALQUIER valor (`throw 'texto'`, `throw 42`),
 * por eso el parámetro es `unknown` y hay que ir descartando casos.
 */
export function describirError(error: unknown): string {
  // AggregateError agrupa varios errores (Node lo usa cuando prueba varias
  // direcciones de red). Nos interesa el detalle de cada uno.
  if (error instanceof AggregateError) {
    const detalles = error.errors.map(describirError).filter((texto) => texto.length > 0);
    return detalles.length > 0 ? detalles.join('; ') : (codigoDe(error) ?? 'AggregateError');
  }

  if (error instanceof Error) {
    const codigo = codigoDe(error);
    if (error.message.length > 0) {
      return codigo ? `${error.message} (${codigo})` : error.message;
    }
    // Sin mensaje: nos conformamos con el código del sistema o el nombre.
    return codigo ?? error.name;
  }

  if (typeof error === 'string' && error.length > 0) return error;

  return 'Error desconocido';
}

/** Los errores del sistema operativo traen un `code` (ECONNREFUSED, ENOTFOUND...). */
function codigoDe(error: Error): string | undefined {
  const codigo = (error as { code?: unknown }).code;
  return typeof codigo === 'string' && codigo.length > 0 ? codigo : undefined;
}
