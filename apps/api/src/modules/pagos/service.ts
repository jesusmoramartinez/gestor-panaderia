// CAPA 3 — SERVICIO: las reglas del negocio. No sabe que existe HTTP.
import {
  type AgregarComprobantesInput,
  type AnularPagoInput,
  cuentaDeCompra,
  formatearDinero,
  type OrdenDetalle,
  type RecepcionDetalle,
  type RegistrarPagoInput,
  sePuedePagar,
  validarPago,
} from '@panaderia/shared';

import { registrarAuditoria } from '../../lib/auditoria.js';
import { decodificarImagenes, guardarComprobantes } from '../../lib/comprobantes.js';
import { type Contexto, puedeOperarEn } from '../../lib/contexto.js';
import { prisma } from '../../lib/db.js';
import { AppError, errores } from '../../lib/errores.js';
import * as comprasRepo from '../compras/repo.js';
import { obtenerOrden, obtenerRecepcion } from '../compras/service.js';
import * as repo from './repo.js';

/**
 * REGISTRAR UN PAGO (Fase 12b).
 *
 * Las reglas se verifican DESPUÉS del candado de la orden (regla 12): si dos
 * pagos llegaran juntos y leyeran "falta pagar $100" sin candado, los dos
 * pasarían y la compra quedaría pagada dos veces. Es el MISMO candado que
 * toman recibir y editar la orden, así que nada cambia el total mientras se
 * valida el pago.
 */
export async function registrarPago(
  ctx: Contexto,
  ordenId: string,
  entrada: RegistrarPagoInput,
): Promise<OrdenDetalle> {
  // Las imágenes se verifican ANTES de abrir la transacción.
  const imagenes = decodificarImagenes(entrada.comprobantes);

  await prisma.$transaction(async (tx) => {
    if (!(await comprasRepo.bloquearOrden(tx, ctx.empresaId, ordenId))) {
      throw errores.noEncontrado('La compra');
    }
    const orden = await comprasRepo.ordenPlana(tx, ctx.empresaId, ordenId);
    if (!orden) throw errores.noEncontrado('La compra');
    if (!puedeOperarEn(ctx, orden.sucursalId)) throw errores.sucursalNoPermitida();

    if (!sePuedePagar(orden.estado)) {
      throw new AppError(
        'COMPRA_NO_SE_PUEDE_PAGAR',
        `La compra ${String(orden.numero)} está ${orden.estado.toLowerCase()}: no se le pueden registrar pagos.`,
        409,
      );
    }

    const lineas = await comprasRepo.lineasDeOrden(tx, ordenId);
    const cuenta = cuentaDeCompra(
      lineas.map((linea) => ({
        cantidad: linea.cantidad.toString(),
        cantidadBase: linea.cantidadBase.toString(),
        // Para el saldo no importa lo recibido: se paga la compra entera.
        recibidoBase: '0',
        factor: linea.factorConversion.toString(),
        precioUnitario: linea.precioUnitario?.toString() ?? null,
      })),
      await comprasRepo.pagadoDeOrden(tx, ordenId),
    );

    const validacion = validarPago(cuenta, entrada.monto);
    if (!validacion.valido) {
      if (validacion.motivo === 'SIN_TOTAL') {
        throw new AppError(
          'COMPRA_SIN_PRECIO',
          'Hay insumos de esta compra sin precio: cargalos (editando la compra) antes de registrar un pago.',
          409,
        );
      }
      throw new AppError(
        'PAGO_EXCEDE_TOTAL',
        `Ese monto es más de lo que falta pagar (${formatearDinero(validacion.saldo)}).`,
        409,
        { monto: `Falta pagar ${formatearDinero(validacion.saldo)}` },
      );
    }

    const pago = await tx.pago.create({
      data: {
        empresaId: ctx.empresaId,
        ordenCompraId: ordenId,
        fecha: entrada.fecha === null ? new Date() : new Date(entrada.fecha),
        monto: entrada.monto,
        medio: entrada.medio,
        nota: entrada.nota,
        usuarioId: ctx.usuarioId,
      },
      select: { id: true },
    });
    await guardarComprobantes(
      tx,
      { empresaId: ctx.empresaId, usuarioId: ctx.usuarioId },
      { pagoId: pago.id },
      imagenes,
    );

    await registrarAuditoria(tx, {
      empresaId: ctx.empresaId,
      usuarioId: ctx.usuarioId,
      entidad: 'pago',
      entidadId: pago.id,
      accion: 'CREAR',
      // Sin las imágenes: la auditoría guarda QUÉ pasó, no los archivos.
      datosDespues: {
        ordenCompraId: ordenId,
        monto: entrada.monto,
        medio: entrada.medio,
        fecha: entrada.fecha,
        nota: entrada.nota,
        comprobantes: imagenes.length,
      },
      ip: ctx.ip ?? null,
    });
  });

  return obtenerOrden(ctx, ordenId);
}

/**
 * ANULAR UN PAGO. No se borra: queda anulado, con quién, cuándo y por qué, y
 * deja de contar en lo pagado. Sirve para un pago mal cargado y también para
 * cuando el proveedor devolvió la plata.
 *
 * Candados en el orden de siempre: primero la orden, después el pago.
 */
export async function anularPago(
  ctx: Contexto,
  pagoId: string,
  entrada: AnularPagoInput,
): Promise<OrdenDetalle> {
  const ordenId = await prisma.$transaction(async (tx) => {
    const pago = await repo.pagoPlano(tx, ctx.empresaId, pagoId);
    if (!pago) throw errores.noEncontrado('El pago');
    await comprasRepo.bloquearOrden(tx, ctx.empresaId, pago.ordenCompraId);
    await repo.bloquearPago(tx, ctx.empresaId, pagoId);

    const actual = await repo.pagoPlano(tx, ctx.empresaId, pagoId);
    if (!actual) throw errores.noEncontrado('El pago');
    if (!puedeOperarEn(ctx, actual.orden.sucursalId)) throw errores.sucursalNoPermitida();
    if (actual.anuladoAt !== null) {
      throw new AppError('PAGO_YA_ANULADO', 'Ese pago ya estaba anulado.', 409);
    }

    await tx.pago.update({
      where: { id: pagoId },
      data: { anuladoAt: new Date(), anuladoPorId: ctx.usuarioId, motivoAnulacion: entrada.motivo },
    });
    await registrarAuditoria(tx, {
      empresaId: ctx.empresaId,
      usuarioId: ctx.usuarioId,
      entidad: 'pago',
      entidadId: pagoId,
      accion: 'ANULAR',
      datosAntes: { monto: actual.monto.toString(), medio: actual.medio },
      datosDespues: { motivo: entrada.motivo },
      ip: ctx.ip ?? null,
    });
    return actual.ordenCompraId;
  });

  return obtenerOrden(ctx, ordenId);
}

/** Agregar fotos a un pago ya cargado (se olvidó la captura). */
export async function agregarComprobantesAPago(
  ctx: Contexto,
  pagoId: string,
  entrada: AgregarComprobantesInput,
): Promise<OrdenDetalle> {
  const imagenes = decodificarImagenes(entrada.comprobantes);

  const ordenId = await prisma.$transaction(async (tx) => {
    const pago = await repo.pagoPlano(tx, ctx.empresaId, pagoId);
    if (!pago) throw errores.noEncontrado('El pago');
    if (!puedeOperarEn(ctx, pago.orden.sucursalId)) throw errores.sucursalNoPermitida();
    if (pago.anuladoAt !== null) {
      throw new AppError('PAGO_YA_ANULADO', 'Ese pago está anulado: no se le agregan fotos.', 409);
    }
    await guardarComprobantes(
      tx,
      { empresaId: ctx.empresaId, usuarioId: ctx.usuarioId },
      { pagoId },
      imagenes,
    );
    await registrarAuditoria(tx, {
      empresaId: ctx.empresaId,
      usuarioId: ctx.usuarioId,
      entidad: 'pago',
      entidadId: pagoId,
      accion: 'ACTUALIZAR',
      datosDespues: { comprobantesAgregados: imagenes.length },
      ip: ctx.ip ?? null,
    });
    return pago.ordenCompraId;
  });

  return obtenerOrden(ctx, ordenId);
}

/** Agregar la foto del remito a una entrega ya registrada (C-30). */
export async function agregarComprobantesARecepcion(
  ctx: Contexto,
  recepcionId: string,
  entrada: AgregarComprobantesInput,
): Promise<RecepcionDetalle> {
  const imagenes = decodificarImagenes(entrada.comprobantes);

  await prisma.$transaction(async (tx) => {
    const recepcion = await comprasRepo.recepcionPlana(tx, ctx.empresaId, recepcionId);
    if (!recepcion) throw errores.noEncontrado('La entrega');
    if (!puedeOperarEn(ctx, recepcion.sucursalId)) throw errores.sucursalNoPermitida();
    if (recepcion.estado === 'ANULADA') {
      throw new AppError(
        'RECEPCION_YA_ANULADA',
        'Esa entrega está anulada: no se le agregan fotos.',
        409,
      );
    }
    await guardarComprobantes(
      tx,
      { empresaId: ctx.empresaId, usuarioId: ctx.usuarioId },
      { recepcionCompraId: recepcionId },
      imagenes,
    );
    await registrarAuditoria(tx, {
      empresaId: ctx.empresaId,
      usuarioId: ctx.usuarioId,
      entidad: 'recepcion_compra',
      entidadId: recepcionId,
      accion: 'ACTUALIZAR',
      datosDespues: { comprobantesAgregados: imagenes.length },
      ip: ctx.ip ?? null,
    });
  });

  return obtenerRecepcion(ctx, recepcionId);
}

/**
 * Los bytes de UN comprobante, para mostrarlo. Se verifica que sea de la
 * empresa (404 si no: no se confirma que exista) y de una sucursal en la que
 * se pueda operar.
 */
export async function obtenerComprobante(
  ctx: Contexto,
  comprobanteId: string,
): Promise<{ tipo: string; datos: Uint8Array }> {
  const fila = await repo.comprobante(ctx.empresaId, comprobanteId);
  if (!fila) throw errores.noEncontrado('El comprobante');
  const sucursalId = fila.pago?.orden.sucursalId ?? fila.recepcion?.sucursalId;
  if (sucursalId === undefined || !puedeOperarEn(ctx, sucursalId)) {
    throw errores.sucursalNoPermitida();
  }
  return { tipo: fila.tipo, datos: fila.datos };
}
