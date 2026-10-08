import type { TipoDocumento } from '../../generated/prisma/enums.js';
import { AppError } from '../../lib/errores.js';
import type { Tx } from '../movimientos/motor.js';

/**
 * El número siguiente de un documento ("recepción 15"), sin repetidos.
 *
 * EL PROBLEMA: la forma ingenua es `SELECT MAX(numero) + 1`. Si dos personas
 * confirman una recepción en el mismo instante, las dos leen 14, las dos
 * calculan 15, y hay dos recepciones 15 (o, con el UNIQUE, una de las dos
 * falla con un error incomprensible). Es la misma condición de carrera que el
 * stock negativo de la Fase 6.
 *
 * LA SOLUCIÓN, en UNA sola sentencia:
 *
 *   INSERT ... ON CONFLICT DO UPDATE SET ultimo_numero = ultimo_numero + 1
 *   RETURNING ultimo_numero
 *
 * - Si la fila del contador no existe (el primer documento de la empresa), la
 *   crea con 1.
 * - Si existe, la incrementa. Un UPDATE toma el candado de la fila y lo tiene
 *   hasta el fin de la transacción: el segundo pedido ESPERA ahí, y cuando el
 *   primero hace commit, lee el valor ya incrementado y obtiene el 16.
 *
 * Es lo mismo que `SELECT ... FOR UPDATE` seguido de un `UPDATE`, pero en un
 * solo viaje a la base y sin ventana entre las dos sentencias.
 *
 * UN DETALLE LINDO: si la transacción falla después (por ejemplo, no hay
 * stock para anular), el incremento se deshace junto con todo lo demás. Así
 * la numeración no queda con huecos por operaciones que nunca existieron.
 *
 * Recibe el `tx` a propósito: fuera de una transacción el candado se soltaría
 * enseguida, y el número se podría "gastar" sin que exista el documento.
 */
export async function siguienteNumero(
  tx: Tx,
  empresaId: string,
  tipo: TipoDocumento,
): Promise<number> {
  const filas = await tx.$queryRaw<{ ultimo_numero: number }[]>`
    INSERT INTO contador_documento (empresa_id, tipo_documento, ultimo_numero)
    VALUES (${empresaId}::uuid, ${tipo}::tipo_documento, 1)
    ON CONFLICT (empresa_id, tipo_documento)
    DO UPDATE SET ultimo_numero = contador_documento.ultimo_numero + 1
    RETURNING ultimo_numero`;

  const numero = filas[0]?.ultimo_numero;
  if (numero === undefined) {
    throw new AppError('ERROR_INTERNO', 'No se pudo numerar el documento.', 500);
  }
  return numero;
}
