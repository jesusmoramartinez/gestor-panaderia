import type { UsuarioSesion } from '@panaderia/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { darDeAltaEmpresa, darDeAltaUsuario } from '../prisma/alta.js';
import { MOTIVOS, UNIDADES } from '../prisma/semilla.js';
import { CATEGORIAS } from '../prisma/semilla-insumos.js';
import { cerrarConexiones, prisma } from '../src/lib/db.js';
import { reiniciarLimitadores } from '../src/modules/auth/service.js';
import { ClienteHttp } from './cliente-http.js';

/**
 * EL ALTA DE PRODUCCIÓN (Fase 11): lo que reemplaza a la semilla en la base
 * real. Se prueba de punta a punta: se da de alta y se ENTRA por la API.
 */

let api: ClienteHttp;
const PASSWORD = 'una-clave-de-produccion';

beforeAll(async () => {
  api = await ClienteHttp.levantar();
});

afterAll(async () => {
  await api.cerrar();
  await cerrarConexiones();
});

function definicion(email: string) {
  return {
    empresa: { nombre: `Panadería de alta ${email}`, cuit: '30712345678' },
    sucursales: [
      { codigo: 'CEN', nombre: 'Central', esCentral: true },
      { codigo: 'SUR', nombre: 'Sucursal Sur' },
    ],
    dueno: { email, nombre: 'Dueña de prueba' },
  };
}

async function entrar(email: string, password = PASSWORD): Promise<UsuarioSesion> {
  reiniciarLimitadores();
  api.olvidarCookies();
  const r = await api.post('/api/auth/login', { email, password });
  expect(r.status, JSON.stringify(r.cuerpo)).toBe(200);
  return r.cuerpo as UsuarioSesion;
}

describe('alta de una empresa', () => {
  it('crea la empresa con su catálogo base, sus sucursales y su dueño, que puede entrar', async () => {
    const email = `alta-${String(Date.now())}@ejemplo.com`;
    const { empresaId } = await darDeAltaEmpresa(prisma, definicion(email), PASSWORD);

    const empresa = await prisma.empresa.findUniqueOrThrow({
      where: { id: empresaId },
      include: {
        _count: { select: { unidades: true, motivos: true, categorias: true, insumos: true } },
      },
    });
    // Exactamente el catálogo base de la semilla, sin inventar números.
    expect(empresa._count.unidades).toBe(UNIDADES.length);
    expect(empresa._count.motivos).toBe(MOTIVOS.length);
    expect(empresa._count.categorias).toBe(CATEGORIAS.length);
    // Sin insumos: los carga el dueño desde la pantalla (C-4).
    expect(empresa._count.insumos).toBe(0);

    const sesion = await entrar(email);
    expect(sesion.rol).toBe('DUENO');
    expect(sesion.empresa.id).toBe(empresaId);
    expect(sesion.sucursales.map((s) => s.codigo).sort()).toEqual(['CEN', 'SUR']);
  });

  it('no se da de alta dos veces (el email del dueño ya existe)', async () => {
    const email = `doble-${String(Date.now())}@ejemplo.com`;
    await darDeAltaEmpresa(prisma, definicion(email), PASSWORD);
    await expect(darDeAltaEmpresa(prisma, definicion(email), PASSWORD)).rejects.toThrow(
      /ya existe/i,
    );
  });

  it('exige una contraseña válida (la misma regla que la API), y no la toma de ningún archivo', async () => {
    const email = `clave-${String(Date.now())}@ejemplo.com`;
    await expect(darDeAltaEmpresa(prisma, definicion(email), undefined)).rejects.toThrow(
      /Contraseña/,
    );
    await expect(darDeAltaEmpresa(prisma, definicion(email), 'corta')).rejects.toThrow(
      /Contraseña/,
    );
    // Y no quedó nada a medias.
    expect(await prisma.usuario.count({ where: { email } })).toBe(0);
  });

  it('una sola sucursal puede ser la central', async () => {
    const datos = definicion(`centrales-${String(Date.now())}@ejemplo.com`);
    datos.sucursales[1] = { codigo: 'SUR', nombre: 'Sur', esCentral: true };
    await expect(darDeAltaEmpresa(prisma, datos, PASSWORD)).rejects.toThrow();
  });
});

describe('alta de un usuario', () => {
  it('un encargado de una sucursal entra y opera solo en esa', async () => {
    const { empresaId } = await darDeAltaEmpresa(
      prisma,
      definicion(`base-${String(Date.now())}@ejemplo.com`),
      PASSWORD,
    );
    const email = `encargado-alta-${String(Date.now())}@ejemplo.com`;
    await darDeAltaUsuario(
      prisma,
      { empresaId, email, nombre: 'Encargado Sur', rol: 'ENCARGADO', sucursales: ['SUR'] },
      PASSWORD,
    );

    const sesion = await entrar(email);
    expect(sesion.rol).toBe('ENCARGADO');
    expect(sesion.sucursales.map((s) => s.codigo)).toEqual(['SUR']);
  });

  it('rechaza una sucursal que la empresa no tiene, y un empleado sin sucursal', async () => {
    const { empresaId } = await darDeAltaEmpresa(
      prisma,
      definicion(`base2-${String(Date.now())}@ejemplo.com`),
      PASSWORD,
    );
    await expect(
      darDeAltaUsuario(
        prisma,
        {
          empresaId,
          email: `x-${String(Date.now())}@e.com`,
          nombre: 'X',
          rol: 'EMPLEADO',
          sucursales: ['NOR'],
        },
        PASSWORD,
      ),
    ).rejects.toThrow(/NOR/);
    await expect(
      darDeAltaUsuario(
        prisma,
        {
          empresaId,
          email: `y-${String(Date.now())}@e.com`,
          nombre: 'Y',
          rol: 'EMPLEADO',
          sucursales: [],
        },
        PASSWORD,
      ),
    ).rejects.toThrow(/al menos una sucursal/);
  });
});
