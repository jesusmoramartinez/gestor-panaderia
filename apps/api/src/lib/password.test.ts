import { describe, expect, it } from 'vitest';

import { hashearPassword, verificarPassword } from './password.js';

// Parámetros bajos SOLO para que los tests corran rápido. El código de
// producción usa PARAMETROS_POR_DEFECTO, que son mucho más costosos.
const RAPIDOS = { N: 1024, r: 8, p: 1 };

describe('hashearPassword', () => {
  it('no devuelve la contraseña en ninguna parte del resultado', async () => {
    const hash = await hashearPassword('harina000', RAPIDOS);
    expect(hash).not.toContain('harina000');
  });

  it('devuelve un hash distinto cada vez, aunque la contraseña sea la misma', async () => {
    const a = await hashearPassword('harina000', RAPIDOS);
    const b = await hashearPassword('harina000', RAPIDOS);
    // Distintos porque el salt es aleatorio. Si fueran iguales, dos usuarios
    // con la misma contraseña se delatarían entre sí.
    expect(a).not.toBe(b);
  });

  it('guarda los parámetros de costo dentro del hash', async () => {
    const hash = await hashearPassword('harina000', RAPIDOS);
    expect(hash.startsWith('scrypt$1024$8$1$')).toBe(true);
    expect(hash.split('$')).toHaveLength(6);
  });
});

describe('verificarPassword', () => {
  it('acepta la contraseña correcta', async () => {
    const hash = await hashearPassword('levadura fresca', RAPIDOS);
    await expect(verificarPassword('levadura fresca', hash)).resolves.toBe(true);
  });

  it('rechaza la contraseña incorrecta', async () => {
    const hash = await hashearPassword('levadura fresca', RAPIDOS);
    await expect(verificarPassword('levadura seca', hash)).resolves.toBe(false);
  });

  it('rechaza una contraseña vacía contra un hash real', async () => {
    const hash = await hashearPassword('levadura fresca', RAPIDOS);
    await expect(verificarPassword('', hash)).resolves.toBe(false);
  });

  it('verifica un hash creado con parámetros distintos a los actuales', async () => {
    // Esto es lo que permite subir el costo en el futuro sin invalidar las
    // contraseñas ya guardadas: los parámetros salen del hash, no del código.
    const viejo = await hashearPassword('medialunas', { N: 256, r: 8, p: 1 });
    const nuevo = await hashearPassword('medialunas', { N: 2048, r: 8, p: 1 });
    await expect(verificarPassword('medialunas', viejo)).resolves.toBe(true);
    await expect(verificarPassword('medialunas', nuevo)).resolves.toBe(true);
  });

  it('trata como iguales las dos formas Unicode de escribir una ñ', async () => {
    const compuesta = 'contraseña'; // ñ como un solo carácter
    const descompuesta = 'contraseña'; // n + tilde combinada
    expect(compuesta).not.toBe(descompuesta); // bytes distintos...
    const hash = await hashearPassword(compuesta, RAPIDOS);
    // ...pero la misma contraseña para una persona.
    await expect(verificarPassword(descompuesta, hash)).resolves.toBe(true);
  });

  it('rechaza hashes con formato inválido sin lanzar', async () => {
    for (const malo of [
      '',
      'no-es-un-hash',
      'scrypt$1024$8$1$solocuatro',
      'bcrypt$1024$8$1$c2FsdA==$aGFzaA==',
      'scrypt$cero$8$1$c2FsdA==$aGFzaA==',
      'scrypt$1024$8$1$$aGFzaA==',
      'scrypt$1024$8$1$c2FsdA==$',
    ]) {
      await expect(verificarPassword('cualquiera', malo)).resolves.toBe(false);
    }
  });
});
