import type { Categoria, InsumoDetalle, ListadoInsumos } from '@panaderia/shared';
import { ListadoInsumosSchema } from '@panaderia/shared';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { PASSWORD_DEV } from '../prisma/semilla.js';
import { cerrarConexiones, prisma } from '../src/lib/db.js';
import { reiniciarLimitadores } from '../src/modules/auth/service.js';
import { ClienteHttp } from './cliente-http.js';

let api: ClienteHttp;
let unidadKgId: string;
let unidadLitroId: string;
let categoriaHarinasId: string;
/** Datos de la OTRA empresa, para probar que no se pueden usar. */
let unidadAjenaId: string;
let categoriaAjenaId: string;
let sucursalAjenaId: string;

beforeAll(async () => {
  api = await ClienteHttp.levantar();

  const laferrere = await prisma.empresa.findFirstOrThrow({
    where: { nombre: 'Panadería Laferrere' },
  });
  const vecina = await prisma.empresa.findFirstOrThrow({
    where: { nombre: { contains: 'Vecina' } },
  });

  unidadKgId = (
    await prisma.unidadMedida.findFirstOrThrow({
      where: { empresaId: laferrere.id, codigo: 'kg' },
    })
  ).id;
  unidadLitroId = (
    await prisma.unidadMedida.findFirstOrThrow({
      where: { empresaId: laferrere.id, codigo: 'l' },
    })
  ).id;
  categoriaHarinasId = (
    await prisma.categoriaInsumo.findFirstOrThrow({
      where: { empresaId: laferrere.id, nombre: 'Harinas' },
    })
  ).id;

  unidadAjenaId = (
    await prisma.unidadMedida.findFirstOrThrow({ where: { empresaId: vecina.id, codigo: 'kg' } })
  ).id;
  categoriaAjenaId = (
    await prisma.categoriaInsumo.findFirstOrThrow({
      where: { empresaId: vecina.id, nombre: 'Harinas' },
    })
  ).id;
  sucursalAjenaId = (await prisma.sucursal.findFirstOrThrow({ where: { empresaId: vecina.id } }))
    .id;
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

function listado(cuerpo: unknown): ListadoInsumos {
  return cuerpo as ListadoInsumos;
}
function detalle(cuerpo: unknown): InsumoDetalle {
  return cuerpo as InsumoDetalle;
}
function codigoError(respuesta: { cuerpo: unknown }): string {
  return (respuesta.cuerpo as { codigo: string }).codigo;
}
function detallesError(respuesta: { cuerpo: unknown }): Record<string, string> {
  return (respuesta.cuerpo as { detalles: Record<string, string> }).detalles;
}

/** Nombre único por test, para que una corrida no choque con otra. */
function nombreNuevo(prefijo: string): string {
  return `${prefijo} ${String(Date.now())}-${String(Math.floor(Math.random() * 10000))}`;
}

async function crearInsumo(datos: Record<string, unknown>) {
  return api.post('/api/insumos', {
    nombre: nombreNuevo('Insumo de prueba'),
    codigo: null,
    categoriaId: categoriaHarinasId,
    unidadBaseId: unidadKgId,
    ...datos,
  });
}

describe('GET /api/insumos', () => {
  it('sin sesión responde 401', async () => {
    expect((await api.get('/api/insumos')).status).toBe(401);
  });

  it('lista los insumos de la empresa con su unidad y sus presentaciones', async () => {
    await entrarComo('dueno@panaderia.test');
    const r = await api.get('/api/insumos?limite=100');

    expect(r.status).toBe(200);
    expect(ListadoInsumosSchema.safeParse(r.cuerpo).success).toBe(true);

    const { items, total } = listado(r.cuerpo);
    expect(total).toBeGreaterThanOrEqual(28);

    const harina = items.find((i) => i.nombre === 'Harina 000');
    expect(harina).toBeDefined();
    expect(harina?.unidadBase.codigo).toBe('kg');
    expect(harina?.categoria?.nombre).toBe('Harinas');
    expect(harina?.cantidadPresentaciones).toBe(2);
  });

  it('pagina: devuelve la página pedida y el total completo', async () => {
    await entrarComo('dueno@panaderia.test');
    const primera = listado((await api.get('/api/insumos?limite=5')).cuerpo);
    const segunda = listado((await api.get('/api/insumos?limite=5&desplazamiento=5')).cuerpo);

    expect(primera.items).toHaveLength(5);
    expect(segunda.items).toHaveLength(5);
    expect(primera.total).toBe(segunda.total);
    // Páginas distintas: ningún id repetido.
    const ids = new Set(primera.items.map((i) => i.id));
    expect(segunda.items.some((i) => ids.has(i.id))).toBe(false);
  });

  it('busca por nombre sin distinguir mayúsculas', async () => {
    await entrarComo('dueno@panaderia.test');
    const r = await api.get('/api/insumos?busqueda=HARINA');
    const { items } = listado(r.cuerpo);
    expect(items.length).toBeGreaterThanOrEqual(3);
    for (const insumo of items) expect(insumo.nombre.toLowerCase()).toContain('harina');
  });

  it('busca también por código', async () => {
    await entrarComo('dueno@panaderia.test');
    const { items } = listado((await api.get('/api/insumos?busqueda=HAR-0000')).cuerpo);
    expect(items.map((i) => i.nombre)).toEqual(['Harina 0000']);
  });

  it('filtra por categoría', async () => {
    await entrarComo('dueno@panaderia.test');
    const r = await api.get(`/api/insumos?categoriaId=${categoriaHarinasId}&limite=100`);
    const { items } = listado(r.cuerpo);
    expect(items.length).toBeGreaterThanOrEqual(3);
    for (const insumo of items) expect(insumo.categoria?.id).toBe(categoriaHarinasId);
  });

  it('rechaza un filtro con un uuid inválido', async () => {
    await entrarComo('dueno@panaderia.test');
    const r = await api.get('/api/insumos?categoriaId=no-es-uuid');
    expect(r.status).toBe(400);
    expect(codigoError(r)).toBe('DATOS_INVALIDOS');
  });
});

describe('GET /api/insumos/:id', () => {
  it('devuelve el detalle con presentaciones y TODAS las sucursales', async () => {
    await entrarComo('dueno@panaderia.test');
    const harina = await prisma.insumo.findFirstOrThrow({
      where: { nombre: 'Harina 000', empresa: { nombre: 'Panadería Laferrere' } },
    });

    const r = await api.get(`/api/insumos/${harina.id}`);
    expect(r.status).toBe(200);
    const insumo = detalle(r.cuerpo);

    expect(insumo.presentaciones.map((p) => p.nombre)).toEqual(['Bolsa 25 kg', 'Bolsa 50 kg']);
    // Las cantidades son texto exacto, no number.
    expect(insumo.presentaciones[0]?.cantidadBase).toBe('25');
    expect(insumo.presentaciones[0]?.esDefault).toBe(true);

    // Vienen las dos sucursales, con el mínimo de cada una.
    expect(insumo.porSucursal.map((s) => s.sucursalCodigo)).toEqual(['CEN', 'LAF']);
    expect(insumo.porSucursal.find((s) => s.sucursalCodigo === 'CEN')?.stockMinimo).toBe('300');
    expect(insumo.porSucursal.find((s) => s.sucursalCodigo === 'LAF')?.stockMinimo).toBe('50');
  });

  it('un id que no existe responde 404', async () => {
    await entrarComo('dueno@panaderia.test');
    const r = await api.get('/api/insumos/11111111-1111-4111-8111-999999999999');
    expect(r.status).toBe(404);
  });
});

describe('POST /api/insumos — las reglas del catálogo', () => {
  it('crea un insumo y lo devuelve con sus parámetros por sucursal en cero', async () => {
    await entrarComo('dueno@panaderia.test');
    const nombre = nombreNuevo('Harina de centeno');
    const r = await crearInsumo({ nombre, codigo: nombreNuevo('COD').slice(0, 20) });

    expect(r.status).toBe(201);
    const insumo = detalle(r.cuerpo);
    expect(insumo.nombre).toBe(nombre);
    expect(insumo.activo).toBe(true);
    expect(insumo.presentaciones).toEqual([]);
    // Todas las sucursales aparecen, con mínimo cero: no hay que "agregar" una
    // sucursal antes de poder configurarla.
    expect(insumo.porSucursal).toHaveLength(2);
    for (const parametros of insumo.porSucursal) expect(parametros.stockMinimo).toBe('0');
  });

  it('REGLA: el nombre es único por empresa, sin distinguir mayúsculas', async () => {
    await entrarComo('dueno@panaderia.test');
    const r = await crearInsumo({ nombre: 'harina 000' });
    expect(r.status).toBe(409);
    expect(codigoError(r)).toBe('NOMBRE_DUPLICADO');
    expect((r.cuerpo as { mensaje: string }).mensaje).toContain('Harina 000');
  });

  it('REGLA: el código también es único por empresa', async () => {
    await entrarComo('dueno@panaderia.test');
    const r = await crearInsumo({ nombre: nombreNuevo('Otro'), codigo: 'har-000' });
    expect(r.status).toBe(409);
  });

  it('rechaza el nombre vacío indicando el campo', async () => {
    await entrarComo('dueno@panaderia.test');
    const r = await crearInsumo({ nombre: '   ' });
    expect(r.status).toBe(400);
    expect(detallesError(r)['nombre']).toBeDefined();
  });

  it('rechaza una unidad que no existe, indicando el campo', async () => {
    await entrarComo('dueno@panaderia.test');
    const r = await crearInsumo({ unidadBaseId: '11111111-1111-4111-8111-999999999999' });
    expect(r.status).toBe(400);
    expect(detallesError(r)['unidadBaseId']).toBeDefined();
  });

  it('REGLA: no se puede usar una unidad de OTRA empresa', async () => {
    // El uuid existe, pero no es de esta empresa.
    await entrarComo('dueno@panaderia.test');
    const r = await crearInsumo({ unidadBaseId: unidadAjenaId });
    expect(r.status).toBe(400);
    expect(detallesError(r)['unidadBaseId']).toBeDefined();
  });

  it('REGLA: no se puede usar una categoría de OTRA empresa', async () => {
    await entrarComo('dueno@panaderia.test');
    const r = await crearInsumo({ categoriaId: categoriaAjenaId });
    expect(r.status).toBe(400);
    expect(detallesError(r)['categoriaId']).toBeDefined();
  });

  it('el empleado no puede crear insumos', async () => {
    await entrarComo('empleado@panaderia.test');
    const r = await crearInsumo({});
    expect(r.status).toBe(403);
    expect(codigoError(r)).toBe('SIN_PERMISO');
  });

  it('el encargado sí puede: administra el catálogo', async () => {
    await entrarComo('encargado@panaderia.test');
    expect((await crearInsumo({})).status).toBe(201);
  });
});

describe('PATCH /api/insumos/:id', () => {
  it('cambia el nombre y la categoría, y deja el resto igual', async () => {
    await entrarComo('dueno@panaderia.test');
    const creado = detalle((await crearInsumo({})).cuerpo);
    const nuevoNombre = nombreNuevo('Renombrado');

    const r = await api.pedir('PATCH', `/api/insumos/${creado.id}`, {
      nombre: nuevoNombre,
      categoriaId: null,
    });

    expect(r.status).toBe(200);
    const actualizado = detalle(r.cuerpo);
    expect(actualizado.nombre).toBe(nuevoNombre);
    expect(actualizado.categoria).toBeNull();
    expect(actualizado.unidadBase.id).toBe(creado.unidadBase.id);
  });

  it('REGLA: NO cambia la unidad base, aunque se la manden', async () => {
    // Cambiarla reinterpretaría todo el historial de movimientos: los 100 "kg"
    // pasarían a ser 100 "l". El esquema de actualización no tiene ese campo,
    // así que Zod lo descarta sin siquiera llegar al servicio.
    await entrarComo('dueno@panaderia.test');
    const creado = detalle((await crearInsumo({ unidadBaseId: unidadKgId })).cuerpo);

    const r = await api.pedir('PATCH', `/api/insumos/${creado.id}`, {
      unidadBaseId: unidadLitroId,
    });

    expect(r.status).toBe(200);
    expect(detalle(r.cuerpo).unidadBase.codigo).toBe('kg');
  });

  it('no deja poner un nombre que ya usa otro insumo', async () => {
    await entrarComo('dueno@panaderia.test');
    const creado = detalle((await crearInsumo({})).cuerpo);
    const r = await api.pedir('PATCH', `/api/insumos/${creado.id}`, { nombre: 'Harina 000' });
    expect(r.status).toBe(409);
  });

  it('sí deja guardar su propio nombre sin cambios', async () => {
    await entrarComo('dueno@panaderia.test');
    const creado = detalle((await crearInsumo({})).cuerpo);
    const r = await api.pedir('PATCH', `/api/insumos/${creado.id}`, { nombre: creado.nombre });
    expect(r.status).toBe(200);
  });
});

describe('activar y desactivar', () => {
  it('REGLA: no se borra, se desactiva; y desaparece del listado por defecto', async () => {
    await entrarComo('dueno@panaderia.test');
    const creado = detalle((await crearInsumo({})).cuerpo);

    const baja = await api.post(`/api/insumos/${creado.id}/desactivar`);
    expect(baja.status).toBe(200);
    expect(detalle(baja.cuerpo).activo).toBe(false);

    // No aparece en el listado normal...
    const normal = listado((await api.get(`/api/insumos?busqueda=${creado.nombre}`)).cuerpo);
    expect(normal.items).toHaveLength(0);

    // ...pero sigue existiendo y se ve con el filtro.
    const conInactivos = listado(
      (await api.get(`/api/insumos?busqueda=${creado.nombre}&incluirInactivos=true`)).cuerpo,
    );
    expect(conInactivos.items.map((i) => i.id)).toEqual([creado.id]);

    // Y se puede volver a activar.
    const alta = await api.post(`/api/insumos/${creado.id}/activar`);
    expect(detalle(alta.cuerpo).activo).toBe(true);
  });

  it('desactivar dos veces no es un error (el doble clic pasa)', async () => {
    await entrarComo('dueno@panaderia.test');
    const creado = detalle((await crearInsumo({})).cuerpo);
    expect((await api.post(`/api/insumos/${creado.id}/desactivar`)).status).toBe(200);
    expect((await api.post(`/api/insumos/${creado.id}/desactivar`)).status).toBe(200);

    // Y solo quedó UNA entrada de auditoría, no dos.
    const eventos = await prisma.auditoria.count({
      where: { entidad: 'insumo', entidadId: creado.id, accion: 'DESACTIVAR' },
    });
    expect(eventos).toBe(1);
  });
});

describe('presentaciones', () => {
  it('crea una presentación y acepta la cantidad escrita a la argentina', async () => {
    await entrarComo('dueno@panaderia.test');
    const creado = detalle((await crearInsumo({})).cuerpo);

    const r = await api.post(`/api/insumos/${creado.id}/presentaciones`, {
      nombre: 'Pan 500 g',
      cantidadBase: '0,5', // con COMA, como se escribe acá
      esDefault: true,
    });

    expect(r.status).toBe(201);
    const presentacion = detalle(r.cuerpo).presentaciones[0];
    expect(presentacion?.nombre).toBe('Pan 500 g');
    expect(presentacion?.cantidadBase).toBe('0.5');
    expect(presentacion?.esDefault).toBe(true);
  });

  it('REGLA: hay una sola presentación por defecto; la nueva desmarca la anterior', async () => {
    await entrarComo('dueno@panaderia.test');
    const creado = detalle((await crearInsumo({})).cuerpo);

    await api.post(`/api/insumos/${creado.id}/presentaciones`, {
      nombre: 'Bolsa 25 kg',
      cantidadBase: '25',
      esDefault: true,
    });
    const r = await api.post(`/api/insumos/${creado.id}/presentaciones`, {
      nombre: 'Bolsa 50 kg',
      cantidadBase: '50',
      esDefault: true,
    });

    expect(r.status).toBe(201);
    const defaults = detalle(r.cuerpo).presentaciones.filter((p) => p.esDefault);
    expect(defaults.map((p) => p.nombre)).toEqual(['Bolsa 50 kg']);
  });

  it('REGLA: la cantidad tiene que ser mayor que cero', async () => {
    await entrarComo('dueno@panaderia.test');
    const creado = detalle((await crearInsumo({})).cuerpo);
    for (const cantidadBase of ['0', '-5']) {
      const r = await api.post(`/api/insumos/${creado.id}/presentaciones`, {
        nombre: `Rara ${cantidadBase}`,
        cantidadBase,
      });
      expect(r.status, cantidadBase).toBe(400);
      expect(detallesError(r)['cantidadBase']).toBeDefined();
    }
  });

  it('no deja dos presentaciones con el mismo nombre en el mismo insumo', async () => {
    await entrarComo('dueno@panaderia.test');
    const creado = detalle((await crearInsumo({})).cuerpo);
    const cuerpo = { nombre: 'Bolsa 25 kg', cantidadBase: '25' };
    expect((await api.post(`/api/insumos/${creado.id}/presentaciones`, cuerpo)).status).toBe(201);
    expect((await api.post(`/api/insumos/${creado.id}/presentaciones`, cuerpo)).status).toBe(409);
  });

  it('REGLA: la presentación tiene que pertenecer al insumo de la URL', async () => {
    await entrarComo('dueno@panaderia.test');
    const unoA = detalle((await crearInsumo({})).cuerpo);
    const unoB = detalle((await crearInsumo({})).cuerpo);

    const creada = detalle(
      (
        await api.post(`/api/insumos/${unoA.id}/presentaciones`, {
          nombre: 'Bolsa 25 kg',
          cantidadBase: '25',
        })
      ).cuerpo,
    ).presentaciones[0];

    // Intentamos editarla desde el OTRO insumo.
    const r = await api.pedir('PATCH', `/api/insumos/${unoB.id}/presentaciones/${creada?.id}`, {
      nombre: 'Robada',
    });
    expect(r.status).toBe(404);
  });

  it('desactivar una presentación le quita la marca de default', async () => {
    await entrarComo('dueno@panaderia.test');
    const creado = detalle((await crearInsumo({})).cuerpo);
    const presentacion = detalle(
      (
        await api.post(`/api/insumos/${creado.id}/presentaciones`, {
          nombre: 'Bolsa 25 kg',
          cantidadBase: '25',
          esDefault: true,
        })
      ).cuerpo,
    ).presentaciones[0];

    const r = await api.pedir(
      'PATCH',
      `/api/insumos/${creado.id}/presentaciones/${presentacion?.id}`,
      { activa: false },
    );

    expect(r.status).toBe(200);
    const actualizada = detalle(r.cuerpo).presentaciones[0];
    expect(actualizada?.activa).toBe(false);
    // Una presentación desactivada no puede seguir siendo la que se propone
    // al comprar.
    expect(actualizada?.esDefault).toBe(false);
  });
});

describe('parámetros por sucursal', () => {
  it('define el stock mínimo de una sucursal (upsert)', async () => {
    await entrarComo('dueno@panaderia.test');
    const creado = detalle((await crearInsumo({})).cuerpo);
    const central = creado.porSucursal.find((s) => s.sucursalCodigo === 'CEN');

    const r = await api.pedir(
      'PUT',
      `/api/insumos/${creado.id}/sucursales/${central?.sucursalId}`,
      {
        stockMinimo: '1.234,5',
        stockMaximo: '2000',
        ubicacion: 'Depósito B, estante 3',
        activo: true,
      },
    );

    expect(r.status).toBe(200);
    const parametros = detalle(r.cuerpo).porSucursal.find((s) => s.sucursalCodigo === 'CEN');
    // Aceptó el número escrito a la argentina.
    expect(parametros?.stockMinimo).toBe('1234.5');
    expect(parametros?.stockMaximo).toBe('2000');
    expect(parametros?.ubicacion).toBe('Depósito B, estante 3');
    // La otra sucursal quedó intacta.
    expect(detalle(r.cuerpo).porSucursal.find((s) => s.sucursalCodigo === 'LAF')?.stockMinimo).toBe(
      '0',
    );
  });

  it('rechaza un máximo menor que el mínimo', async () => {
    await entrarComo('dueno@panaderia.test');
    const creado = detalle((await crearInsumo({})).cuerpo);
    const central = creado.porSucursal[0];

    const r = await api.pedir(
      'PUT',
      `/api/insumos/${creado.id}/sucursales/${central?.sucursalId}`,
      {
        stockMinimo: '100',
        stockMaximo: '50',
      },
    );
    expect(r.status).toBe(400);
    expect(detallesError(r)['stockMaximo']).toBeDefined();
  });

  it('rechaza un mínimo negativo', async () => {
    await entrarComo('dueno@panaderia.test');
    const creado = detalle((await crearInsumo({})).cuerpo);
    const r = await api.pedir(
      'PUT',
      `/api/insumos/${creado.id}/sucursales/${creado.porSucursal[0]?.sucursalId}`,
      { stockMinimo: '-1' },
    );
    expect(r.status).toBe(400);
  });

  it('un empleado no puede configurar la sucursal en la que NO opera', async () => {
    // El empleado del seed solo opera en Laferrere. (Igual no tiene el permiso
    // de editar el catálogo, así que corta antes: 403 por permiso.)
    await entrarComo('empleado@panaderia.test');
    const harina = await prisma.insumo.findFirstOrThrow({
      where: { nombre: 'Harina 000', empresa: { nombre: 'Panadería Laferrere' } },
    });
    const central = await prisma.sucursal.findFirstOrThrow({ where: { codigo: 'CEN' } });

    const r = await api.pedir('PUT', `/api/insumos/${harina.id}/sucursales/${central.id}`, {
      stockMinimo: '1',
    });
    expect(r.status).toBe(403);
  });

  it('no se puede configurar una sucursal de OTRA empresa', async () => {
    await entrarComo('dueno@panaderia.test');
    const creado = detalle((await crearInsumo({})).cuerpo);
    const r = await api.pedir('PUT', `/api/insumos/${creado.id}/sucursales/${sucursalAjenaId}`, {
      stockMinimo: '1',
    });
    // requiereSucursal corta antes: esa sucursal no está entre las que este
    // usuario puede operar, porque son las de SU empresa.
    expect(r.status).toBe(403);
    expect(codigoError(r)).toBe('SUCURSAL_NO_PERMITIDA');
  });
});

describe('GET /api/categorias', () => {
  it('lista las categorías de la empresa', async () => {
    await entrarComo('empleado@panaderia.test');
    const r = await api.get('/api/categorias');
    expect(r.status).toBe(200);
    const categorias = r.cuerpo as Categoria[];
    expect(categorias.map((c) => c.nombre)).toContain('Harinas');
  });

  it('el empleado no puede crear categorías', async () => {
    await entrarComo('empleado@panaderia.test');
    expect((await api.post('/api/categorias', { nombre: 'Nueva' })).status).toBe(403);
  });

  it('no deja crear una categoría repetida (sin distinguir mayúsculas)', async () => {
    await entrarComo('dueno@panaderia.test');
    const r = await api.post('/api/categorias', { nombre: 'HARINAS' });
    expect(r.status).toBe(409);
  });
});
