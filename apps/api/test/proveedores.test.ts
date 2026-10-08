import type {
  InsumoDetalle,
  ProveedorDeInsumo,
  ProveedorDetalle,
  ProveedorResumen,
} from '@panaderia/shared';
import { ListaProveedoresDeInsumoSchema, ListaProveedoresSchema } from '@panaderia/shared';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { PASSWORD_DEV } from '../prisma/semilla.js';
import { cerrarConexiones, prisma } from '../src/lib/db.js';
import { reiniciarLimitadores } from '../src/modules/auth/service.js';
import { ClienteHttp } from './cliente-http.js';

let api: ClienteHttp;
let unidadKgId: string;
/** "Harina 000" de Laferrere: el insumo que tiene DOS proveedores. */
let harina000Id: string;
let harinaBolsa25Id: string;
/** Una presentación que se llama IGUAL pero es de OTRO insumo (Azúcar). */
let azucarBolsa25Id: string;
let insumoAjenoId: string;

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

  const harina = await prisma.insumo.findFirstOrThrow({
    where: { empresaId: laferrere.id, nombre: 'Harina 000' },
    include: { presentaciones: true },
  });
  harina000Id = harina.id;
  harinaBolsa25Id = harina.presentaciones.find((p) => p.nombre === 'Bolsa 25 kg')?.id ?? '';

  const azucar = await prisma.insumo.findFirstOrThrow({
    where: { empresaId: laferrere.id, nombre: 'Azúcar' },
    include: { presentaciones: true },
  });
  // Ojo: esta presentación se llama "Bolsa 25 kg", igual que la de la harina.
  // Es justo el caso que haría pasar desapercibido el bug.
  azucarBolsa25Id = azucar.presentaciones.find((p) => p.nombre === 'Bolsa 25 kg')?.id ?? '';

  insumoAjenoId = (
    await prisma.insumo.findFirstOrThrow({ where: { empresaId: vecina.id, nombre: 'Harina 000' } })
  ).id;
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

function lista(cuerpo: unknown): ProveedorResumen[] {
  return cuerpo as ProveedorResumen[];
}
function detalle(cuerpo: unknown): ProveedorDetalle {
  return cuerpo as ProveedorDetalle;
}
function espejo(cuerpo: unknown): ProveedorDeInsumo[] {
  return cuerpo as ProveedorDeInsumo[];
}
function codigoError(respuesta: { cuerpo: unknown }): string {
  return (respuesta.cuerpo as { codigo: string }).codigo;
}
function mensajeError(respuesta: { cuerpo: unknown }): string {
  return (respuesta.cuerpo as { mensaje: string }).mensaje;
}
function detallesError(respuesta: { cuerpo: unknown }): Record<string, string> {
  return (respuesta.cuerpo as { detalles: Record<string, string> }).detalles;
}

/** Nombre único por test, para que una corrida no choque con otra. */
function nombreNuevo(prefijo: string): string {
  return `${prefijo} ${String(Date.now())}-${String(Math.floor(Math.random() * 100000))}`;
}

async function crearProveedor(datos: Record<string, unknown> = {}) {
  return api.post('/api/proveedores', { nombre: nombreNuevo('Proveedor'), ...datos });
}

/**
 * Un insumo nuevo para cada prueba que toque la marca de preferido.
 *
 * Importa: solo hay UN preferido por insumo, así que si todos los tests
 * marcaran preferidos sobre "Harina 000" se pisarían entre ellos y el
 * resultado dependería del orden. Con un insumo propio, cada test es
 * independiente.
 */
async function crearInsumoDePrueba(): Promise<{ id: string; presentacionId: string }> {
  const creado = await api.post('/api/insumos', {
    nombre: nombreNuevo('Insumo prov'),
    codigo: null,
    categoriaId: null,
    unidadBaseId: unidadKgId,
  });
  expect(creado.status).toBe(201);
  const insumo = creado.cuerpo as InsumoDetalle;

  const conPresentacion = await api.post(`/api/insumos/${insumo.id}/presentaciones`, {
    nombre: 'Bolsa 25 kg',
    cantidadBase: '25',
    esDefault: true,
  });
  expect(conPresentacion.status).toBe(201);
  const presentacion = (conPresentacion.cuerpo as InsumoDetalle).presentaciones[0];

  return { id: insumo.id, presentacionId: presentacion?.id ?? '' };
}

// ===========================================================================

describe('GET /api/proveedores', () => {
  it('sin sesión responde 401', async () => {
    expect((await api.get('/api/proveedores')).status).toBe(401);
  });

  it('REGLA: el empleado NO puede ver proveedores, porque ahí hay precios', async () => {
    // Es la diferencia con los demás catálogos. Supuesto C-23 de PLAN.md.
    await entrarComo('empleado@panaderia.test');
    const r = await api.get('/api/proveedores');
    expect(r.status).toBe(403);
    expect(codigoError(r)).toBe('SIN_PERMISO');
  });

  it('lista los proveedores de la empresa con cuántos insumos le compramos', async () => {
    await entrarComo('dueno@panaderia.test');
    const r = await api.get('/api/proveedores');
    expect(r.status).toBe(200);
    expect(ListaProveedoresSchema.safeParse(r.cuerpo).success).toBe(true);

    const proveedores = lista(r.cuerpo);
    const molino = proveedores.find((p) => p.nombre === 'Molino San Jorge');
    expect(molino).toBeDefined();
    expect(molino?.cuit).toBe('30712345678');
    expect(molino?.diasEntrega).toBe(2);
    expect(molino?.cantidadInsumos).toBe(4);

    // La Esquina entrega en el DÍA: cero, que no es lo mismo que null.
    const esquina = proveedores.find((p) => p.nombre === 'Distribuidora La Esquina');
    expect(esquina?.diasEntrega).toBe(0);
    // Envases Rápidos no tiene plazo cargado.
    const envases = proveedores.find((p) => p.nombre === 'Envases Rápidos');
    expect(envases?.diasEntrega).toBeNull();
  });

  it('busca por nombre sin distinguir mayúsculas, y por CUIT', async () => {
    await entrarComo('dueno@panaderia.test');
    const porNombre = lista((await api.get('/api/proveedores?busqueda=MOLINO')).cuerpo);
    expect(porNombre.map((p) => p.nombre)).toEqual(['Molino San Jorge']);

    const porCuit = lista((await api.get('/api/proveedores?busqueda=30712345678')).cuerpo);
    expect(porCuit.map((p) => p.nombre)).toEqual(['Molino San Jorge']);
  });

  it('el encargado también los ve: es quien llama al proveedor', async () => {
    await entrarComo('encargado@panaderia.test');
    expect((await api.get('/api/proveedores')).status).toBe(200);
  });
});

describe('GET /api/proveedores/:id', () => {
  it('devuelve la ficha con sus insumos, el preferido primero', async () => {
    await entrarComo('dueno@panaderia.test');
    const molino = lista((await api.get('/api/proveedores?busqueda=Molino')).cuerpo)[0];

    const r = await api.get(`/api/proveedores/${molino?.id ?? ''}`);
    expect(r.status).toBe(200);
    const ficha = detalle(r.cuerpo);

    expect(ficha.insumos).toHaveLength(4);
    // Los preferidos van arriba (es el orden del repositorio).
    expect(ficha.insumos[0]?.esPreferido).toBe(true);

    const harina = ficha.insumos.find((fila) => fila.insumo.nombre === 'Harina 000');
    expect(harina?.presentacion?.nombre).toBe('Bolsa 25 kg');
    // El precio viaja como TEXTO exacto, no como number.
    expect(harina?.ultimoPrecio).toBe('18500');
    expect(harina?.codigoProveedor).toBe('H000-25');
    expect(harina?.insumo.unidadBaseCodigo).toBe('kg');
    // Y con su fecha: un precio sin fecha no sirve.
    expect(harina?.ultimoPrecioAt).not.toBeNull();
    expect(new Date(harina?.ultimoPrecioAt ?? '').getTime()).not.toBeNaN();
  });

  it('un insumo cargado sin precio queda en null, que no es cero', async () => {
    await entrarComo('dueno@panaderia.test');
    const lacteos = lista((await api.get('/api/proveedores?busqueda=Lácteos')).cuerpo)[0];
    const ficha = detalle((await api.get(`/api/proveedores/${lacteos?.id ?? ''}`)).cuerpo);

    const huevo = ficha.insumos.find((fila) => fila.insumo.nombre === 'Huevo fresco');
    expect(huevo?.ultimoPrecio).toBeNull();
    expect(huevo?.ultimoPrecioAt).toBeNull();
  });

  it('un id que no existe responde 404', async () => {
    await entrarComo('dueno@panaderia.test');
    const r = await api.get('/api/proveedores/11111111-1111-4111-8111-999999999999');
    expect(r.status).toBe(404);
  });

  it('un id mal formado responde 400, no 500', async () => {
    await entrarComo('dueno@panaderia.test');
    const r = await api.get('/api/proveedores/no-es-uuid');
    expect(r.status).toBe(400);
  });
});

describe('POST /api/proveedores', () => {
  it('crea un proveedor y normaliza el CUIT', async () => {
    await entrarComo('dueno@panaderia.test');
    const nombre = nombreNuevo('Molino Nuevo');
    const r = await crearProveedor({
      nombre,
      cuit: '30-11223344-5',
      email: 'ventas@nuevo.test',
      diasEntrega: '3',
      razonSocial: '',
    });

    expect(r.status).toBe(201);
    const creado = detalle(r.cuerpo);
    expect(creado.nombre).toBe(nombre);
    expect(creado.cuit).toBe('30112233445'); // sin guiones
    expect(creado.diasEntrega).toBe(3);
    expect(creado.razonSocial).toBeNull(); // la cadena vacía se guarda como null
    expect(creado.activo).toBe(true);
    expect(creado.insumos).toEqual([]);
  });

  it('REGLA: el nombre es único por empresa, sin distinguir mayúsculas', async () => {
    await entrarComo('dueno@panaderia.test');
    const r = await crearProveedor({ nombre: 'molino san jorge' });
    expect(r.status).toBe(409);
    expect(codigoError(r)).toBe('NOMBRE_DUPLICADO');
    // El mensaje devuelve el nombre COMO ESTÁ GUARDADO, para que se entienda.
    expect(mensajeError(r)).toContain('Molino San Jorge');
  });

  it('REGLA: el CUIT es único por empresa (sería el mismo proveedor dos veces)', async () => {
    await entrarComo('dueno@panaderia.test');
    const r = await crearProveedor({ cuit: '30-71234567-8' });
    expect(r.status).toBe(409);
    expect(mensajeError(r)).toContain('Molino San Jorge');
  });

  it('rechaza un email inválido y un CUIT corto, indicando el campo', async () => {
    await entrarComo('dueno@panaderia.test');
    const r = await crearProveedor({ email: 'pepe@', cuit: '123' });
    expect(r.status).toBe(400);
    expect(detallesError(r)['email']).toBeDefined();
    expect(detallesError(r)['cuit']).toBeDefined();
  });

  it('el empleado no puede crear proveedores', async () => {
    await entrarComo('empleado@panaderia.test');
    expect((await crearProveedor()).status).toBe(403);
  });

  it('el encargado sí puede', async () => {
    await entrarComo('encargado@panaderia.test');
    expect((await crearProveedor()).status).toBe(201);
  });
});

describe('PATCH /api/proveedores/:id', () => {
  it('cambia solo lo que viene y borra lo que viene en null', async () => {
    await entrarComo('dueno@panaderia.test');
    const creado = detalle((await crearProveedor({ razonSocial: 'Vieja S.A.' })).cuerpo);

    const r = await api.pedir('PATCH', `/api/proveedores/${creado.id}`, {
      telefono: '11 1111-1111',
      razonSocial: null,
    });

    expect(r.status).toBe(200);
    const actualizado = detalle(r.cuerpo);
    expect(actualizado.telefono).toBe('11 1111-1111');
    expect(actualizado.razonSocial).toBeNull();
    expect(actualizado.nombre).toBe(creado.nombre); // no vino, no se toca
  });

  it('un PATCH vacío no rompe ni genera auditoría', async () => {
    await entrarComo('dueno@panaderia.test');
    const creado = detalle((await crearProveedor()).cuerpo);

    const r = await api.pedir('PATCH', `/api/proveedores/${creado.id}`, {});
    expect(r.status).toBe(200);

    const eventos = await prisma.auditoria.count({
      where: { entidad: 'proveedor', entidadId: creado.id, accion: 'ACTUALIZAR' },
    });
    expect(eventos).toBe(0);
  });

  it('no deja poner el nombre de otro proveedor', async () => {
    await entrarComo('dueno@panaderia.test');
    const creado = detalle((await crearProveedor()).cuerpo);
    const r = await api.pedir('PATCH', `/api/proveedores/${creado.id}`, {
      nombre: 'Molino San Jorge',
    });
    expect(r.status).toBe(409);
  });

  it('sí deja guardar su propio nombre sin cambios', async () => {
    await entrarComo('dueno@panaderia.test');
    const creado = detalle((await crearProveedor()).cuerpo);
    const r = await api.pedir('PATCH', `/api/proveedores/${creado.id}`, {
      nombre: creado.nombre,
      cuit: creado.cuit,
    });
    expect(r.status).toBe(200);
  });
});

describe('activar y desactivar un proveedor', () => {
  it('REGLA: no se borra, se desactiva; y desaparece del listado por defecto', async () => {
    await entrarComo('dueno@panaderia.test');
    const creado = detalle((await crearProveedor()).cuerpo);

    const baja = await api.post(`/api/proveedores/${creado.id}/desactivar`);
    expect(baja.status).toBe(200);
    expect(detalle(baja.cuerpo).activo).toBe(false);

    const normal = lista((await api.get(`/api/proveedores?busqueda=${creado.nombre}`)).cuerpo);
    expect(normal).toHaveLength(0);

    const conInactivos = lista(
      (await api.get(`/api/proveedores?busqueda=${creado.nombre}&incluirInactivos=true`)).cuerpo,
    );
    expect(conInactivos.map((p) => p.id)).toEqual([creado.id]);

    const alta = await api.post(`/api/proveedores/${creado.id}/activar`);
    expect(detalle(alta.cuerpo).activo).toBe(true);
  });

  it('desactivar dos veces no es un error (el doble clic pasa)', async () => {
    await entrarComo('dueno@panaderia.test');
    const creado = detalle((await crearProveedor()).cuerpo);
    expect((await api.post(`/api/proveedores/${creado.id}/desactivar`)).status).toBe(200);
    expect((await api.post(`/api/proveedores/${creado.id}/desactivar`)).status).toBe(200);

    const eventos = await prisma.auditoria.count({
      where: { entidad: 'proveedor', entidadId: creado.id, accion: 'DESACTIVAR' },
    });
    expect(eventos).toBe(1);
  });

  it('REGLA: desactivar el proveedor le quita la marca de preferido', async () => {
    // Si no, la vista de reposición agruparía la compra bajo un proveedor al
    // que ya no le compramos.
    await entrarComo('dueno@panaderia.test');
    const insumo = await crearInsumoDePrueba();
    const proveedor = detalle((await crearProveedor()).cuerpo);

    const asociado = await api.post(`/api/proveedores/${proveedor.id}/insumos`, {
      insumoId: insumo.id,
      esPreferido: true,
    });
    expect(detalle(asociado.cuerpo).insumos[0]?.esPreferido).toBe(true);

    const baja = await api.post(`/api/proveedores/${proveedor.id}/desactivar`);
    expect(detalle(baja.cuerpo).insumos[0]?.esPreferido).toBe(false);
    // La asociación sigue existiendo: si se reactiva, su catálogo está ahí.
    expect(detalle(baja.cuerpo).insumos).toHaveLength(1);
  });
});

describe('POST /api/proveedores/:id/insumos — asociar un insumo', () => {
  it('asocia un insumo con su presentación y su precio', async () => {
    await entrarComo('dueno@panaderia.test');
    const proveedor = detalle((await crearProveedor()).cuerpo);

    const r = await api.post(`/api/proveedores/${proveedor.id}/insumos`, {
      insumoId: harina000Id,
      presentacionId: harinaBolsa25Id,
      codigoProveedor: 'H-25',
      ultimoPrecio: '18.750,50', // escrito a la argentina
    });

    expect(r.status).toBe(201);
    const fila = detalle(r.cuerpo).insumos[0];
    expect(fila?.insumo.nombre).toBe('Harina 000');
    expect(fila?.presentacion?.nombre).toBe('Bolsa 25 kg');
    expect(fila?.presentacion?.cantidadBase).toBe('25');
    expect(fila?.ultimoPrecio).toBe('18750.5');
    expect(fila?.codigoProveedor).toBe('H-25');
    // La fecha la pone el SERVIDOR, no el formulario.
    expect(fila?.ultimoPrecioAt).not.toBeNull();
  });

  it('sin presentación significa "lo vende en la unidad base"', async () => {
    await entrarComo('dueno@panaderia.test');
    const proveedor = detalle((await crearProveedor()).cuerpo);

    const r = await api.post(`/api/proveedores/${proveedor.id}/insumos`, {
      insumoId: harina000Id,
      presentacionId: '', // un <select> sin elegir manda la cadena vacía
    });

    expect(r.status).toBe(201);
    expect(detalle(r.cuerpo).insumos[0]?.presentacion).toBeNull();
  });

  it('REGLA ⭐: la presentación tiene que ser DE ESE insumo', async () => {
    // El caso que la base no puede evitar: "Bolsa 25 kg" existe, pero es la
    // del Azúcar. Sin este chequeo quedaría guardado "le compro harina en
    // bolsas de azúcar" y la Fase 8 convertiría con el factor equivocado.
    await entrarComo('dueno@panaderia.test');
    const proveedor = detalle((await crearProveedor()).cuerpo);

    const r = await api.post(`/api/proveedores/${proveedor.id}/insumos`, {
      insumoId: harina000Id,
      presentacionId: azucarBolsa25Id,
    });

    expect(r.status).toBe(400);
    expect(codigoError(r)).toBe('DATOS_INVALIDOS');
    expect(detallesError(r)['presentacionId']).toContain('Harina 000');
  });

  it('REGLA: no se puede asociar un insumo inactivo', async () => {
    await entrarComo('dueno@panaderia.test');
    const insumo = await crearInsumoDePrueba();
    await api.post(`/api/insumos/${insumo.id}/desactivar`);
    const proveedor = detalle((await crearProveedor()).cuerpo);

    const r = await api.post(`/api/proveedores/${proveedor.id}/insumos`, { insumoId: insumo.id });
    expect(r.status).toBe(400);
    expect(detallesError(r)['insumoId']).toContain('inactivo');
  });

  it('REGLA: no se le pueden agregar insumos a un proveedor inactivo', async () => {
    await entrarComo('dueno@panaderia.test');
    const proveedor = detalle((await crearProveedor()).cuerpo);
    await api.post(`/api/proveedores/${proveedor.id}/desactivar`);

    const r = await api.post(`/api/proveedores/${proveedor.id}/insumos`, { insumoId: harina000Id });
    expect(r.status).toBe(400);
  });

  it('REGLA: el mismo insumo no se puede asociar dos veces al mismo proveedor', async () => {
    // Si no, habría dos precios "últimos" y ninguno sería el último.
    await entrarComo('dueno@panaderia.test');
    const proveedor = detalle((await crearProveedor()).cuerpo);
    await api.post(`/api/proveedores/${proveedor.id}/insumos`, { insumoId: harina000Id });

    const r = await api.post(`/api/proveedores/${proveedor.id}/insumos`, { insumoId: harina000Id });
    expect(r.status).toBe(409);
    expect(codigoError(r)).toBe('NOMBRE_DUPLICADO');
  });

  it('REGLA ⭐: hay UN solo proveedor preferido por insumo; el nuevo desmarca al anterior', async () => {
    await entrarComo('dueno@panaderia.test');
    const insumo = await crearInsumoDePrueba();
    const primero = detalle((await crearProveedor()).cuerpo);
    const segundo = detalle((await crearProveedor()).cuerpo);

    await api.post(`/api/proveedores/${primero.id}/insumos`, {
      insumoId: insumo.id,
      esPreferido: true,
    });
    const r = await api.post(`/api/proveedores/${segundo.id}/insumos`, {
      insumoId: insumo.id,
      esPreferido: true,
    });
    expect(r.status).toBe(201);

    // Visto desde el insumo: hay dos proveedores y UNO preferido, el segundo.
    const vistos = espejo((await api.get(`/api/insumos/${insumo.id}/proveedores`)).cuerpo);
    expect(vistos).toHaveLength(2);
    const preferidos = vistos.filter((fila) => fila.esPreferido);
    expect(preferidos).toHaveLength(1);
    expect(preferidos[0]?.proveedor.id).toBe(segundo.id);
  });

  it('rechaza un insumo que no existe, indicando el campo', async () => {
    await entrarComo('dueno@panaderia.test');
    const proveedor = detalle((await crearProveedor()).cuerpo);
    const r = await api.post(`/api/proveedores/${proveedor.id}/insumos`, {
      insumoId: '11111111-1111-4111-8111-999999999999',
    });
    expect(r.status).toBe(400);
    expect(detallesError(r)['insumoId']).toBeDefined();
  });

  it('el empleado no puede asociar nada', async () => {
    await entrarComo('encargado@panaderia.test');
    const proveedor = detalle((await crearProveedor()).cuerpo);
    api.olvidarCookies();
    reiniciarLimitadores();

    await entrarComo('empleado@panaderia.test');
    const r = await api.post(`/api/proveedores/${proveedor.id}/insumos`, { insumoId: harina000Id });
    expect(r.status).toBe(403);
  });
});

describe('PATCH /api/proveedores/:id/insumos/:asociacionId', () => {
  /** Deja un proveedor nuevo con un insumo nuevo asociado, y devuelve los dos. */
  async function prepararAsociacion(datos: Record<string, unknown> = {}) {
    const insumo = await crearInsumoDePrueba();
    const proveedor = detalle((await crearProveedor()).cuerpo);
    const r = await api.post(`/api/proveedores/${proveedor.id}/insumos`, {
      insumoId: insumo.id,
      ...datos,
    });
    expect(r.status).toBe(201);
    return { insumo, proveedorId: proveedor.id, asociacion: detalle(r.cuerpo).insumos[0] };
  }

  it('cargar un precio actualiza también su fecha', async () => {
    await entrarComo('dueno@panaderia.test');
    const { proveedorId, asociacion } = await prepararAsociacion();
    expect(asociacion?.ultimoPrecio).toBeNull();

    const r = await api.pedir(
      'PATCH',
      `/api/proveedores/${proveedorId}/insumos/${asociacion?.id ?? ''}`,
      { ultimoPrecio: '21.000,25' },
    );

    expect(r.status).toBe(200);
    const fila = detalle(r.cuerpo).insumos[0];
    expect(fila?.ultimoPrecio).toBe('21000.25');
    expect(fila?.ultimoPrecioAt).not.toBeNull();
  });

  it('borrar el precio borra también su fecha (lo exige un CHECK de la base)', async () => {
    await entrarComo('dueno@panaderia.test');
    const { proveedorId, asociacion } = await prepararAsociacion({ ultimoPrecio: '100' });
    expect(asociacion?.ultimoPrecioAt).not.toBeNull();

    const r = await api.pedir(
      'PATCH',
      `/api/proveedores/${proveedorId}/insumos/${asociacion?.id ?? ''}`,
      { ultimoPrecio: null },
    );

    expect(r.status).toBe(200);
    const fila = detalle(r.cuerpo).insumos[0];
    expect(fila?.ultimoPrecio).toBeNull();
    expect(fila?.ultimoPrecioAt).toBeNull();
  });

  it('REGLA: desactivar la relación le quita la marca de preferido', async () => {
    await entrarComo('dueno@panaderia.test');
    const { proveedorId, asociacion } = await prepararAsociacion({ esPreferido: true });

    const r = await api.pedir(
      'PATCH',
      `/api/proveedores/${proveedorId}/insumos/${asociacion?.id ?? ''}`,
      { activo: false },
    );

    expect(r.status).toBe(200);
    const fila = detalle(r.cuerpo).insumos[0];
    expect(fila?.activo).toBe(false);
    expect(fila?.esPreferido).toBe(false);
  });

  it('REGLA: una relación inactiva no puede volverse preferida sin reactivarla', async () => {
    await entrarComo('dueno@panaderia.test');
    const { proveedorId, asociacion } = await prepararAsociacion();
    const ruta = `/api/proveedores/${proveedorId}/insumos/${asociacion?.id ?? ''}`;
    await api.pedir('PATCH', ruta, { activo: false });

    const r = await api.pedir('PATCH', ruta, { esPreferido: true });
    expect(r.status).toBe(400);
    expect(detallesError(r)['esPreferido']).toBeDefined();

    // Pero las dos cosas juntas sí: reactivar y marcar como preferida.
    const juntas = await api.pedir('PATCH', ruta, { activo: true, esPreferido: true });
    expect(juntas.status).toBe(200);
    expect(detalle(juntas.cuerpo).insumos[0]?.esPreferido).toBe(true);
  });

  it('REGLA: la presentación nueva también tiene que ser de ese insumo', async () => {
    await entrarComo('dueno@panaderia.test');
    const { proveedorId, asociacion } = await prepararAsociacion();

    const r = await api.pedir(
      'PATCH',
      `/api/proveedores/${proveedorId}/insumos/${asociacion?.id ?? ''}`,
      { presentacionId: azucarBolsa25Id },
    );

    expect(r.status).toBe(400);
    expect(detallesError(r)['presentacionId']).toBeDefined();
  });

  it('REGLA: no cambia el insumo, aunque se lo manden', async () => {
    // El campo NO existe en el esquema de actualización: Zod lo descarta.
    await entrarComo('dueno@panaderia.test');
    const { insumo, proveedorId, asociacion } = await prepararAsociacion();

    const r = await api.pedir(
      'PATCH',
      `/api/proveedores/${proveedorId}/insumos/${asociacion?.id ?? ''}`,
      { insumoId: harina000Id, codigoProveedor: '9999' },
    );

    expect(r.status).toBe(200);
    const fila = detalle(r.cuerpo).insumos[0];
    expect(fila?.insumo.id).toBe(insumo.id);
    expect(fila?.codigoProveedor).toBe('9999');
  });

  it('una asociación de OTRO proveedor responde 404', async () => {
    await entrarComo('dueno@panaderia.test');
    const propia = await prepararAsociacion();
    const otro = detalle((await crearProveedor()).cuerpo);

    const r = await api.pedir(
      'PATCH',
      `/api/proveedores/${otro.id}/insumos/${propia.asociacion?.id ?? ''}`,
      { codigoProveedor: 'robado' },
    );
    expect(r.status).toBe(404);
  });
});

describe('GET /api/insumos/:insumoId/proveedores — la vista espejo', () => {
  it('desde el insumo se ven sus proveedores, el preferido primero', async () => {
    await entrarComo('dueno@panaderia.test');
    const r = await api.get(`/api/insumos/${harina000Id}/proveedores`);

    expect(r.status).toBe(200);
    expect(ListaProveedoresDeInsumoSchema.safeParse(r.cuerpo).success).toBe(true);

    const proveedores = espejo(r.cuerpo);
    // La semilla le compra "Harina 000" a DOS proveedores.
    expect(proveedores.length).toBeGreaterThanOrEqual(2);
    expect(proveedores[0]?.esPreferido).toBe(true);
    expect(proveedores[0]?.proveedor.nombre).toBe('Molino San Jorge');
    expect(proveedores[0]?.proveedor.diasEntrega).toBe(2);

    // Y se puede comparar: el de respaldo es más caro pero entrega en el día.
    const esquina = proveedores.find(
      (fila) => fila.proveedor.nombre === 'Distribuidora La Esquina',
    );
    expect(esquina?.esPreferido).toBe(false);
    expect(esquina?.proveedor.diasEntrega).toBe(0);
    expect(esquina?.presentacion?.nombre).toBe('Bolsa 50 kg');
  });

  it('un insumo sin proveedores devuelve una lista vacía', async () => {
    await entrarComo('dueno@panaderia.test');
    const insumo = await crearInsumoDePrueba();
    const r = await api.get(`/api/insumos/${insumo.id}/proveedores`);
    expect(r.status).toBe(200);
    expect(espejo(r.cuerpo)).toEqual([]);
  });

  it('un insumo que no existe responde 404, no una lista vacía', async () => {
    await entrarComo('dueno@panaderia.test');
    const r = await api.get('/api/insumos/11111111-1111-4111-8111-999999999999/proveedores');
    expect(r.status).toBe(404);
  });

  it('el empleado tampoco puede verla: también lleva precios', async () => {
    await entrarComo('empleado@panaderia.test');
    const r = await api.get(`/api/insumos/${harina000Id}/proveedores`);
    expect(r.status).toBe(403);
  });

  it('un insumo de OTRA empresa responde 404', async () => {
    await entrarComo('dueno@panaderia.test');
    const r = await api.get(`/api/insumos/${insumoAjenoId}/proveedores`);
    expect(r.status).toBe(404);
  });
});
