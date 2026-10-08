import { aDecimal, type Decimal, formatearCantidad, redondearCantidad } from '@panaderia/shared';

import type { Contexto } from '../../lib/contexto.js';
import { errores } from '../../lib/errores.js';
import * as repo from './repo.js';

/** Una línea ya validada y convertida a unidad base. */
export type LineaResuelta = {
  insumoId: string;
  insumoNombre: string;
  presentacionId: string | null;
  /** En presentaciones (o en unidad base si no hay presentación). */
  cantidad: Decimal;
  /** SNAPSHOT de cuánto trae la presentación hoy (1 sin presentación). */
  factor: Decimal;
  cantidadBase: Decimal;
};

type LineaEntrada = { insumoId: string; presentacionId: string | null; cantidad: string };

/**
 * Valida las líneas de una orden, una recepción directa o una plantilla, y
 * las lleva a unidad base.
 *
 * Tres reglas que la base NO puede expresar con una clave foránea:
 *
 *   1. el insumo es de ESTA empresa (un id ajeno se trata como inexistente);
 *   2. la presentación es de ESE insumo (la clave foránea solo verifica que
 *      la presentación exista, no de quién es: "bolsa 25 kg" de la harina no
 *      puede usarse para pedir levadura);
 *   3. al crear algo nuevo, los dos están activos.
 *
 * El factor se COPIA de la presentación (snapshot): si mañana alguien la
 * corrige de 25 a 24 kg, esta línea sigue diciendo lo que se pidió.
 *
 * Corre FUERA de la transacción a propósito: nada de esto depende de lo que
 * hagan otros pedidos al mismo tiempo (un insumo existe o no existe).
 */
export async function resolverLineas(
  ctx: Contexto,
  lineas: readonly LineaEntrada[],
): Promise<LineaResuelta[]> {
  const insumos = await repo.insumosConPresentaciones(ctx.empresaId, [
    ...new Set(lineas.map((linea) => linea.insumoId)),
  ]);
  const porId = new Map(insumos.map((insumo) => [insumo.id, insumo]));

  return lineas.map((linea, indice) => {
    const campo = (nombre: string) => `lineas.${String(indice)}.${nombre}`;

    const insumo = porId.get(linea.insumoId);
    if (!insumo) {
      throw errores.datosInvalidos({ [campo('insumoId')]: 'Ese insumo no existe en tu empresa.' });
    }
    if (!insumo.activo) {
      throw errores.datosInvalidos({
        [campo('insumoId')]: `"${insumo.nombre}" está inactivo: reactivalo antes de comprarlo.`,
      });
    }

    let factor = aDecimal('1');
    if (linea.presentacionId !== null) {
      const presentacion = insumo.presentaciones.find((p) => p.id === linea.presentacionId);
      if (!presentacion) {
        throw errores.datosInvalidos({
          [campo('presentacionId')]: `Esa presentación no es de "${insumo.nombre}".`,
        });
      }
      if (!presentacion.activa) {
        throw errores.datosInvalidos({
          [campo('presentacionId')]: `La presentación "${presentacion.nombre}" está inactiva.`,
        });
      }
      factor = aDecimal(presentacion.cantidadBase.toString());
    }

    const cantidad = redondearCantidad(linea.cantidad);
    const cantidadBase = redondearCantidad(cantidad.times(factor));
    if (cantidadBase.isZero()) {
      throw errores.datosInvalidos({
        [campo('cantidad')]: `${formatearCantidad(cantidad)} es demasiado poco para registrarse.`,
      });
    }

    return {
      insumoId: insumo.id,
      insumoNombre: insumo.nombre,
      presentacionId: linea.presentacionId,
      cantidad,
      factor,
      cantidadBase,
    };
  });
}
