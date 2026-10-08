import { describe, expect, it } from 'vitest';

import { describirError } from './errores.js';

describe('describirError', () => {
  it('usa el mensaje de un Error común', () => {
    expect(describirError(new Error('se rompió todo'))).toBe('se rompió todo');
  });

  it('agrega el código del sistema cuando existe', () => {
    const error = Object.assign(new Error('no se pudo conectar'), { code: 'ECONNREFUSED' });
    expect(describirError(error)).toBe('no se pudo conectar (ECONNREFUSED)');
  });

  it('describe el AggregateError de "Postgres apagado" (el caso real)', () => {
    // Esto es exactamente lo que lanza pg cuando la base no está levantada:
    // un AggregateError con message vacío y un sub-error por cada dirección.
    const agregado = new AggregateError([
      Object.assign(new Error('connect ECONNREFUSED ::1:5432'), { code: 'ECONNREFUSED' }),
      Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:5432'), { code: 'ECONNREFUSED' }),
    ]);

    expect(describirError(agregado)).toBe(
      'connect ECONNREFUSED ::1:5432 (ECONNREFUSED); connect ECONNREFUSED 127.0.0.1:5432 (ECONNREFUSED)',
    );
  });

  it('no devuelve texto vacío cuando el Error no tiene mensaje', () => {
    const sinMensaje = new Error('');
    expect(describirError(sinMensaje)).toBe('Error');
  });

  it('tolera que se haya lanzado algo que no es un Error', () => {
    expect(describirError('fallo crudo')).toBe('fallo crudo');
    expect(describirError(undefined)).toBe('Error desconocido');
    expect(describirError(42)).toBe('Error desconocido');
  });
});
