import { calcularCostoPromedio, type Decimal } from '@panaderia/shared';

import { AppError } from '../../lib/errores.js';
import type { Tx } from '../movimientos/motor.js';

/**
 * RECONSTRUYE el costo promedio de los insumos indicados y lo guarda.
 *
 * Se llama al final de cada recepción y de cada anulación, DENTRO de su
 * transacción. Nunca suma ni resta sobre el valor guardado: recorre todos los
 * movimientos del insumo y lo calcula de cero con `calcularCostoPromedio`
 * (la explicación de por qué está ahí). Con unos pocos miles de movimientos
 * por insumo y por año, recorrerlos lleva milisegundos.
 *
 * EL CANDADO, y por qué es `FOR NO KEY UPDATE` y no `FOR UPDATE`
 *
 * Hace falta un candado: si dos recepciones de harina (una en cada sucursal)
 * leyeran los movimientos al mismo tiempo, cada una vería solo su propia
 * compra y la última en guardar pisaría a la otra con un promedio que ignora
 * una de las dos compras.
 *
 * Pero `FOR UPDATE` acá produciría un ABRAZO MORTAL, y uno difícil de ver:
 * insertar un movimiento le pone a la fila del insumo un candado suave
 * (`FOR KEY SHARE`), porque la clave foránea tiene que asegurarse de que el
 * insumo no se borre mientras tanto. Entonces:
 *
 *   recepción A: inserta su movimiento    → candado suave sobre la harina
 *   recepción B: inserta su movimiento    → candado suave sobre la harina
 *   recepción A: FOR UPDATE de la harina  → espera el candado suave de B
 *   recepción B: FOR UPDATE de la harina  → espera el candado suave de A  💥
 *
 * `FOR NO KEY UPDATE` dice "voy a cambiar columnas, pero no la clave", y por
 * eso convive con los candados suaves de las claves foráneas. Entre dos
 * recepciones sí choca, que es exactamente lo que queremos: la segunda espera
 * a que la primera haga commit y recién ahí lee los movimientos.
 *
 * Los insumos se bloquean ORDENADOS, igual que en el motor.
 */
export async function recalcularCostoPromedio(
  tx: Tx,
  empresaId: string,
  insumoIds: readonly string[],
): Promise<Map<string, Decimal | null>> {
  const resultado = new Map<string, Decimal | null>();

  for (const insumoId of [...new Set(insumoIds)].sort()) {
    const bloqueado = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM insumo
      WHERE id = ${insumoId}::uuid AND empresa_id = ${empresaId}::uuid
      FOR NO KEY UPDATE`;
    if (bloqueado.length !== 1) {
      throw new AppError('ERROR_INTERNO', 'No se pudo bloquear el insumo para valuarlo.', 500);
    }

    // Recién con el candado tomado, los movimientos que se leen son todos los
    // que existen. Sin relaciones en el select: es UNA consulta, y por eso se
    // puede hacer adentro de la transacción (ver la regla 13 de CLAUDE.md).
    const movimientos = await tx.movimientoStock.findMany({
      // Todas las sucursales: el costo promedio es por EMPRESA.
      where: { empresaId, insumoId },
      // El orden del hecho. Desempata por cuándo se registró y, por último,
      // por id: el resultado tiene que ser el mismo cada vez que se recalcula.
      orderBy: [{ fecha: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
      select: { id: true, tipo: true, cantidadBase: true, costoUnitario: true, revierteAId: true },
    });

    const costo = calcularCostoPromedio(
      movimientos.map((m) => ({
        id: m.id,
        tipo: m.tipo,
        cantidadBase: m.cantidadBase.toString(),
        costoUnitario: m.costoUnitario?.toString() ?? null,
        revierteAId: m.revierteAId,
      })),
    );

    await tx.insumo.update({
      where: { id: insumoId },
      data: { costoPromedio: costo === null ? null : costo.toString() },
    });
    resultado.set(insumoId, costo);
  }

  return resultado;
}
