// CAPA 4 — ACCESO A DATOS: consultas. No decide reglas.
import type { Prisma } from '../../generated/prisma/client.js';
import type { EstadoTransferencia } from '../../generated/prisma/enums.js';
import { prisma } from '../../lib/db.js';
import type { Tx } from '../movimientos/motor.js';

export function sucursalesDeEmpresa(empresaId: string, ids: readonly string[]) {
  return prisma.sucursal.findMany({
    where: { empresaId, id: { in: [...ids] } },
    select: { id: true, nombre: true, activa: true },
  });
}

/**
 * Bloquea la transferencia hasta el fin de la transacción. Es lo que hace
 * que dos personas no puedan confirmar la misma recepción (ni recibirla
 * mientras otra la anula): la segunda espera, lee el estado ya cambiado y
 * choca con un 409.
 */
export async function bloquear(tx: Tx, empresaId: string, id: string): Promise<boolean> {
  const filas = await tx.$queryRaw<{ id: string }[]>`
    SELECT id FROM transferencia
    WHERE id = ${id}::uuid AND empresa_id = ${empresaId}::uuid
    FOR UPDATE`;
  return filas.length === 1;
}

/** Sin relaciones: es la versión que se lee adentro de la transacción. */
export function plana(tx: Tx, empresaId: string, id: string) {
  return tx.transferencia.findFirst({
    where: { id, empresaId },
    select: {
      id: true,
      numero: true,
      estado: true,
      sucursalOrigenId: true,
      sucursalDestinoId: true,
      fechaEnvio: true,
    },
  });
}

export function lineasPlanas(tx: Tx, transferenciaId: string) {
  return tx.lineaTransferencia.findMany({
    where: { transferenciaId },
    orderBy: { insumoId: 'asc' },
    select: { id: true, insumoId: true, cantidadBaseEnviada: true, costoUnitario: true },
  });
}

/**
 * El motivo "Diferencia en transferencia" de tipo MERMA, creándolo si no
 * existe (una empresa nueva podría no tenerlo sembrado).
 *
 * Con INSERT ... ON CONFLICT en una sola sentencia, y no con "buscar y si no
 * está, crear": dos recepciones simultáneas lo crearían dos veces (o una
 * chocaría con el UNIQUE). Si alguien lo había desactivado, se reactiva: el
 * sistema lo necesita para registrar la diferencia.
 */
export async function motivoDiferencia(tx: Tx, empresaId: string): Promise<string> {
  const filas = await tx.$queryRaw<{ id: string }[]>`
    INSERT INTO motivo_movimiento (empresa_id, tipo_aplicable, nombre)
    VALUES (${empresaId}::uuid, 'MERMA'::tipo_motivo, 'Diferencia en transferencia')
    ON CONFLICT (empresa_id, tipo_aplicable, nombre) DO UPDATE SET activo = true
    RETURNING id`;
  const id = filas[0]?.id;
  if (id === undefined) throw new Error('No se pudo obtener el motivo de diferencia');
  return id;
}

const SELECCION_RESUMEN = {
  id: true,
  numero: true,
  estado: true,
  fechaEnvio: true,
  fechaRecepcion: true,
  sucursalOrigenId: true,
  sucursalDestinoId: true,
  origen: { select: { id: true, codigo: true, nombre: true } },
  destino: { select: { id: true, codigo: true, nombre: true } },
  usuarioEnvio: { select: { id: true, nombre: true } },
  usuarioRecepcion: { select: { id: true, nombre: true } },
  lineas: { select: { cantidadBaseEnviada: true, cantidadBaseRecibida: true } },
} as const;

export type FilaResumen = Prisma.TransferenciaGetPayload<{ select: typeof SELECCION_RESUMEN }>;

export type FiltroLista = {
  empresaId: string;
  sucursalId: string;
  direccion: 'ENTRANTES' | 'SALIENTES' | 'TODAS';
  estado: EstadoTransferencia | undefined;
  limite: number;
  desplazamiento: number;
};

function where(filtro: FiltroLista): Prisma.TransferenciaWhereInput {
  const lado =
    filtro.direccion === 'ENTRANTES'
      ? { sucursalDestinoId: filtro.sucursalId }
      : filtro.direccion === 'SALIENTES'
        ? { sucursalOrigenId: filtro.sucursalId }
        : {
            OR: [{ sucursalOrigenId: filtro.sucursalId }, { sucursalDestinoId: filtro.sucursalId }],
          };
  return {
    empresaId: filtro.empresaId,
    ...lado,
    ...(filtro.estado === undefined ? {} : { estado: filtro.estado }),
  };
}

export function listar(filtro: FiltroLista) {
  return prisma.transferencia.findMany({
    where: where(filtro),
    orderBy: [{ fechaEnvio: 'desc' }, { numero: 'desc' }],
    take: filtro.limite,
    skip: filtro.desplazamiento,
    select: SELECCION_RESUMEN,
  });
}

export function contar(filtro: FiltroLista) {
  return prisma.transferencia.count({ where: where(filtro) });
}

export function detalle(empresaId: string, id: string) {
  return prisma.transferencia.findFirst({
    where: { id, empresaId },
    select: {
      ...SELECCION_RESUMEN,
      notas: true,
      notaRecepcion: true,
      anuladaAt: true,
      motivoAnulacion: true,
      anuladaPor: { select: { id: true, nombre: true } },
      lineas: {
        orderBy: { insumo: { nombre: 'asc' } },
        select: {
          id: true,
          cantidadIngresada: true,
          cantidadBaseEnviada: true,
          cantidadBaseRecibida: true,
          unidadIngresada: { select: { codigo: true } },
          insumo: { select: { id: true, nombre: true, unidadBase: { select: { codigo: true } } } },
        },
      },
    },
  });
}
