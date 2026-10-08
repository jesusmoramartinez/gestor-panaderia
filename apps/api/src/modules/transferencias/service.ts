// CAPA 3 — SERVICIO: las reglas del negocio. No sabe que existe HTTP.
import {
  accionesDeTransferencia,
  aDecimal,
  type AnularTransferenciaInput,
  diferenciaDeTransferencia,
  type EnviarTransferenciaInput,
  type FiltroTransferencias,
  formatearFechaArgentina,
  type ListaTransferencias,
  movimientosAlRecibir,
  type RecibirTransferenciaInput,
  redondearCantidad,
  type TransferenciaDetalle,
  type TransferenciaResumen,
} from '@panaderia/shared';
import { randomUUID } from 'node:crypto';

import { registrarAuditoria } from '../../lib/auditoria.js';
import { type Contexto, puedeOperarEn } from '../../lib/contexto.js';
import { prisma } from '../../lib/db.js';
import { AppError, errores } from '../../lib/errores.js';
import { siguienteNumero } from '../compras/numeracion.js';
import { type EntradaMovimiento, registrarMovimientos, type Tx } from '../movimientos/motor.js';
import * as repo from './repo.js';

/**
 * TRANSFERENCIAS ENTRE SUCURSALES.
 *
 * Una operación que afecta DOS lugares se parte en DOS hechos, hechos por dos
 * personas en dos momentos:
 *
 *   enviar   (en el origen)   → TRANSFERENCIA_SALIDA. Queda EN TRÁNSITO.
 *   recibir  (en el destino)  → TRANSFERENCIA_ENTRADA por lo enviado, y una
 *                               MERMA por lo que no llegó.
 *
 * Mientras está en tránsito, la mercadería no está en el stock de ninguna de
 * las dos sucursales. Eso no es un error: va en la camioneta. La "bandeja en
 * tránsito" es simplemente la lista de transferencias ENVIADAS.
 *
 * Todo lo que escribe movimientos pasa por el motor, como siempre.
 */

function aResumen(fila: repo.FilaResumen): TransferenciaResumen {
  return {
    id: fila.id,
    numero: fila.numero,
    estado: fila.estado,
    origen: fila.origen,
    destino: fila.destino,
    fechaEnvio: fila.fechaEnvio.toISOString(),
    fechaRecepcion: fila.fechaRecepcion?.toISOString() ?? null,
    usuarioEnvio: fila.usuarioEnvio,
    usuarioRecepcion: fila.usuarioRecepcion,
    cantidadLineas: fila.lineas.length,
    conDiferencia: fila.lineas.some(
      (linea) =>
        linea.cantidadBaseRecibida !== null &&
        !diferenciaDeTransferencia(
          linea.cantidadBaseEnviada.toString(),
          linea.cantidadBaseRecibida.toString(),
        ).isZero(),
    ),
  };
}

function noEnTransito(numero: number, estado: 'RECIBIDA' | 'ANULADA', que: string): AppError {
  const pista =
    estado === 'RECIBIDA'
      ? ' Si se mandó de más, hacé una transferencia de vuelta: así quedan los dos hechos registrados.'
      : '';
  return new AppError(
    'TRANSFERENCIA_NO_EN_TRANSITO',
    `La transferencia ${String(numero)} ya está ${estado.toLowerCase()}: no se puede ${que}.${pista}`,
    409,
    { estado },
  );
}

/** Bloquea y lee. Todo lo que cambia una transferencia empieza acá. */
async function bloquearYLeer(tx: Tx, ctx: Contexto, id: string) {
  if (!(await repo.bloquear(tx, ctx.empresaId, id))) throw errores.noEncontrado('La transferencia');
  const transferencia = await repo.plana(tx, ctx.empresaId, id);
  if (!transferencia) throw errores.noEncontrado('La transferencia');
  return transferencia;
}

// ===========================================================================
// Comandos
// ===========================================================================

/**
 * ENVIAR. Para el origen es una salida más: el motor bloquea el contador,
 * controla que haya stock (o que se fuerce con permiso) y congela el costo
 * promedio en el movimiento. Ese costo se copia a la línea: la mercadería
 * viaja AL COSTO y entra al destino con el mismo valor con que salió.
 */
export async function enviar(
  ctx: Contexto,
  entrada: EnviarTransferenciaInput,
): Promise<TransferenciaDetalle> {
  // El middleware ya verificó que puede operar en el ORIGEN. Acá se verifica
  // que las dos sucursales sean de su empresa: el destino viene del cliente y
  // nadie lo había mirado todavía. (El CHECK de la base solo puede ver que
  // sean distintas, no de qué empresa son.)
  const sucursales = await repo.sucursalesDeEmpresa(ctx.empresaId, [
    entrada.sucursalOrigenId,
    entrada.sucursalDestinoId,
  ]);
  const origen = sucursales.find((s) => s.id === entrada.sucursalOrigenId);
  const destino = sucursales.find((s) => s.id === entrada.sucursalDestinoId);
  if (!origen) throw errores.noEncontrado('La sucursal de origen');
  if (!destino?.activa) {
    throw errores.datosInvalidos({ sucursalDestinoId: 'Esa sucursal no existe en tu empresa.' });
  }

  const id = randomUUID();
  const operacionId = randomUUID();
  const fecha = entrada.fecha === null ? new Date() : new Date(entrada.fecha);

  await prisma.$transaction(async (tx) => {
    const numero = await siguienteNumero(tx, ctx.empresaId, 'TRANSFERENCIA');

    // Primero el documento: los movimientos apuntan a él (clave foránea).
    await tx.transferencia.create({
      data: {
        id,
        empresaId: ctx.empresaId,
        sucursalOrigenId: origen.id,
        sucursalDestinoId: destino.id,
        numero,
        notas: entrada.notas,
        fechaEnvio: fecha,
        usuarioEnvioId: ctx.usuarioId,
        operacionEnvioId: operacionId,
      },
      select: { id: true },
    });

    const registro = await registrarMovimientos(
      tx,
      ctx,
      entrada.lineas.map((linea) => ({
        sucursalId: origen.id,
        insumoId: linea.insumoId,
        tipo: 'TRANSFERENCIA_SALIDA' as const,
        cantidad: linea.cantidad,
        unidadId: linea.unidadId,
        notas: linea.notas ?? entrada.notas ?? `A ${destino.nombre}`,
        transferenciaId: id,
      })),
      { fecha, forzar: entrada.forzar, operacionId },
    );

    // Las líneas se arman con lo que ESCRIBIÓ el motor (la cantidad ya
    // convertida, el factor y el costo congelado), no recalculando: así la
    // línea y el movimiento no pueden contar dos historias distintas.
    const escritos = await tx.movimientoStock.findMany({
      where: { id: { in: registro.movimientoIds } },
      select: {
        insumoId: true,
        cantidadBase: true,
        cantidadIngresada: true,
        unidadIngresadaId: true,
        factorConversion: true,
        costoUnitario: true,
      },
    });
    await tx.lineaTransferencia.createMany({
      data: escritos.map((m) => ({
        empresaId: ctx.empresaId,
        transferenciaId: id,
        insumoId: m.insumoId,
        cantidadIngresada: m.cantidadIngresada.toString(),
        unidadIngresadaId: m.unidadIngresadaId,
        factorConversion: m.factorConversion.toString(),
        cantidadBaseEnviada: aDecimal(m.cantidadBase.toString()).abs().toString(),
        costoUnitario: m.costoUnitario?.toString() ?? null,
      })),
    });

    await registrarAuditoria(tx, {
      empresaId: ctx.empresaId,
      usuarioId: ctx.usuarioId,
      entidad: 'transferencia',
      entidadId: id,
      accion: 'CREAR',
      datosDespues: { numero, ...entrada },
      ip: ctx.ip ?? null,
    });
  });

  return obtener(ctx, id);
}

/**
 * RECIBIR (C-19: "el que recibe confirma").
 *
 * Por cada línea: entra lo ENVIADO y, si llegó menos, una MERMA por la
 * diferencia con motivo "Diferencia en transferencia" (decisión del cliente;
 * la explicación de por qué así está en `movimientosAlRecibir`).
 *
 * LA REGLA QUE IMPORTA: se recibe una sola vez. El estado se lee DESPUÉS del
 * candado de la transferencia: si dos personas apretan "confirmar" a la vez,
 * la segunda espera, lee RECIBIDA y choca con 409. Sin el candado, las dos
 * leerían ENVIADA y el destino sumaría el doble.
 */
export async function recibir(
  ctx: Contexto,
  id: string,
  entrada: RecibirTransferenciaInput,
): Promise<TransferenciaDetalle> {
  await prisma.$transaction(async (tx) => {
    const transferencia = await bloquearYLeer(tx, ctx, id);

    // La sucursal no viene en el pedido: es el DESTINO de la transferencia.
    // Por eso el control es del servicio y no del middleware.
    if (!puedeOperarEn(ctx, transferencia.sucursalDestinoId)) throw errores.sucursalNoPermitida();
    if (transferencia.estado !== 'ENVIADA') {
      throw noEnTransito(transferencia.numero, transferencia.estado, 'recibir');
    }

    const fecha = entrada.fecha === null ? new Date() : new Date(entrada.fecha);
    if (fecha < transferencia.fechaEnvio) {
      throw errores.datosInvalidos({
        fecha: `No puede haber llegado antes de salir (salió el ${formatearFechaArgentina(transferencia.fechaEnvio)}).`,
      });
    }

    // Tiene que venir CADA línea, ni una más ni una menos.
    const lineas = await repo.lineasPlanas(tx, id);
    const recibidas = new Map(entrada.lineas.map((l) => [l.lineaId, l.cantidadRecibida]));
    const ajenas = entrada.lineas.filter((l) => !lineas.some((linea) => linea.id === l.lineaId));
    if (ajenas.length > 0 || recibidas.size !== lineas.length) {
      throw errores.datosInvalidos({
        lineas: 'Hay que indicar cuánto llegó de cada insumo de la transferencia, y solo de esos.',
      });
    }

    const motivoId = await repo.motivoDiferencia(tx, ctx.empresaId);
    const aEscribir: EntradaMovimiento[] = [];
    const cantidades = new Map<string, string>();

    for (const [indice, linea] of lineas.entries()) {
      const recibida = redondearCantidad(recibidas.get(linea.id) ?? '0');
      let movimientos;
      try {
        movimientos = movimientosAlRecibir(linea.cantidadBaseEnviada.toString(), recibida);
      } catch (error) {
        throw errores.datosInvalidos({
          [`lineas.${String(indice)}.cantidadRecibida`]:
            error instanceof Error ? error.message : 'Cantidad inválida',
        });
      }
      cantidades.set(linea.id, recibida.toString());

      for (const movimiento of movimientos) {
        aEscribir.push({
          sucursalId: transferencia.sucursalDestinoId,
          insumoId: linea.insumoId,
          tipo: movimiento.tipo,
          cantidad: movimiento.cantidad,
          unidadId: null,
          // Entra al costo con que salió: la mercadería no se revaloriza en
          // el camino. Y la merma vale lo mismo que lo que se perdió.
          costoUnitario: linea.costoUnitario?.toString() ?? null,
          motivoId: movimiento.tipo === 'MERMA' ? motivoId : null,
          notas: entrada.notas,
          transferenciaId: id,
        });
      }
    }

    const operacionId = randomUUID();
    await registrarMovimientos(tx, ctx, aEscribir, { fecha, operacionId });

    for (const linea of lineas) {
      await tx.lineaTransferencia.update({
        where: { id: linea.id },
        data: { cantidadBaseRecibida: cantidades.get(linea.id) ?? '0' },
      });
    }
    await tx.transferencia.update({
      where: { id },
      data: {
        estado: 'RECIBIDA',
        fechaRecepcion: fecha,
        usuarioRecepcionId: ctx.usuarioId,
        operacionRecepcionId: operacionId,
        notaRecepcion: entrada.notas,
      },
    });

    await registrarAuditoria(tx, {
      empresaId: ctx.empresaId,
      usuarioId: ctx.usuarioId,
      entidad: 'transferencia',
      entidadId: id,
      accion: 'ACTUALIZAR',
      datosAntes: { estado: 'ENVIADA' },
      datosDespues: { estado: 'RECIBIDA', lineas: entrada.lineas },
      ip: ctx.ip ?? null,
    });
  });

  return obtener(ctx, id);
}

/**
 * ANULAR un envío que todavía no llegó: el stock vuelve al origen con una
 * REVERSA de cada salida. Una vez recibida, no se anula (ver
 * `accionesDeTransferencia`).
 */
export async function anular(
  ctx: Contexto,
  id: string,
  entrada: AnularTransferenciaInput,
): Promise<TransferenciaDetalle> {
  await prisma.$transaction(async (tx) => {
    const transferencia = await bloquearYLeer(tx, ctx, id);

    // Anula quien envía: tiene que poder operar en el ORIGEN.
    if (!puedeOperarEn(ctx, transferencia.sucursalOrigenId)) throw errores.sucursalNoPermitida();
    if (transferencia.estado !== 'ENVIADA') {
      throw noEnTransito(transferencia.numero, transferencia.estado, 'anular');
    }

    const salidas = await tx.movimientoStock.findMany({
      where: { empresaId: ctx.empresaId, transferenciaId: id, tipo: 'TRANSFERENCIA_SALIDA' },
      orderBy: { insumoId: 'asc' },
      select: {
        id: true,
        sucursalId: true,
        insumoId: true,
        cantidadBase: true,
        costoUnitario: true,
      },
    });

    await registrarMovimientos(
      tx,
      ctx,
      salidas.map((salida) => ({
        sucursalId: salida.sucursalId,
        insumoId: salida.insumoId,
        tipo: 'REVERSA' as const,
        cantidad: aDecimal(salida.cantidadBase.toString()).abs(),
        unidadId: null,
        sentido: 'ENTRADA' as const,
        revierteAId: salida.id,
        costoUnitario: salida.costoUnitario?.toString() ?? null,
        transferenciaId: id,
        notas: `Anulación de la transferencia ${String(transferencia.numero)}: ${entrada.motivo}`,
      })),
    );

    await tx.transferencia.update({
      where: { id },
      data: {
        estado: 'ANULADA',
        anuladaAt: new Date(),
        anuladaPorId: ctx.usuarioId,
        motivoAnulacion: entrada.motivo,
      },
    });

    await registrarAuditoria(tx, {
      empresaId: ctx.empresaId,
      usuarioId: ctx.usuarioId,
      entidad: 'transferencia',
      entidadId: id,
      accion: 'ANULAR',
      datosAntes: { estado: 'ENVIADA' },
      datosDespues: { estado: 'ANULADA', motivo: entrada.motivo },
      ip: ctx.ip ?? null,
    });
  });

  return obtener(ctx, id);
}

// ===========================================================================
// Consultas
// ===========================================================================

export async function obtener(ctx: Contexto, id: string): Promise<TransferenciaDetalle> {
  const fila = await repo.detalle(ctx.empresaId, id);
  if (!fila) throw errores.noEncontrado('La transferencia');
  // La ve quien puede operar en cualquiera de las dos puntas.
  if (!puedeOperarEn(ctx, fila.sucursalOrigenId) && !puedeOperarEn(ctx, fila.sucursalDestinoId)) {
    throw errores.sucursalNoPermitida();
  }

  return {
    ...aResumen(fila),
    notas: fila.notas,
    notaRecepcion: fila.notaRecepcion,
    anuladaAt: fila.anuladaAt?.toISOString() ?? null,
    anuladaPor: fila.anuladaPor,
    motivoAnulacion: fila.motivoAnulacion,
    lineas: fila.lineas.map((linea) => ({
      id: linea.id,
      insumo: {
        id: linea.insumo.id,
        nombre: linea.insumo.nombre,
        unidadBaseCodigo: linea.insumo.unidadBase.codigo,
      },
      cantidadIngresada: linea.cantidadIngresada.toString(),
      unidadIngresadaCodigo: linea.unidadIngresada.codigo,
      cantidadBaseEnviada: linea.cantidadBaseEnviada.toString(),
      cantidadBaseRecibida: linea.cantidadBaseRecibida?.toString() ?? null,
      diferencia:
        linea.cantidadBaseRecibida === null
          ? null
          : diferenciaDeTransferencia(
              linea.cantidadBaseEnviada.toString(),
              linea.cantidadBaseRecibida.toString(),
            ).toString(),
    })),
    acciones: [...accionesDeTransferencia(fila.estado)],
  };
}

export async function listar(
  ctx: Contexto,
  filtro: FiltroTransferencias,
): Promise<ListaTransferencias> {
  const consulta: repo.FiltroLista = {
    empresaId: ctx.empresaId,
    sucursalId: filtro.sucursalId,
    direccion: filtro.direccion,
    estado: filtro.estado,
    limite: filtro.limite,
    desplazamiento: filtro.desplazamiento,
  };
  const [filas, total] = await Promise.all([repo.listar(consulta), repo.contar(consulta)]);
  return { items: filas.map(aResumen), total };
}
