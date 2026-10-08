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
