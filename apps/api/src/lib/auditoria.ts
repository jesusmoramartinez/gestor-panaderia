import type { AccionAuditoria } from '../generated/prisma/enums.js';
import type { Prisma } from '../generated/prisma/client.js';
import { prisma } from './db.js';

/**
 * Cualquier cliente de Prisma que sepa escribir en `auditoria`.
 *
 * Este tipo es el truco que permite llamar a registrarAuditoria tanto con el
 * cliente normal como con el cliente de una TRANSACCIÓN (el `tx` de
 * prisma.$transaction). Los dos tienen la propiedad `auditoria`, así que los
 * dos encajan, y no hace falta importar tipos internos de Prisma.
 *
 * Importa porque la auditoría tiene que escribirse en la MISMA transacción
 * que el cambio que audita: si el cambio se deshace, el registro también.
 */
export type ClienteAuditoria = Pick<typeof prisma, 'auditoria'>;

export type EventoAuditoria = {
  /** Nullable: un login fallido con un email inexistente no tiene empresa. */
  empresaId?: string | null;
  usuarioId?: string | null;
  /** Qué tipo de cosa se tocó: 'usuario', 'sesion', 'insumo'... */
  entidad: string;
  entidadId?: string | null;
  accion: AccionAuditoria;
  datosAntes?: unknown;
  datosDespues?: unknown;
  ip?: string | null;
};

/**
 * Convierte cualquier valor a algo que Postgres pueda guardar como jsonb.
 *
 * El ida y vuelta por JSON.stringify no es un adorno: descarta los `undefined`
 * y convierte las fechas a texto ISO. Sin eso, Prisma rechaza el valor o
 * guarda algo que después no se puede leer.
 */
function aJson(valor: unknown): Prisma.InputJsonValue | undefined {
  if (valor === undefined || valor === null) return undefined;
  return JSON.parse(JSON.stringify(valor)) as Prisma.InputJsonValue;
}

/**
 * Registra un evento en la auditoría.
 *
 * Se llama desde los SERVICIOS (nunca desde los controladores), porque el
 * servicio es el que sabe qué cambió y es el que abre la transacción.
 */
export async function registrarAuditoria(
  cliente: ClienteAuditoria,
  evento: EventoAuditoria,
): Promise<void> {
  await cliente.auditoria.create({
    data: {
      empresaId: evento.empresaId ?? null,
      usuarioId: evento.usuarioId ?? null,
      entidad: evento.entidad,
      entidadId: evento.entidadId ?? null,
      accion: evento.accion,
      datosAntes: aJson(evento.datosAntes),
      datosDespues: aJson(evento.datosDespues),
      ip: evento.ip ?? null,
    },
  });
}
