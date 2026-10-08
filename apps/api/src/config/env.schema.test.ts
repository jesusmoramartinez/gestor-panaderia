import { describe, expect, it } from 'vitest';

import { EnvInvalidoError, validarEnv } from './env.schema.js';

const minimo = { DATABASE_URL: 'postgresql://usuario:clave@localhost:5432/panaderia' };

describe('validarEnv', () => {
  it('acepta la configuración mínima y aplica los valores por defecto', () => {
    const env = validarEnv({ ...minimo });
    expect(env.PORT).toBe(3000);
    expect(env.NODE_ENV).toBe('development');
  });

  it('convierte PORT de texto a número', () => {
    const env = validarEnv({ ...minimo, PORT: '4000' });
    expect(env.PORT).toBe(4000);
  });

  it('falla si falta DATABASE_URL', () => {
    expect(() => validarEnv({})).toThrow(EnvInvalidoError);
  });

  it('falla si DATABASE_URL no es una conexión de PostgreSQL', () => {
    expect(() => validarEnv({ DATABASE_URL: 'mysql://usuario@localhost/base' })).toThrow(
      /PostgreSQL/,
    );
  });

  it('falla si NODE_ENV tiene un valor no previsto', () => {
    expect(() => validarEnv({ ...minimo, NODE_ENV: 'produccion' })).toThrow(EnvInvalidoError);
  });

  it('falla si PORT no es un número', () => {
    expect(() => validarEnv({ ...minimo, PORT: 'tresmil' })).toThrow(EnvInvalidoError);
  });
});
