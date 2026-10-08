// CAPA 3 — SERVICIO: las reglas del negocio. No sabe que existe HTTP.
import {
  type ActualizarProveedorInput,
  type ActualizarProveedorInsumoInput,
  compararCostos,
  costoPorUnidadBase,
  type CrearProveedorInput,
  type CrearProveedorInsumoInput,
  type FiltroProveedores,
  type InsumoDeProveedor,
  type ProveedorDeInsumo,
  type ProveedorDetalle,
  type ProveedorResumen,
} from '@panaderia/shared';

import { registrarAuditoria } from '../../lib/auditoria.js';
import type { Contexto } from '../../lib/contexto.js';
import { prisma } from '../../lib/db.js';
import { errores } from '../../lib/errores.js';
import * as repo from './repo.js';

type FilaProveedor = NonNullable<Awaited<ReturnType<typeof repo.buscar>>>;
type FilaAsociacion = Awaited<ReturnType<typeof repo.asociacionesDeProveedor>>[number];

/** Campos que el PATCH de proveedor puede tocar. */
type CambiosProveedor = {
  nombre?: string;
  razonSocial?: string | null;
  cuit?: string | null;
  email?: string | null;
  telefono?: string | null;
  direccion?: string | null;
  contactoNombre?: string | null;
  diasEntrega?: number | null;
  notas?: string | null;
};

// ===========================================================================
// Traducción de filas de la base a objetos del dominio
// ===========================================================================

function aResumen(fila: FilaProveedor): ProveedorResumen {
  return {
    id: fila.id,
    nombre: fila.nombre,
    razonSocial: fila.razonSocial,
    cuit: fila.cuit,
    email: fila.email,
    telefono: fila.telefono,
    direccion: fila.direccion,
    contactoNombre: fila.contactoNombre,
    diasEntrega: fila.diasEntrega,
    notas: fila.notas,
    activo: fila.activo,
    cantidadInsumos: fila._count.insumos,
  };
}

/**
 * La parte de la asociación que es igual en las dos vistas.
 *
 * Los decimales salen como TEXTO (ver docs/aprendizaje/10) y las fechas como
 * ISO 8601 en UTC: la pantalla las muestra en hora de Argentina.
 */
function aAsociacionComun(fila: FilaAsociacion) {
  return {
    id: fila.id,
    presentacion:
      fila.presentacion === null
        ? null
        : {
            id: fila.presentacion.id,
            nombre: fila.presentacion.nombre,
            cantidadBase: fila.presentacion.cantidadBase.toString(),
          },
    codigoProveedor: fila.codigoProveedor,
    ultimoPrecio: fila.ultimoPrecio?.toString() ?? null,
    ultimoPrecioAt: fila.ultimoPrecioAt?.toISOString() ?? null,
    esPreferido: fila.esPreferido,
    activo: fila.activo,
  };
}

/** Vista DESDE el proveedor: "qué insumos le compro". */
function aInsumoDeProveedor(fila: FilaAsociacion): InsumoDeProveedor {
  return {
    ...aAsociacionComun(fila),
    insumo: {
      id: fila.insumo.id,
      nombre: fila.insumo.nombre,
      activo: fila.insumo.activo,
      unidadBaseCodigo: fila.insumo.unidadBase.codigo,
    },
  };
}

/**
 * El último precio llevado a UNA unidad base.
 *
 * El precio se guarda por presentación ("la bolsa de 50 kg, $39.500"), pero
 * para comparar dos proveedores hay que llevarlos a la misma vara: el kilo.
 */
function costoBaseDe(fila: FilaAsociacion): string | null {
  if (fila.ultimoPrecio === null) return null;
  const factor = fila.presentacion?.cantidadBase.toString() ?? '1';
  return costoPorUnidadBase(fila.ultimoPrecio.toString(), factor).toString();
}

/**
 * Vista DESDE el insumo: "quién me lo provee", con la comparación de precios
 * que pidió el cliente (C-6): cuál sale más barato y cuál más caro.
 *
 * Solo se comparan las asociaciones ACTIVAS: un proveedor dado de baja no es
 * una opción de compra, aunque haya sido el más barato.
 */
function aProveedoresDeInsumo(filas: readonly FilaAsociacion[]): ProveedorDeInsumo[] {
  const costos = filas.map((fila) => (fila.activo ? costoBaseDe(fila) : null));
  const marcas = compararCostos(costos);

  return filas.map((fila, indice) => ({
    ...aAsociacionComun(fila),
    proveedor: fila.proveedor,
    costoBase: costoBaseDe(fila),
    comparacion: marcas[indice] ?? null,
  }));
}

// ===========================================================================
// Consultas
// ===========================================================================

export async function listar(
  ctx: Contexto,
  filtro: FiltroProveedores,
): Promise<ProveedorResumen[]> {
  const filas = await repo.listar(ctx.empresaId, filtro.busqueda, filtro.incluirInactivos);
  return filas.map(aResumen);
}

export async function obtenerDetalle(
  ctx: Contexto,
  proveedorId: string,
): Promise<ProveedorDetalle> {
  const fila = await repo.buscar(ctx.empresaId, proveedorId);
  // Si es de otra empresa, para este usuario NO EXISTE: 404 y no 403.
  if (!fila) throw errores.noEncontrado('El proveedor');

  const asociaciones = await repo.asociacionesDeProveedor(ctx.empresaId, proveedorId);
  return { ...aResumen(fila), insumos: asociaciones.map(aInsumoDeProveedor) };
}

/** La vista espejo: los proveedores de un insumo, para su ficha. */
export async function listarDeInsumo(
  ctx: Contexto,
  insumoId: string,
): Promise<ProveedorDeInsumo[]> {
  // Verificamos que el insumo sea de la empresa ANTES de listar: si no,
  // pedir los proveedores de un insumo ajeno devolvería una lista vacía
  // (correcto) pero sin decir que ese insumo no existe para este usuario.
  const insumo = await repo.buscarInsumoConPresentaciones(ctx.empresaId, insumoId);
  if (!insumo) throw errores.noEncontrado('El insumo');

  const asociaciones = await repo.asociacionesDeInsumo(ctx.empresaId, insumoId);
  return aProveedoresDeInsumo(asociaciones);
}

// ===========================================================================
// Reglas compartidas
// ===========================================================================

async function exigirNombreLibre(ctx: Contexto, nombre: string, excluirId?: string): Promise<void> {
  const existente = await repo.buscarPorNombre(ctx.empresaId, nombre, excluirId);
  if (existente) throw errores.nombreDuplicado(`el proveedor "${existente.nombre}"`);
}

/**
 * Dos proveedores con el mismo CUIT son el mismo proveedor cargado dos veces,
 * y eso partiría el historial de precios en dos. El CUIT ya llega normalizado
 * sin guiones por el esquema Zod, así que la comparación es exacta.
 */
async function exigirCuitLibre(ctx: Contexto, cuit: string, excluirId?: string): Promise<void> {
  const existente = await repo.buscarPorCuit(ctx.empresaId, cuit, excluirId);
  if (existente) {
    throw errores.nombreDuplicado(`un proveedor con ese CUIT ("${existente.nombre}")`);
  }
}

async function exigirProveedorDeLaEmpresa(
  ctx: Contexto,
  proveedorId: string,
): Promise<FilaProveedor> {
  const fila = await repo.buscar(ctx.empresaId, proveedorId);
  if (!fila) throw errores.noEncontrado('El proveedor');
  return fila;
}

/**
 * LAS DOS VALIDACIONES CRUZADAS DE LA FASE.
 *
 * 1. El insumo tiene que ser de la empresa y estar ACTIVO. Asociar un insumo
 *    dado de baja dejaría una línea de compra para algo que ya no se usa.
 * 2. La presentación tiene que ser DE ESE insumo. La base no puede expresarlo:
 *    la clave foránea solo verifica que el id exista en presentacion_insumo,
 *    no de quién es. Sin este chequeo se podría guardar "le compro harina en
 *    bidones de 10 litros", y la Fase 8 convertiría con el factor equivocado.
 */
async function exigirInsumoYPresentacion(
  ctx: Contexto,
  insumoId: string,
  presentacionId: string | null,
): Promise<void> {
  const insumo = await repo.buscarInsumoConPresentaciones(ctx.empresaId, insumoId);
  if (!insumo) {
    throw errores.datosInvalidos({ insumoId: 'Ese insumo no existe en tu empresa.' });
  }
  if (!insumo.activo) {
    throw errores.datosInvalidos({
      insumoId: `El insumo "${insumo.nombre}" está inactivo: reactivalo antes de asociarlo.`,
    });
  }

  if (presentacionId === null) return;

  const presentacion = insumo.presentaciones.find((fila) => fila.id === presentacionId);
  if (!presentacion) {
    throw errores.datosInvalidos({
      presentacionId: `Esa presentación no es de "${insumo.nombre}".`,
    });
  }
  if (!presentacion.activa) {
    throw errores.datosInvalidos({
      presentacionId: `La presentación "${presentacion.nombre}" está inactiva.`,
    });
  }
}

/**
 * El precio y su fecha van juntos o no van (la base tiene un CHECK que lo
 * exige). Esta función es el único lugar que arma ese par.
 *
 * Que la fecha la ponga el SERVIDOR y no el formulario es a propósito: el
 * reloj del cliente puede estar mal, y un precio con fecha futura ensuciaría
 * la comparación de precios.
 */
function precioConFecha(precio: string | null): {
  ultimoPrecio: string | null;
  ultimoPrecioAt: Date | null;
} {
  return precio === null
    ? { ultimoPrecio: null, ultimoPrecioAt: null }
    : { ultimoPrecio: precio, ultimoPrecioAt: new Date() };
}

// ===========================================================================
// Comandos — proveedor
// ===========================================================================

export async function crear(
  ctx: Contexto,
  entrada: CrearProveedorInput,
): Promise<ProveedorDetalle> {
  await exigirNombreLibre(ctx, entrada.nombre);
  if (entrada.cuit !== null) await exigirCuitLibre(ctx, entrada.cuit);

  const proveedorId = await prisma.$transaction(async (tx) => {
    const proveedor = await tx.proveedor.create({
      data: { empresaId: ctx.empresaId, ...entrada },
      select: { id: true },
    });

    await registrarAuditoria(tx, {
      empresaId: ctx.empresaId,
      usuarioId: ctx.usuarioId,
      entidad: 'proveedor',
      entidadId: proveedor.id,
      accion: 'CREAR',
      datosDespues: entrada,
      ip: ctx.ip ?? null,
    });

    return proveedor.id;
  });

  return obtenerDetalle(ctx, proveedorId);
}

export async function actualizar(
  ctx: Contexto,
  proveedorId: string,
  entrada: ActualizarProveedorInput,
): Promise<ProveedorDetalle> {
  const actual = await exigirProveedorDeLaEmpresa(ctx, proveedorId);

  if (entrada.nombre !== undefined) await exigirNombreLibre(ctx, entrada.nombre, proveedorId);
  if (entrada.cuit !== undefined && entrada.cuit !== null) {
    await exigirCuitLibre(ctx, entrada.cuit, proveedorId);
  }

  // PATCH: lo que no vino, no se toca. `undefined` ("no vino") y `null`
  // ("borralo") son dos intenciones distintas.
  const cambios: CambiosProveedor = {};
  if (entrada.nombre !== undefined) cambios.nombre = entrada.nombre;
  if (entrada.razonSocial !== undefined) cambios.razonSocial = entrada.razonSocial;
  if (entrada.cuit !== undefined) cambios.cuit = entrada.cuit;
  if (entrada.email !== undefined) cambios.email = entrada.email;
  if (entrada.telefono !== undefined) cambios.telefono = entrada.telefono;
  if (entrada.direccion !== undefined) cambios.direccion = entrada.direccion;
  if (entrada.contactoNombre !== undefined) cambios.contactoNombre = entrada.contactoNombre;
  if (entrada.diasEntrega !== undefined) cambios.diasEntrega = entrada.diasEntrega;
  if (entrada.notas !== undefined) cambios.notas = entrada.notas;

  if (Object.keys(cambios).length === 0) return obtenerDetalle(ctx, proveedorId);

  await prisma.$transaction(async (tx) => {
    await tx.proveedor.update({ where: { id: proveedorId }, data: cambios });
    await registrarAuditoria(tx, {
      empresaId: ctx.empresaId,
      usuarioId: ctx.usuarioId,
      entidad: 'proveedor',
      entidadId: proveedorId,
      accion: 'ACTUALIZAR',
      // El valor anterior SOLO de lo que cambió: así la auditoría sirve para
      // entender qué pasó y no solo para saber que algo pasó.
      datosAntes: Object.fromEntries(
        Object.keys(cambios).map((campo) => [campo, actual[campo as keyof CambiosProveedor]]),
      ),
      datosDespues: cambios,
      ip: ctx.ip ?? null,
    });
  });

  return obtenerDetalle(ctx, proveedorId);
}

/**
 * Activa o desactiva un proveedor. NO existe el borrado: un proveedor con
 * compras de hace seis meses no se puede borrar sin romper el historial.
 *
 * Al desactivarlo se le quita la marca de PREFERIDO a todas sus asociaciones.
 * Si no, la vista de reposición (Fase 10) agruparía la compra bajo un
 * proveedor al que ya no le compramos. Las asociaciones en sí quedan como
 * están: si mañana se reactiva, su catálogo y sus precios siguen ahí.
 */
export async function cambiarEstado(
  ctx: Contexto,
  proveedorId: string,
  activo: boolean,
): Promise<ProveedorDetalle> {
  const actual = await exigirProveedorDeLaEmpresa(ctx, proveedorId);

  // Idempotente: desactivar algo ya desactivado no es un error ni genera una
  // entrada de auditoría falsa (el doble clic es cosa de todos los días).
  if (actual.activo === activo) return obtenerDetalle(ctx, proveedorId);

  await prisma.$transaction(async (tx) => {
    await tx.proveedor.update({ where: { id: proveedorId }, data: { activo } });

    if (!activo) {
      await tx.proveedorInsumo.updateMany({
        where: { proveedorId, esPreferido: true },
        data: { esPreferido: false },
      });
    }

    await registrarAuditoria(tx, {
      empresaId: ctx.empresaId,
      usuarioId: ctx.usuarioId,
      entidad: 'proveedor',
      entidadId: proveedorId,
      accion: activo ? 'ACTUALIZAR' : 'DESACTIVAR',
      datosAntes: { activo: actual.activo },
      datosDespues: { activo },
      ip: ctx.ip ?? null,
    });
  });

  return obtenerDetalle(ctx, proveedorId);
}

// ===========================================================================
// Comandos — asociación proveedor ↔ insumo
// ===========================================================================

export async function crearAsociacion(
  ctx: Contexto,
  proveedorId: string,
  entrada: CrearProveedorInsumoInput,
): Promise<ProveedorDetalle> {
  const proveedor = await exigirProveedorDeLaEmpresa(ctx, proveedorId);
  if (!proveedor.activo) {
    throw errores.datosInvalidos({
      '(raíz)': 'El proveedor está inactivo: reactivalo antes de agregarle insumos.',
    });
  }

  await exigirInsumoYPresentacion(ctx, entrada.insumoId, entrada.presentacionId);

  // UNIQUE (proveedor_id, insumo_id) en la base. Chequeamos antes para dar un
  // mensaje entendible en lugar de dejar que explote la restricción.
  const repetida = await repo.buscarAsociacionPorPar(proveedorId, entrada.insumoId);
  if (repetida) {
    throw errores.nombreDuplicado(
      repetida.activo
        ? 'esa relación: el insumo ya está en la lista de este proveedor'
        : 'esa relación, desactivada: reactivala en lugar de crearla de nuevo',
    );
  }

  await prisma.$transaction(async (tx) => {
    // Hay UN solo proveedor preferido por insumo, garantizado por un índice
    // único parcial. Si este va a ser el preferido, primero hay que desmarcar
    // al anterior o la base rechaza la fila.
    if (entrada.esPreferido) {
      await tx.proveedorInsumo.updateMany({
        where: { insumoId: entrada.insumoId, esPreferido: true },
        data: { esPreferido: false },
      });
    }

    const asociacion = await tx.proveedorInsumo.create({
      data: {
        // El empresaId sale de la SESIÓN, nunca del cuerpo del pedido.
        empresaId: ctx.empresaId,
        proveedorId,
        insumoId: entrada.insumoId,
        presentacionId: entrada.presentacionId,
        codigoProveedor: entrada.codigoProveedor,
        esPreferido: entrada.esPreferido,
        ...precioConFecha(entrada.ultimoPrecio),
      },
      select: { id: true },
    });

    await registrarAuditoria(tx, {
      empresaId: ctx.empresaId,
      usuarioId: ctx.usuarioId,
      entidad: 'proveedor_insumo',
      entidadId: asociacion.id,
      accion: 'CREAR',
      datosDespues: { proveedorId, ...entrada },
      ip: ctx.ip ?? null,
    });
  });

  return obtenerDetalle(ctx, proveedorId);
}

export async function actualizarAsociacion(
  ctx: Contexto,
  proveedorId: string,
  asociacionId: string,
  entrada: ActualizarProveedorInsumoInput,
): Promise<ProveedorDetalle> {
  await exigirProveedorDeLaEmpresa(ctx, proveedorId);

  // La asociación tiene que ser DE ESTE proveedor y de esta empresa. Sin este
  // chequeo se podría editar la asociación de otro pasando su id en la URL.
  const actual = await repo.buscarAsociacion(ctx.empresaId, proveedorId, asociacionId);
  if (!actual) throw errores.noEncontrado('La relación con el insumo');

  // El insumo NO se puede cambiar (el esquema ni siquiera acepta el campo),
  // así que la presentación se valida contra el insumo que ya tiene.
  if (entrada.presentacionId !== undefined) {
    await exigirInsumoYPresentacion(ctx, actual.insumo.id, entrada.presentacionId);
  }

  // Una relación desactivada no puede seguir siendo la preferida: lo exige un
  // CHECK de la base, y tiene sentido de negocio. Mismo criterio que la
  // presentación por defecto de la Fase 4.
  const quedaInactiva = entrada.activo === false;
  const seraPreferida = quedaInactiva ? false : (entrada.esPreferido ?? actual.esPreferido);

  if (seraPreferida && entrada.activo !== true && !actual.activo) {
    throw errores.datosInvalidos({
      esPreferido: 'Una relación inactiva no puede ser la preferida: reactivala primero.',
    });
  }

  await prisma.$transaction(async (tx) => {
    if (seraPreferida && !actual.esPreferido) {
      await tx.proveedorInsumo.updateMany({
        where: { insumoId: actual.insumo.id, esPreferido: true },
        data: { esPreferido: false },
      });
    }

    await tx.proveedorInsumo.update({
      where: { id: asociacionId },
      data: {
        ...(entrada.presentacionId === undefined ? {} : { presentacionId: entrada.presentacionId }),
        ...(entrada.codigoProveedor === undefined
          ? {}
          : { codigoProveedor: entrada.codigoProveedor }),
        ...(entrada.ultimoPrecio === undefined ? {} : precioConFecha(entrada.ultimoPrecio)),
        ...(entrada.activo === undefined ? {} : { activo: entrada.activo }),
        esPreferido: seraPreferida,
      },
    });

    await registrarAuditoria(tx, {
      empresaId: ctx.empresaId,
      usuarioId: ctx.usuarioId,
      entidad: 'proveedor_insumo',
      entidadId: asociacionId,
      accion: quedaInactiva ? 'DESACTIVAR' : 'ACTUALIZAR',
      datosAntes: {
        presentacionId: actual.presentacion?.id ?? null,
        codigoProveedor: actual.codigoProveedor,
        ultimoPrecio: actual.ultimoPrecio?.toString() ?? null,
        esPreferido: actual.esPreferido,
        activo: actual.activo,
      },
      datosDespues: { ...entrada, esPreferido: seraPreferida },
      ip: ctx.ip ?? null,
    });
  });

  return obtenerDetalle(ctx, proveedorId);
}
