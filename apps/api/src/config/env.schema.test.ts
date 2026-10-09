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

  it('trae valores de producción con defaults que sirven en desarrollo', () => {
    const env = validarEnv({ ...minimo });
    expect(env.DB_POOL_MAX).toBe(10);
    expect(env.TRUST_PROXY).toBe(false);
    expect(env.LIMITE_PEDIDOS_POR_MINUTO).toBe(600);
    expect(env.LOG_LEVEL).toBeUndefined();
  });

  it('lee los valores de producción como los escribe Vercel (todo texto)', () => {
    const env = validarEnv({
      ...minimo,
      NODE_ENV: 'production',
      DB_POOL_MAX: '1',
      TRUST_PROXY: 'true',
      LOG_LEVEL: 'warn',
      LIMITE_PEDIDOS_POR_MINUTO: '0',
    });
    expect(env.DB_POOL_MAX).toBe(1);
    expect(env.TRUST_PROXY).toBe(true);
    expect(env.LOG_LEVEL).toBe('warn');
    expect(env.LIMITE_PEDIDOS_POR_MINUTO).toBe(0);
  });

  it('rechaza un nivel de log inventado', () => {
    expect(() => validarEnv({ ...minimo, LOG_LEVEL: 'todo' })).toThrow(EnvInvalidoError);
  });
});
