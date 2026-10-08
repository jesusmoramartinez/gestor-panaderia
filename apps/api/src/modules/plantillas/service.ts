// CAPA 3 — SERVICIO: las reglas del negocio. No sabe que existe HTTP.
import type { GuardarPlantillaInput, Plantilla } from '@panaderia/shared';

import { registrarAuditoria } from '../../lib/auditoria.js';
import { type Contexto, puedeOperarEn } from '../../lib/contexto.js';
import { prisma } from '../../lib/db.js';
import { errores } from '../../lib/errores.js';
import { type LineaResuelta, resolverLineas } from '../compras/lineas.js';
import * as comprasRepo from '../compras/repo.js';
import * as repo from './repo.js';

/**
 * PLANTILLAS DE PEDIDOS RECURRENTES.
 *
 * Pedido del cliente: "seguro hay pedidos que se repiten". La plantilla es una
 * orden de compra a medio hacer, con nombre ("Pedido semanal Molino"), que NO
 * se gasta al usarla: la pantalla de nueva orden la usa para precargarse, y la
 * plantilla sigue ahí para la semana que viene.
 *
 * No mueve stock ni numera nada: es un catálogo, como los insumos. Por eso se
 * crea, se edita y se desactiva, y cada cambio queda en la auditoría.
 */

function aPlantilla(fila: repo.FilaPlantilla): Plantilla {
  return {
    id: fila.id,
    nombre: fila.nombre,
    notas: fila.notas,
    activa: fila.activa,
    proveedor: fila.proveedor,
    sucursal: fila.sucursal,
    lineas: fila.lineas.map((linea) => ({
      id: linea.id,
      insumo: {
        id: linea.insumo.id,
        nombre: linea.insumo.nombre,
        unidadBaseCodigo: linea.insumo.unidadBase.codigo,
      },
      presentacion: linea.presentacion,
      cantidad: linea.cantidad.toString(),
    })),
  };
}

function datosDeLineas(empresaId: string, plantillaId: string, lineas: readonly LineaResuelta[]) {
  return lineas.map((linea) => ({
    empresaId,
    plantillaId,
    insumoId: linea.insumoId,
    presentacionId: linea.presentacionId,
    cantidad: linea.cantidad.toString(),
  }));
}

/** Lo que se valida igual al crear y al editar. */
async function validar(
  ctx: Contexto,
  entrada: GuardarPlantillaInput,
  excluirId?: string,
): Promise<LineaResuelta[]> {
  const sucursal = await comprasRepo.buscarSucursal(ctx.empresaId, entrada.sucursalId);
  if (!sucursal) throw errores.noEncontrado('La sucursal');

  const proveedor = await comprasRepo.buscarProveedor(ctx.empresaId, entrada.proveedorId);
  if (!proveedor) {
    throw errores.datosInvalidos({ proveedorId: 'Ese proveedor no existe en tu empresa.' });
  }

  const repetida = await repo.buscarPorNombre(ctx.empresaId, entrada.nombre, excluirId);
  if (repetida) throw errores.nombreDuplicado(`una plantilla "${repetida.nombre}"`);

  return resolverLineas(ctx, entrada.lineas);
}

export async function listar(ctx: Contexto, incluirInactivas: boolean): Promise<Plantilla[]> {
  const filas = await repo.listar(ctx.empresaId, ctx.sucursalesPermitidas, incluirInactivas);
  return filas.map(aPlantilla);
}

export async function obtener(ctx: Contexto, plantillaId: string): Promise<Plantilla> {
  const fila = await repo.buscar(ctx.empresaId, plantillaId);
  if (!fila) throw errores.noEncontrado('La plantilla');
  if (!puedeOperarEn(ctx, fila.sucursalId)) throw errores.sucursalNoPermitida();
  return aPlantilla(fila);
}

export async function crear(ctx: Contexto, entrada: GuardarPlantillaInput): Promise<Plantilla> {
  const lineas = await validar(ctx, entrada);

  const id = await prisma.$transaction(async (tx) => {
    const creada = await tx.plantillaPedido.create({
      data: {
        empresaId: ctx.empresaId,
        nombre: entrada.nombre,
        proveedorId: entrada.proveedorId,
        sucursalId: entrada.sucursalId,
        notas: entrada.notas,
      },
      select: { id: true },
    });
    await tx.lineaPlantillaPedido.createMany({
      data: datosDeLineas(ctx.empresaId, creada.id, lineas),
    });
    await registrarAuditoria(tx, {
      empresaId: ctx.empresaId,
      usuarioId: ctx.usuarioId,
      entidad: 'plantilla_pedido',
      entidadId: creada.id,
      accion: 'CREAR',
      datosDespues: entrada,
      ip: ctx.ip ?? null,
    });
    return creada.id;
  });

  return obtener(ctx, id);
}

/** Editar REEMPLAZA las líneas, igual que en la orden de compra. */
export async function actualizar(
  ctx: Contexto,
  plantillaId: string,
  entrada: GuardarPlantillaInput,
): Promise<Plantilla> {
  const antes = await obtener(ctx, plantillaId);
  const lineas = await validar(ctx, entrada, plantillaId);

  await prisma.$transaction(async (tx) => {
    await tx.lineaPlantillaPedido.deleteMany({ where: { plantillaId } });
    await tx.plantillaPedido.update({
      where: { id: plantillaId },
      data: {
        nombre: entrada.nombre,
        proveedorId: entrada.proveedorId,
        sucursalId: entrada.sucursalId,
        notas: entrada.notas,
      },
    });
    await tx.lineaPlantillaPedido.createMany({
      data: datosDeLineas(ctx.empresaId, plantillaId, lineas),
    });
    await registrarAuditoria(tx, {
      empresaId: ctx.empresaId,
      usuarioId: ctx.usuarioId,
      entidad: 'plantilla_pedido',
      entidadId: plantillaId,
      accion: 'ACTUALIZAR',
      datosAntes: antes,
      datosDespues: entrada,
      ip: ctx.ip ?? null,
    });
  });

  return obtener(ctx, plantillaId);
}

/** No se borra: se desactiva, como todo catálogo. */
export async function cambiarEstado(
  ctx: Contexto,
  plantillaId: string,
  activa: boolean,
): Promise<Plantilla> {
  await obtener(ctx, plantillaId);

  await prisma.$transaction(async (tx) => {
    await tx.plantillaPedido.update({ where: { id: plantillaId }, data: { activa } });
    await registrarAuditoria(tx, {
      empresaId: ctx.empresaId,
      usuarioId: ctx.usuarioId,
      entidad: 'plantilla_pedido',
      entidadId: plantillaId,
      accion: activa ? 'ACTUALIZAR' : 'DESACTIVAR',
      datosDespues: { activa },
      ip: ctx.ip ?? null,
    });
  });

  return obtener(ctx, plantillaId);
}
