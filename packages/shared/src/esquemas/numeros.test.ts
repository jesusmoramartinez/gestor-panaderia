import { describe, expect, it } from 'vitest';

import { CantidadNoNegativaSchema, CantidadPositivaSchema } from './insumos.js';
import { CantidadMovimientoSchema } from './movimientos.js';
import { MontoSchema } from './pagos.js';
import { PrecioSchema } from './proveedores.js';

/**
 * Un dato mal escrito es un 400, nunca un 500.
 *
 * En Zod 4 las validaciones de una cadena siguen corriendo aunque una
 * anterior haya fallado. Las que convertían el texto a número (aDecimal)
 * LANZABAN con "mil" o "2.000.000", y la API respondía "error inesperado".
 * Lo encontró un test de pagos; estaba en seis esquemas.
 */
const ESQUEMAS = {
  PrecioSchema,
  MontoSchema,
  CantidadMovimientoSchema,
  CantidadPositivaSchema,
  CantidadNoNegativaSchema,
};

describe('los esquemas numéricos rechazan el texto sin lanzar', () => {
  for (const [nombre, esquema] of Object.entries(ESQUEMAS)) {
    it(nombre, () => {
      for (const texto of ['mil', '1,2,3', '--5', '12abc', '.']) {
        expect(() => esquema.safeParse(texto), `${nombre}("${texto}")`).not.toThrow();
        expect(esquema.safeParse(texto).success, `${nombre}("${texto}")`).toBe(false);
      }
    });
  }
});

describe('la plata se escribe como en Argentina', () => {
  it('precio y monto aceptan los puntos de miles', () => {
    expect(PrecioSchema.parse('18.500')).toBe('18500');
    expect(MontoSchema.parse('$ 2.000.000')).toBe('2000000');
    expect(MontoSchema.parse('18.500,50')).toBe('18500.50');
  });
});
