import { z } from 'zod';

import { aDecimal, esDecimalValido, normalizarNumero } from '../dominio/decimal.js';
import { ACCIONES_TRANSFERENCIA, ESTADOS_TRANSFERENCIA } from '../dominio/transferencias.js';
import { SucursalResumenSchema } from './auth.js';
import { FechaHechoSchema, LineaMovimientoSchema, NotasOpcional } from './movimientos.js';

export const EstadoTransferenciaSchema = z.enum(ESTADOS_TRANSFERENCIA);

// ===========================================================================
// Entradas
// ===========================================================================

/**
 * Enviar insumos a otra sucursal.
 *
 * Las líneas son las mismas que las de un consumo (insumo, cantidad y, si se
 * quiere, la unidad en que se tipeó): para el ORIGEN, una transferencia es una
 * salida más, y pasa por el mismo motor.
 *
 * Lleva `forzar` igual que el consumo: si el sistema dice 12 kg y en el
 * depósito hay 20 porque falta cargar una compra, trabar el envío no arregla
 * nada. Solo se honra con el permiso `stock:forzar`.
 */
export const EnviarTransferenciaSchema = z
  .object({
    sucursalOrigenId: z.uuid('Hay que elegir de dónde sale'),
    sucursalDestinoId: z.uuid('Hay que elegir a dónde va'),
    fecha: FechaHechoSchema,
    notas: NotasOpcional,
    forzar: z.boolean().default(false),
    lineas: z
      .array(LineaMovimientoSchema)
      .min(1, 'Hay que enviar al menos un insumo')
      .max(100, 'Máximo 100 líneas por transferencia')
      .refine(
        (lineas) => new Set(lineas.map((linea) => linea.insumoId)).size === lineas.length,
        'Hay un insumo repetido: ponelo una sola vez con la cantidad total',
      ),
  })
  .refine((valores) => valores.sucursalOrigenId !== valores.sucursalDestinoId, {
    error: 'El destino tiene que ser otra sucursal',
    path: ['sucursalDestinoId'],
  });
export type EnviarTransferenciaInput = z.infer<typeof EnviarTransferenciaSchema>;

/** Cuánto llegó de una línea. Cero es válido: no llegó nada. */
const CantidadRecibidaSchema = z
  .string()
  .trim()
  .min(1, 'Hay que indicar cuánto llegó (0 si no llegó nada)')
  .transform(normalizarNumero)
  .refine((valor) => esDecimalValido(valor), 'No es un número válido')
  .refine((valor) => aDecimal(valor).greaterThanOrEqualTo(0), 'No puede ser negativo');

/**
 * Confirmar que llegó (C-19: "el que recibe confirma").
 *
 * Trae una línea por CADA línea de la transferencia, con lo que llegó en la
 * unidad base del insumo. Si llegó menos, la diferencia se registra como
 * merma en el destino (ver `movimientosAlRecibir`). Que tenga que venir cada
 * línea es a propósito: "no dijo nada de la levadura" no puede interpretarse
 * en silencio como "llegó toda".
 */
export const RecibirTransferenciaSchema = z.object({
  fecha: FechaHechoSchema,
  notas: NotasOpcional,
  lineas: z
    .array(z.object({ lineaId: z.uuid(), cantidadRecibida: CantidadRecibidaSchema }))
    .min(1, 'Faltan las líneas')
    .refine(
      (lineas) => new Set(lineas.map((linea) => linea.lineaId)).size === lineas.length,
      'Hay una línea repetida',
    ),
});
export type RecibirTransferenciaInput = z.infer<typeof RecibirTransferenciaSchema>;

/** Anular un envío que todavía no llegó. El porqué es obligatorio. */
export const AnularTransferenciaSchema = z.object({
  motivo: z.string().trim().min(3, 'Contá por qué se anula').max(300, 'Máximo 300 caracteres'),
});
export type AnularTransferenciaInput = z.infer<typeof AnularTransferenciaSchema>;

/**
 * Las dos bandejas de la pantalla, vistas desde UNA sucursal:
 *   ENTRANTES  — vienen para acá
 *   SALIENTES  — salieron de acá
 */
export const FiltroTransferenciasSchema = z.object({
  sucursalId: z.uuid('Hay que elegir una sucursal'),
  direccion: z.enum(['ENTRANTES', 'SALIENTES', 'TODAS']).default('TODAS'),
  estado: EstadoTransferenciaSchema.optional(),
  limite: z.coerce.number().int().min(1).max(200).default(50),
  desplazamiento: z.coerce.number().int().min(0).default(0),
});
export type FiltroTransferencias = z.infer<typeof FiltroTransferenciasSchema>;

// ===========================================================================
// Salidas
// ===========================================================================

const SucursalRef = z.object({ id: z.uuid(), codigo: z.string(), nombre: z.string() });
const Referencia = z.object({ id: z.uuid(), nombre: z.string() });

/**
 * Fijate que no hay costos acá: una transferencia son cantidades, y la bandeja
 * la ve también el empleado de la sucursal que recibe.
 */
export const TransferenciaResumenSchema = z.object({
  id: z.uuid(),
  numero: z.number().int(),
  estado: EstadoTransferenciaSchema,
  origen: SucursalRef,
  destino: SucursalRef,
  fechaEnvio: z.string(),
  fechaRecepcion: z.string().nullable(),
  usuarioEnvio: Referencia,
  usuarioRecepcion: Referencia.nullable(),
  cantidadLineas: z.number().int(),
  /** Recibida con alguna línea en menos. */
  conDiferencia: z.boolean(),
});
export type TransferenciaResumen = z.infer<typeof TransferenciaResumenSchema>;

export const ListaTransferenciasSchema = z.object({
  items: z.array(TransferenciaResumenSchema),
  total: z.number().int(),
});
export type ListaTransferencias = z.infer<typeof ListaTransferenciasSchema>;

export const LineaTransferenciaSalidaSchema = z.object({
  id: z.uuid(),
  insumo: z.object({ id: z.uuid(), nombre: z.string(), unidadBaseCodigo: z.string() }),
  /** Lo que tipeó quien envió: "2000 g". */
  cantidadIngresada: z.string(),
  unidadIngresadaCodigo: z.string(),
  cantidadBaseEnviada: z.string(),
  /** Null mientras está en tránsito. */
  cantidadBaseRecibida: z.string().nullable(),
  /** enviada − recibida. Null mientras está en tránsito. */
  diferencia: z.string().nullable(),
});
export type LineaTransferenciaSalida = z.infer<typeof LineaTransferenciaSalidaSchema>;

export const TransferenciaDetalleSchema = TransferenciaResumenSchema.extend({
  notas: z.string().nullable(),
  notaRecepcion: z.string().nullable(),
  anuladaAt: z.string().nullable(),
  anuladaPor: Referencia.nullable(),
  motivoAnulacion: z.string().nullable(),
  lineas: z.array(LineaTransferenciaSalidaSchema),
  /** Qué se puede hacer AHORA según el estado (la pantalla filtra por permiso y sucursal). */
  acciones: z.array(z.enum(ACCIONES_TRANSFERENCIA)),
});
export type TransferenciaDetalle = z.infer<typeof TransferenciaDetalleSchema>;

/** Todas las sucursales activas de la empresa: para elegir el destino. */
export const ListaSucursalesSchema = z.array(SucursalResumenSchema);
