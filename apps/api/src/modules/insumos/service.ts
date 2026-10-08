// CAPA 3 — SERVICIO: las reglas del negocio. No sabe que existe HTTP.
import type {
  ActualizarInsumoInput,
  ActualizarPresentacionInput,
  CrearInsumoInput,
  CrearPresentacionInput,
  FiltroInsumos,
  InsumoDetalle,
  InsumoResumen,
  ListadoInsumos,
  ParametrosPorSucursal,
  ParametrosSucursalInput,
} from '@panaderia/shared';

import { registrarAuditoria } from '../../lib/auditoria.js';
import type { Contexto } from '../../lib/contexto.js';
import { prisma } from '../../lib/db.js';
import { errores } from '../../lib/errores.js';
import * as repo from './repo.js';

type FilaResumen = NonNullable<Awaited<ReturnType<typeof repo.buscarResumen>>>;
type FilaDetalle = NonNullable<Awaited<ReturnType<typeof repo.buscarDetalle>>>;

/** Campos que la actualización puede tocar. La unidad base NO está: ver abajo. */
type CambiosInsumo = {
  nombre?: string;
  codigo?: string | null;
  categoriaId?: string | null;
};

// ===========================================================================
// Traducción de filas de la base a objetos del dominio
// ===========================================================================

function aResumen(fila: FilaResumen): InsumoResumen {
  return {
    id: fila.id,
    codigo: fila.codigo,
    nombre: fila.nombre,
    activo: fila.activo,
    categoria: fila.categoria,
    unidadBase: {
      ...fila.unidadBase,
      // Los decimales salen como TEXTO: ver docs/aprendizaje/10.
      factorABase: fila.unidadBase.factorABase.toString(),
    },
    cantidadPresentaciones: fila._count.presentaciones,
  };
}

/**
 * Arma los parámetros por sucursal de un insumo.
 *
 * Devuelve TODAS las sucursales de la empresa, no solo las que ya tienen una
 * fila configurada: así el formulario puede mostrar cada sucursal con su valor
 * actual (cero si nadie lo configuró) y el usuario completa la que quiera, sin
 * tener que "agregar" una sucursal antes de poder ponerle un mínimo.
 */
function armarPorSucursal(
  sucursales: { id: string; codigo: string; nombre: string }[],
  configurados: FilaDetalle['porSucursal'],
): ParametrosPorSucursal[] {
  const porId = new Map(configurados.map((fila) => [fila.sucursalId, fila]));

  return sucursales.map((sucursal) => {
    const fila = porId.get(sucursal.id);
    return {
      sucursalId: sucursal.id,
      sucursalCodigo: sucursal.codigo,
      sucursalNombre: sucursal.nombre,
      stockMinimo: fila?.stockMinimo.toString() ?? '0',
      stockMaximo: fila?.stockMaximo?.toString() ?? null,
      ubicacion: fila?.ubicacion ?? null,
      activo: fila?.activo ?? true,
    };
  });
}

// ===========================================================================
// Consultas
// ===========================================================================

export async function listar(ctx: Contexto, filtro: FiltroInsumos): Promise<ListadoInsumos> {
  const [filas, total] = await repo.listar({
    empresaId: ctx.empresaId,
    busqueda: filtro.busqueda,
    categoriaId: filtro.categoriaId,
    incluirInactivos: filtro.incluirInactivos,
    limite: filtro.limite,
    desplazamiento: filtro.desplazamiento,
  });

  return { items: filas.map(aResumen), total };
}

export async function obtenerDetalle(ctx: Contexto, insumoId: string): Promise<InsumoDetalle> {
  const fila = await repo.buscarDetalle(ctx.empresaId, insumoId);
  // Si es de otra empresa, para este usuario NO EXISTE: 404 y no 403. Un 403
  // confirmaría que el recurso existe y es de alguien.
  if (!fila) throw errores.noEncontrado('El insumo');

  const sucursales = await repo.sucursalesDeEmpresa(ctx.empresaId);

  return {
    ...aResumen(fila),
    presentaciones: fila.presentaciones.map((presentacion) => ({
      id: presentacion.id,
      nombre: presentacion.nombre,
      cantidadBase: presentacion.cantidadBase.toString(),
      esDefault: presentacion.esDefault,
      activa: presentacion.activa,
    })),
    porSucursal: armarPorSucursal(sucursales, fila.porSucursal),
  };
}

// ===========================================================================
// Reglas de validación compartidas por crear y actualizar
// ===========================================================================

async function exigirNombreLibre(ctx: Contexto, nombre: string, excluirId?: string): Promise<void> {
  const existente = await repo.buscarPorNombre(ctx.empresaId, nombre, excluirId);
  // Dos filas "Harina 000" partirían el stock en dos sin que nadie se dé
  // cuenta: la mitad de los movimientos irían a una y la mitad a la otra.
  if (existente) throw errores.nombreDuplicado(`el insumo "${existente.nombre}"`);
}

async function exigirCodigoLibre(ctx: Contexto, codigo: string, excluirId?: string): Promise<void> {
  const existente = await repo.buscarPorCodigo(ctx.empresaId, codigo, excluirId);
  if (existente) throw errores.nombreDuplicado(`un insumo con el código "${existente.codigo}"`);
}

async function exigirUnidadDeLaEmpresa(ctx: Contexto, unidadBaseId: string): Promise<void> {
  // Sin este chequeo, alguien podría asignarle a su insumo la unidad de otra
  // empresa pasando su UUID. El empresaId sale de la sesión, pero los ids que
  // vienen en el cuerpo del pedido hay que verificarlos uno por uno.
  const cuantas = await repo.contarUnidadEnEmpresa(ctx.empresaId, unidadBaseId);
  if (cuantas === 0) {
    throw errores.datosInvalidos({ unidadBaseId: 'Esa unidad de medida no existe en tu empresa.' });
  }
}

async function exigirCategoriaDeLaEmpresa(ctx: Contexto, categoriaId: string): Promise<void> {
  const cuantas = await repo.contarCategoriaEnEmpresa(ctx.empresaId, categoriaId);
  if (cuantas === 0) {
    throw errores.datosInvalidos({ categoriaId: 'Esa categoría no existe en tu empresa.' });
  }
}

async function exigirInsumoDeLaEmpresa(ctx: Contexto, insumoId: string): Promise<FilaDetalle> {
  const fila = await repo.buscarDetalle(ctx.empresaId, insumoId);
  if (!fila) throw errores.noEncontrado('El insumo');
  return fila;
}

// ===========================================================================
// Comandos
// ===========================================================================

export async function crear(ctx: Contexto, entrada: CrearInsumoInput): Promise<InsumoDetalle> {
  await exigirNombreLibre(ctx, entrada.nombre);
  if (entrada.codigo !== null) await exigirCodigoLibre(ctx, entrada.codigo);
  await exigirUnidadDeLaEmpresa(ctx, entrada.unidadBaseId);
  if (entrada.categoriaId != null) await exigirCategoriaDeLaEmpresa(ctx, entrada.categoriaId);

  const insumoId = await prisma.$transaction(async (tx) => {
    const insumo = await tx.insumo.create({
      data: {
        empresaId: ctx.empresaId,
        nombre: entrada.nombre,
        codigo: entrada.codigo,
        categoriaId: entrada.categoriaId ?? null,
        unidadBaseId: entrada.unidadBaseId,
      },
      select: { id: true },
    });

    await registrarAuditoria(tx, {
      empresaId: ctx.empresaId,
      usuarioId: ctx.usuarioId,
      entidad: 'insumo',
      entidadId: insumo.id,
      accion: 'CREAR',
      datosDespues: entrada,
      ip: ctx.ip ?? null,
    });

    return insumo.id;
  });

  return obtenerDetalle(ctx, insumoId);
}

export async function actualizar(
  ctx: Contexto,
  insumoId: string,
  entrada: ActualizarInsumoInput,
): Promise<InsumoDetalle> {
  const actual = await exigirInsumoDeLaEmpresa(ctx, insumoId);

  if (entrada.nombre !== undefined) await exigirNombreLibre(ctx, entrada.nombre, insumoId);
  if (entrada.codigo !== undefined && entrada.codigo !== null) {
    await exigirCodigoLibre(ctx, entrada.codigo, insumoId);
  }
  if (entrada.categoriaId !== undefined && entrada.categoriaId !== null) {
    await exigirCategoriaDeLaEmpresa(ctx, entrada.categoriaId);
  }

  // PATCH: lo que no vino, no se toca. Distinguimos "no vino" (undefined) de
  // "ponelo en nada" (null), que son dos intenciones distintas.
  const cambios: CambiosInsumo = {};
  if (entrada.nombre !== undefined) cambios.nombre = entrada.nombre;
  if (entrada.codigo !== undefined) cambios.codigo = entrada.codigo;
  if (entrada.categoriaId !== undefined) cambios.categoriaId = entrada.categoriaId ?? null;

  if (Object.keys(cambios).length === 0) return obtenerDetalle(ctx, insumoId);

  await prisma.$transaction(async (tx) => {
    await tx.insumo.update({ where: { id: insumoId }, data: cambios });
    await registrarAuditoria(tx, {
      empresaId: ctx.empresaId,
      usuarioId: ctx.usuarioId,
      entidad: 'insumo',
      entidadId: insumoId,
      accion: 'ACTUALIZAR',
      // Guardamos solo lo que cambió, y el valor anterior: así la auditoría
      // sirve para entender qué pasó y no solo para saber que algo pasó.
      datosAntes: {
        nombre: actual.nombre,
        codigo: actual.codigo,
        categoriaId: actual.categoria?.id ?? null,
      },
      datosDespues: cambios,
      ip: ctx.ip ?? null,
    });
  });

  return obtenerDetalle(ctx, insumoId);
}

/**
 * Activa o desactiva un insumo. NO existe el borrado.
 *
 * Un insumo con movimientos de hace seis meses no se puede borrar: el
 * historial quedaría roto. Se desactiva y deja de aparecer en los formularios,
 * pero sigue estando en el historial y en los informes.
 */
export async function cambiarEstado(
  ctx: Contexto,
  insumoId: string,
  activo: boolean,
): Promise<InsumoDetalle> {
  const actual = await exigirInsumoDeLaEmpresa(ctx, insumoId);

  // Idempotente: desactivar algo ya desactivado no es un error ni genera una
  // entrada de auditoría falsa (el doble clic es cosa de todos los días).
  if (actual.activo === activo) return obtenerDetalle(ctx, insumoId);

  await prisma.$transaction(async (tx) => {
    await tx.insumo.update({ where: { id: insumoId }, data: { activo } });
    await registrarAuditoria(tx, {
      empresaId: ctx.empresaId,
      usuarioId: ctx.usuarioId,
      entidad: 'insumo',
      entidadId: insumoId,
      accion: activo ? 'ACTUALIZAR' : 'DESACTIVAR',
      datosAntes: { activo: actual.activo },
      datosDespues: { activo },
      ip: ctx.ip ?? null,
    });
  });

  return obtenerDetalle(ctx, insumoId);
}

export async function crearPresentacion(
  ctx: Contexto,
  insumoId: string,
  entrada: CrearPresentacionInput,
): Promise<InsumoDetalle> {
  await exigirInsumoDeLaEmpresa(ctx, insumoId);

  const repetida = await repo.buscarPresentacionPorNombre(insumoId, entrada.nombre);
  if (repetida) throw errores.nombreDuplicado(`una presentación "${entrada.nombre}"`);

  await prisma.$transaction(async (tx) => {
    // Hay una sola presentación por defecto por insumo, garantizado por un
    // índice único parcial en la base. Si esta va a ser la default, primero
    // hay que desmarcar la anterior o la base rechaza la fila.
    if (entrada.esDefault) {
      await tx.presentacionInsumo.updateMany({
        where: { insumoId, esDefault: true },
        data: { esDefault: false },
      });
    }

    const presentacion = await tx.presentacionInsumo.create({
      data: {
        empresaId: ctx.empresaId,
        insumoId,
        nombre: entrada.nombre,
        cantidadBase: entrada.cantidadBase,
        esDefault: entrada.esDefault,
      },
      select: { id: true },
    });

    await registrarAuditoria(tx, {
      empresaId: ctx.empresaId,
      usuarioId: ctx.usuarioId,
      entidad: 'presentacion_insumo',
      entidadId: presentacion.id,
      accion: 'CREAR',
      datosDespues: { insumoId, ...entrada },
      ip: ctx.ip ?? null,
    });
  });

  return obtenerDetalle(ctx, insumoId);
}

export async function actualizarPresentacion(
  ctx: Contexto,
  insumoId: string,
  presentacionId: string,
  entrada: ActualizarPresentacionInput,
): Promise<InsumoDetalle> {
  await exigirInsumoDeLaEmpresa(ctx, insumoId);

  // La presentación tiene que ser DE ESTE insumo. Sin este chequeo, alguien
  // podría editar la presentación de otro insumo (o de otra empresa) pasando
  // su id en la URL.
  const presentacion = await repo.buscarPresentacion(insumoId, presentacionId);
  if (!presentacion) throw errores.noEncontrado('La presentación');

  if (entrada.nombre !== undefined) {
    const repetida = await repo.buscarPresentacionPorNombre(
      insumoId,
      entrada.nombre,
      presentacionId,
    );
    if (repetida) throw errores.nombreDuplicado(`una presentación "${entrada.nombre}"`);
  }

  // Una presentación desactivada no puede seguir siendo la que se propone al
  // comprar: desactivarla le quita la marca de default.
  const quedaInactiva = entrada.activa === false;
  const seraDefault = quedaInactiva ? false : (entrada.esDefault ?? presentacion.esDefault);

  await prisma.$transaction(async (tx) => {
    if (seraDefault && !presentacion.esDefault) {
      await tx.presentacionInsumo.updateMany({
        where: { insumoId, esDefault: true },
        data: { esDefault: false },
      });
    }

    await tx.presentacionInsumo.update({
      where: { id: presentacionId },
      data: {
        ...(entrada.nombre === undefined ? {} : { nombre: entrada.nombre }),
        ...(entrada.activa === undefined ? {} : { activa: entrada.activa }),
        esDefault: seraDefault,
      },
    });

    await registrarAuditoria(tx, {
      empresaId: ctx.empresaId,
      usuarioId: ctx.usuarioId,
      entidad: 'presentacion_insumo',
      entidadId: presentacionId,
      accion: quedaInactiva ? 'DESACTIVAR' : 'ACTUALIZAR',
      datosAntes: presentacion,
      datosDespues: { ...entrada, esDefault: seraDefault },
      ip: ctx.ip ?? null,
    });
  });

  return obtenerDetalle(ctx, insumoId);
}

/**
 * Define el stock mínimo (y el máximo y la ubicación) de un insumo EN una
 * sucursal. Es un upsert: la primera vez crea la fila, después la actualiza.
 */
export async function definirParametrosSucursal(
  ctx: Contexto,
  insumoId: string,
  sucursalId: string,
  entrada: ParametrosSucursalInput,
): Promise<InsumoDetalle> {
  await exigirInsumoDeLaEmpresa(ctx, insumoId);

  // Que el usuario PUEDA operar en esta sucursal ya lo verificó el middleware
  // requiereSucursal; acá verificamos que la sucursal sea de su empresa.
  const sucursales = await repo.sucursalesDeEmpresa(ctx.empresaId);
  if (!sucursales.some((sucursal) => sucursal.id === sucursalId)) {
    throw errores.noEncontrado('La sucursal');
  }

  const datos = {
    stockMinimo: entrada.stockMinimo,
    stockMaximo: entrada.stockMaximo ?? null,
    ubicacion: entrada.ubicacion,
    activo: entrada.activo,
  };

  await prisma.$transaction(async (tx) => {
    await tx.insumoSucursal.upsert({
      where: { insumoId_sucursalId: { insumoId, sucursalId } },
      create: { insumoId, sucursalId, empresaId: ctx.empresaId, ...datos },
      update: datos,
    });

    await registrarAuditoria(tx, {
      empresaId: ctx.empresaId,
      usuarioId: ctx.usuarioId,
      entidad: 'insumo_sucursal',
      entidadId: insumoId,
      accion: 'ACTUALIZAR',
      datosDespues: { insumoId, sucursalId, ...datos },
      ip: ctx.ip ?? null,
    });
  });

  return obtenerDetalle(ctx, insumoId);
}
