import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import {
  ActualizarProveedorInsumoSchema,
  CrearProveedorInsumoSchema,
  CrearProveedorSchema,
} from './proveedores.js';

/** Atajo: parsea y devuelve el dato, o tira si el esquema lo rechaza. */
function parsearProveedor(entrada: Record<string, unknown>) {
  return CrearProveedorSchema.parse({ nombre: 'Molino de prueba', ...entrada });
}

/** Devuelve el mensaje de error del campo pedido, o null si no hubo error. */
function errorDe(esquema: z.ZodType, entrada: unknown, campo: string) {
  const resultado = esquema.safeParse(entrada);
  if (resultado.success) return null;
  return resultado.error.issues.find((i) => i.path.join('.') === campo)?.message ?? null;
}

describe('CrearProveedorSchema', () => {
  it('exige el nombre', () => {
    expect(errorDe(CrearProveedorSchema, { nombre: '   ' }, 'nombre')).toBe(
      'El nombre es obligatorio',
    );
  });

  it('recorta los espacios del nombre', () => {
    expect(parsearProveedor({ nombre: '  Molino Cañuelas  ' }).nombre).toBe('Molino Cañuelas');
  });

  it('guarda el CUIT sin guiones ni puntos, como se dicta por teléfono', () => {
    // Las tres formas son el mismo CUIT y tienen que guardarse igual: si no,
    // el mismo proveedor podría entrar dos veces con "distinto" CUIT.
    expect(parsearProveedor({ cuit: '30-12345678-9' }).cuit).toBe('30123456789');
    expect(parsearProveedor({ cuit: '30.12345678.9' }).cuit).toBe('30123456789');
    expect(parsearProveedor({ cuit: '30 12345678 9' }).cuit).toBe('30123456789');
  });

  it('rechaza un CUIT que no tenga 11 dígitos', () => {
    expect(errorDe(CrearProveedorSchema, { nombre: 'X', cuit: '30-1234-5' }, 'cuit')).toBe(
      'El CUIT tiene 11 dígitos',
    );
  });

  it('los campos opcionales vacíos quedan en null, no en cadena vacía', () => {
    // Importa de verdad: con '' la base guardaría un texto vacío, y entonces
    // "¿tiene email?" devolvería que sí.
    const proveedor = parsearProveedor({
      razonSocial: '',
      cuit: '',
      email: '',
      telefono: '',
      direccion: '',
      contactoNombre: '',
      diasEntrega: '',
      notas: '',
    });
    expect(proveedor).toMatchObject({
      razonSocial: null,
      cuit: null,
      email: null,
      telefono: null,
      direccion: null,
      contactoNombre: null,
      diasEntrega: null,
      notas: null,
    });
  });

  it('rechaza un email con forma inválida', () => {
    expect(errorDe(CrearProveedorSchema, { nombre: 'X', email: 'pepe@' }, 'email')).toBe(
      'No parece un email válido',
    );
  });

  it('acepta cero días de entrega y lo distingue de "no sé"', () => {
    // Cero = entrega en el día. null = no sabemos cuánto tarda. No es lo mismo
    // para la sugerencia de reposición.
    expect(parsearProveedor({ diasEntrega: 0 }).diasEntrega).toBe(0);
    expect(parsearProveedor({ diasEntrega: null }).diasEntrega).toBeNull();
  });

  it('rechaza días de entrega negativos o con coma', () => {
    expect(errorDe(CrearProveedorSchema, { nombre: 'X', diasEntrega: -1 }, 'diasEntrega')).toBe(
      'No puede ser negativo',
    );
    expect(errorDe(CrearProveedorSchema, { nombre: 'X', diasEntrega: 2.5 }, 'diasEntrega')).toBe(
      'Tiene que ser un número entero de días',
    );
  });

  it('acepta los días de entrega escritos como texto (vienen de un <input>)', () => {
    expect(parsearProveedor({ diasEntrega: '3' }).diasEntrega).toBe(3);
  });
});

describe('CrearProveedorInsumoSchema', () => {
  const insumoId = '11111111-1111-4111-8111-111111111111';

  it('exige el insumo', () => {
    expect(errorDe(CrearProveedorInsumoSchema, {}, 'insumoId')).toBe('Hay que elegir un insumo');
  });

  it('acepta un precio escrito a la argentina y lo normaliza', () => {
    const fila = CrearProveedorInsumoSchema.parse({ insumoId, ultimoPrecio: '32.500,50' });
    expect(fila.ultimoPrecio).toBe('32500.50');
  });

  it('un precio vacío es null: "no sé el precio" no es "cuesta cero"', () => {
    expect(
      CrearProveedorInsumoSchema.parse({ insumoId, ultimoPrecio: '' }).ultimoPrecio,
    ).toBeNull();
    expect(CrearProveedorInsumoSchema.parse({ insumoId, ultimoPrecio: '0' }).ultimoPrecio).toBe(
      '0',
    );
  });

  it('rechaza un precio negativo', () => {
    expect(
      errorDe(CrearProveedorInsumoSchema, { insumoId, ultimoPrecio: '-5' }, 'ultimoPrecio'),
    ).toBe('El precio no puede ser negativo');
  });

  it('la presentación vacía queda en null: lo vende en la unidad base', () => {
    expect(
      CrearProveedorInsumoSchema.parse({ insumoId, presentacionId: '' }).presentacionId,
    ).toBeNull();
  });

  it('esPreferido es false si no se manda', () => {
    expect(CrearProveedorInsumoSchema.parse({ insumoId }).esPreferido).toBe(false);
  });
});

describe('ActualizarProveedorInsumoSchema', () => {
  it('descarta el insumoId: la asociación no cambia de insumo', () => {
    // No es una validación que devuelva error: el campo NO EXISTE en el
    // esquema, y Zod borra las claves que no declara. Así es imposible que
    // llegue al servicio, incluso si el frontend lo manda por error.
    const resultado = ActualizarProveedorInsumoSchema.parse({
      insumoId: '11111111-1111-4111-8111-111111111111',
      codigoProveedor: '4412',
    });
    expect(resultado).not.toHaveProperty('insumoId');
    expect(resultado.codigoProveedor).toBe('4412');
  });

  it('un objeto vacío es válido: un PATCH puede no cambiar nada', () => {
    expect(ActualizarProveedorInsumoSchema.safeParse({}).success).toBe(true);
  });
});
