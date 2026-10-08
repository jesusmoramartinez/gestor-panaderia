import {
  convertir,
  DimensionIncompatibleError,
  type UnidadMedida,
  UnidadMedidaSchema,
} from '@panaderia/shared';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { PASSWORD_DEV } from '../prisma/semilla.js';
import { cerrarConexiones } from '../src/lib/db.js';
import { reiniciarLimitadores } from '../src/modules/auth/service.js';
import { ClienteHttp } from './cliente-http.js';

let api: ClienteHttp;

beforeAll(async () => {
  api = await ClienteHttp.levantar();
});

afterAll(async () => {
  await api.cerrar();
  await cerrarConexiones();
});

beforeEach(() => {
  reiniciarLimitadores();
  api.olvidarCookies();
});

async function entrarComo(email: string): Promise<void> {
  const r = await api.post('/api/auth/login', { email, password: PASSWORD_DEV });
  expect(r.status, `login de ${email}`).toBe(200);
}

function unidades(cuerpo: unknown): UnidadMedida[] {
  return cuerpo as UnidadMedida[];
}

describe('GET /api/unidades', () => {
  it('sin sesión responde 401', async () => {
    const r = await api.get('/api/unidades');
    expect(r.status).toBe(401);
  });

  it('devuelve las cinco unidades de la empresa', async () => {
    await entrarComo('dueno@panaderia.test');
    const r = await api.get('/api/unidades');

    expect(r.status).toBe(200);
    const lista = unidades(r.cuerpo);
    expect(lista).toHaveLength(5);
    // Agrupadas por dimensión, con la unidad base primero: es el orden en que
    // tienen sentido en un selector.
    expect(lista.map((u) => u.codigo)).toEqual(['kg', 'g', 'l', 'ml', 'u']);
  });

  it('la respuesta cumple el esquema compartido', async () => {
    await entrarComo('dueno@panaderia.test');
    const r = await api.get('/api/unidades');
    // El mismo esquema con el que valida el frontend.
    expect(UnidadMedidaSchema.array().safeParse(r.cuerpo).success).toBe(true);
  });

  it('hay una sola unidad base por dimensión, y vale 1', async () => {
    await entrarComo('dueno@panaderia.test');
    const lista = unidades((await api.get('/api/unidades')).cuerpo);

    const bases = lista.filter((u) => u.esBase);
    expect(bases.map((u) => u.codigo).sort()).toEqual(['kg', 'l', 'u']);
    expect(bases.map((u) => u.dimension).sort()).toEqual(['PESO', 'UNIDAD', 'VOLUMEN']);
    for (const base of bases) expect(base.factorABase).toBe('1');
  });

  it('el factor viaja como TEXTO, no como número', async () => {
    await entrarComo('dueno@panaderia.test');
    const r = await api.get('/api/unidades');
    const gramo = unidades(r.cuerpo).find((u) => u.codigo === 'g');

    // JSON no tiene tipo decimal: si el factor viajara como number, el
    // navegador lo parsearía como float y perderíamos exactitud justo en el
    // dato del que depende todo el stock.
    expect(typeof gramo?.factorABase).toBe('string');
    expect(gramo?.factorABase).toBe('0.001');
    expect(JSON.stringify(r.cuerpo)).toContain('"factorABase":"0.001"');
  });

  it('cualquier rol puede ver el catálogo, también el empleado', async () => {
    // No lleva permiso especial: quien carga un consumo necesita saber en qué
    // unidades puede cargarlo.
    await entrarComo('empleado@panaderia.test');
    const r = await api.get('/api/unidades');
    expect(r.status).toBe(200);
    expect(unidades(r.cuerpo)).toHaveLength(5);
  });
});

describe('convertir() con los datos reales de la API', () => {
  it('convierte usando los factores que vienen del servidor', async () => {
    // Este es el test que cierra el círculo de la fase: los factores salen de
    // Postgres, viajan por HTTP como texto y la MISMA función de conversión
    // que usa el backend los usa acá sin transformar nada.
    await entrarComo('encargado@panaderia.test');
    const lista = unidades((await api.get('/api/unidades')).cuerpo);

    const kg = lista.find((u) => u.codigo === 'kg');
    const g = lista.find((u) => u.codigo === 'g');
    const litro = lista.find((u) => u.codigo === 'l');
    if (!kg || !g || !litro) throw new Error('faltan unidades en el catálogo');

    expect(convertir('2.5', kg, g).toString()).toBe('2500');
    expect(convertir('2000', g, kg).toString()).toBe('2');
    // Y sigue rechazando lo que no tiene sentido.
    expect(() => convertir('1', kg, litro)).toThrow(DimensionIncompatibleError);
  });
});
