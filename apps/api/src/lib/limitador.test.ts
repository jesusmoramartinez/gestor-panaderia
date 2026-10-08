import { beforeEach, describe, expect, it } from 'vitest';

import { LimitadorIntentos } from './limitador.js';

const MINUTO = 60_000;

describe('LimitadorIntentos', () => {
  // Reloj falso: así los tests no tardan 15 minutos.
  let ahora = 0;
  const reloj = () => ahora;
  let limitador: LimitadorIntentos;

  beforeEach(() => {
    ahora = 1_000_000;
    limitador = new LimitadorIntentos({ limite: 3, ventanaMs: 15 * MINUTO, reloj });
  });

  it('permite mientras no se alcance el límite', () => {
    expect(limitador.verificar('juan@mail.test').permitido).toBe(true);
    limitador.registrarFallo('juan@mail.test');
    limitador.registrarFallo('juan@mail.test');
    expect(limitador.verificar('juan@mail.test').permitido).toBe(true);
  });

  it('bloquea al alcanzar el límite', () => {
    for (let i = 0; i < 3; i++) limitador.registrarFallo('juan@mail.test');
    const resultado = limitador.verificar('juan@mail.test');
    expect(resultado.permitido).toBe(false);
    if (!resultado.permitido) {
      expect(resultado.esperarSegundos).toBe(15 * 60);
    }
  });

  it('cuenta cada clave por separado', () => {
    for (let i = 0; i < 3; i++) limitador.registrarFallo('juan@mail.test');
    expect(limitador.verificar('juan@mail.test').permitido).toBe(false);
    // Que a Juan le hayan errado la contraseña no puede dejar afuera a Ana.
    expect(limitador.verificar('ana@mail.test').permitido).toBe(true);
  });

  it('la ventana es DESLIZANTE: se libera de a uno', () => {
    limitador.registrarFallo('juan@mail.test'); // en t
    ahora += 10 * MINUTO;
    limitador.registrarFallo('juan@mail.test'); // en t+10
    limitador.registrarFallo('juan@mail.test'); // en t+10
    expect(limitador.verificar('juan@mail.test').permitido).toBe(false);

    // A los 15 minutos del PRIMER intento, ese sale de la ventana y se libera
    // un lugar; los otros dos siguen contando.
    ahora += 5 * MINUTO + 1;
    expect(limitador.verificar('juan@mail.test').permitido).toBe(true);
  });

  it('informa cuánto falta esperar y va bajando', () => {
    for (let i = 0; i < 3; i++) limitador.registrarFallo('juan@mail.test');
    const primero = limitador.verificar('juan@mail.test');
    ahora += 5 * MINUTO;
    const despues = limitador.verificar('juan@mail.test');

    expect(primero.permitido).toBe(false);
    expect(despues.permitido).toBe(false);
    if (!primero.permitido && !despues.permitido) {
      expect(despues.esperarMs).toBeLessThan(primero.esperarMs);
      expect(despues.esperarSegundos).toBe(10 * 60);
    }
  });

  it('un login exitoso borra el historial de fallos', () => {
    limitador.registrarFallo('juan@mail.test');
    limitador.registrarFallo('juan@mail.test');
    limitador.limpiar('juan@mail.test');
    limitador.registrarFallo('juan@mail.test');
    // Si no se hubiera limpiado, este tercer fallo lo bloquearía.
    expect(limitador.verificar('juan@mail.test').permitido).toBe(true);
  });

  it('no acumula claves viejas en memoria', () => {
    limitador.registrarFallo('juan@mail.test');
    expect(limitador.clavesEnMemoria).toBe(1);
    ahora += 16 * MINUTO;
    limitador.verificar('juan@mail.test'); // al consultar, descarta lo viejo
    expect(limitador.clavesEnMemoria).toBe(0);
  });
});
