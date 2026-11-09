// CAPA 3 — SERVICIO: el historial y las notas de una compra (Fase 12c).
import {
  aDecimal,
  type AgregarNotaInput,
  armarHistorial,
  type HistorialCompra,
  redondearDinero,
} from '@panaderia/shared';

import { registrarAuditoria } from '../../lib/auditoria.js';
import { type Contexto, puedeOperarEn } from '../../lib/contexto.js';
import { prisma } from '../../lib/db.js';
import { errores } from '../../lib/errores.js';
import * as repo from './repo.js';

/** ¿Es una auditoría de "pedir" (y no una edición)? */
function esPedir(datos: unknown): boolean {
  return typeof datos === 'object' && datos !== null && 'accion' in datos;
}

export async function historialDeCompra(ctx: Contexto, ordenId: string): Promise<HistorialCompra> {
  const compra = await repo.datosHistorial(ctx.empresaId, ordenId);
  if (!compra) throw errores.noEncontrado('La compra');
  if (!puedeOperarEn(ctx, compra.sucursalId)) throw errores.sucursalNoPermitida();
  const auditoria = await repo.auditoriaDeCompra(ctx.empresaId, ordenId);

  const conPrecio = compra.lineas.every((linea) => linea.precioUnitario !== null);
  // Con Decimal, nunca con number: es plata (regla 2).
  const total = conPrecio
    ? redondearDinero(
        compra.lineas.reduce(
          (suma, linea) =>
            suma.plus(aDecimal(linea.cantidad.toString()).times(String(linea.precioUnitario))),
          aDecimal('0'),
        ),
      ).toString()
    : null;

  const eventos = armarHistorial({
    creadaAt: compra.createdAt.toISOString(),
    pedidaAt: compra.pedidaAt?.toISOString() ?? null,
    cerradaAt: compra.cerradaAt?.toISOString() ?? null,
    estado: compra.estado,
    notaCierre: compra.notaCierre,
    creadaPor: compra.usuario,
    cerradaPor: auditoria.filter((fila) => fila.accion === 'ANULAR').at(-1)?.usuario ?? null,
    cantidadInsumos: compra.lineas.length,
    total,
    ediciones: auditoria
      .filter((fila) => fila.accion === 'ACTUALIZAR' && !esPedir(fila.datosDespues))
      .map((fila) => ({ fecha: fila.createdAt.toISOString(), usuario: fila.usuario })),
    pagos: compra.pagos.map((pago) => ({
      fecha: pago.fecha.toISOString(),
      monto: pago.monto.toString(),
      medio: pago.medio,
      nota: pago.nota,
      usuario: pago.usuario,
      comprobantes: pago._count.comprobantes,
      anuladoAt: pago.anuladoAt?.toISOString() ?? null,
      anuladoPor: pago.anuladoPor,
      motivoAnulacion: pago.motivoAnulacion,
    })),
    entregas: compra.recepciones.map((entrega) => ({
      id: entrega.id,
      numero: entrega.numero,
      fecha: entrega.fecha.toISOString(),
      sucursal: entrega.sucursal.nombre,
      usuario: entrega.usuario,
      renglones: entrega.lineas.map((linea) => ({
        insumo: linea.insumo.nombre,
        cantidad: linea.cantidad.toString(),
        presentacion: linea.presentacion?.nombre ?? null,
        unidad: linea.insumo.unidadBase.codigo,
      })),
      remito: entrega.numeroRemito,
      fotos: entrega._count.comprobantes,
      anuladaAt: entrega.anuladaAt?.toISOString() ?? null,
      anuladaPor: entrega.anuladaPor,
      motivoAnulacion: entrega.motivoAnulacion,
    })),
    notas: compra.anotaciones.map((nota) => ({
      fecha: nota.createdAt.toISOString(),
      texto: nota.texto,
      usuario: nota.usuario,
    })),
  });

  return { eventos };
}

/**
 * Agrega una nota. Se puede en cualquier estado, incluso cancelada ("el
 * molino devuelve la plata el lunes"). No se edita ni se borra: es historia.
 */
export async function agregarNota(
  ctx: Contexto,
  ordenId: string,
  entrada: AgregarNotaInput,
): Promise<HistorialCompra> {
  await prisma.$transaction(async (tx) => {
    const compra = await tx.ordenCompra.findFirst({
      where: { id: ordenId, empresaId: ctx.empresaId },
      select: { sucursalId: true },
    });
    if (!compra) throw errores.noEncontrado('La compra');
    if (!puedeOperarEn(ctx, compra.sucursalId)) throw errores.sucursalNoPermitida();

    const nota = await tx.notaCompra.create({
      data: {
        empresaId: ctx.empresaId,
        ordenCompraId: ordenId,
        texto: entrada.texto,
        usuarioId: ctx.usuarioId,
      },
      select: { id: true },
    });
    await registrarAuditoria(tx, {
      empresaId: ctx.empresaId,
      usuarioId: ctx.usuarioId,
      entidad: 'nota_compra',
      entidadId: nota.id,
      accion: 'CREAR',
      datosDespues: { ordenCompraId: ordenId, texto: entrada.texto },
      ip: ctx.ip ?? null,
    });
  });
  return historialDeCompra(ctx, ordenId);
}
