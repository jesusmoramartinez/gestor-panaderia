import { IconoSchema, normalizarNumero, aDecimal } from '@panaderia/shared';
import { describe, expect, it } from 'vitest';

import { CATALOGO_AMPLIO } from '../prisma/semilla-catalogo.js';
import { INSUMOS_LAFERRERE } from '../prisma/semilla-insumos.js';
import { CATEGORIAS, UNIDADES } from '../src/alta/catalogo-base.js';

/**
 * EL CATÁLOGO PRECARGADO (prisma/semilla-catalogo.ts) es una lista escrita a
 * mano de más de 70 insumos: el lugar perfecto para un error de tipeo. Y la
 * semilla los perdona en silencio (una categoría que no existe queda en null),
 * así que lo controla este test, sin base de datos.
 */
const TODOS = [...INSUMOS_LAFERRERE, ...CATALOGO_AMPLIO];
const NOMBRES_CATEGORIA = new Set<string>(CATEGORIAS.map((c) => c.nombre));
const CODIGOS_UNIDAD = new Set<string>(UNIDADES.map((u) => u.codigo));

describe('el catálogo de la semilla', () => {
  it('cada insumo usa una categoría y una unidad que existen', () => {
    const malos = TODOS.filter(
      (i) => !NOMBRES_CATEGORIA.has(i.categoria) || !CODIGOS_UNIDAD.has(i.unidad),
    ).map((i) => `${i.nombre} (${i.categoria}, ${i.unidad})`);
    expect(malos).toEqual([]);
  });

  it('no repite nombres (son únicos por empresa)', () => {
    const vistos = new Set<string>();
    const repetidos = TODOS.map((i) => i.nombre).filter((n) => {
      const ya = vistos.has(n.toLowerCase());
      vistos.add(n.toLowerCase());
      return ya;
    });
    expect(repetidos).toEqual([]);
  });

  it('los íconos son emoji válidos para la API', () => {
    const malos = [...TODOS.map((i) => i.icono), ...CATEGORIAS.map((c) => c.icono)].filter(
      (icono) => icono !== undefined && !IconoSchema.safeParse(icono).success,
    );
    expect(malos).toEqual([]);
  });

  it('cada insumo tiene UNA presentación por defecto, y todas traen algo', () => {
    for (const insumo of TODOS) {
      const porDefecto = insumo.presentaciones.filter((p) => p.esDefault === true);
      expect(porDefecto, insumo.nombre).toHaveLength(1);
      for (const p of insumo.presentaciones) {
        expect(aDecimal(normalizarNumero(p.cantidadBase)).greaterThan(0), p.nombre).toBe(true);
      }
    }
  });

  it('cubre todas las categorías: ninguna burbuja de la barra queda vacía', () => {
    const usadas = new Set(TODOS.map((i) => i.categoria));
    expect([...NOMBRES_CATEGORIA].filter((c) => !usadas.has(c))).toEqual([]);
  });
});
