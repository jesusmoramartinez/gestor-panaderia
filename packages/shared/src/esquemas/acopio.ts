import { z } from 'zod';

import { TIPOS_EVENTO } from '../dominio/historial.js';
import { EstadoOrdenSchema } from './compras.js';

/**
 * Las respuestas de "Lo que me deben" (Etapa 2, Fase 12a).
 *
 * Todos los importes y cantidades viajan como TEXTO, igual que en el resto de
 * la API: un number de JavaScript no puede llevar 0,1 exacto, y acá hay plata.
 */

const Referencia = z.object({ id: z.uuid(), nombre: z.string() });
const SucursalRef = z.object({ id: z.uuid(), codigo: z.string(), nombre: z.string() });

/** Un renglón pendiente: "OC 12 · Harina 000 · faltan 60 × Bolsa 25 kg ($1.200.000)". */
export const RenglonDeudaSchema = z.object({
  ordenId: z.uuid(),
  ordenNumero: z.number().int(),
  insumo: z.object({ id: z.uuid(), nombre: z.string(), unidadBaseCodigo: z.string() }),
  presentacion: z.object({ id: z.uuid(), nombre: z.string() }).nullable(),
  /** En presentaciones (o en unidad base, si se pidió sin presentación). */
  pendiente: z.string(),
  pendienteBase: z.string(),
  precioUnitario: z.string().nullable(),
  /** Null si el renglón no tiene precio. */
  valorPendiente: z.string().nullable(),
});
export type RenglonDeuda = z.infer<typeof RenglonDeudaSchema>;

/** Lo que me debe UN proveedor, sumando todas sus compras abiertas. */
export const DeudaProveedorSchema = z.object({
  proveedor: Referencia,
  /** Suma de lo pendiente que tiene precio. */
  valorPendiente: z.string(),
  /** Plata pagada que todavía no llegó como mercadería (ver cuentaDeCompra). */
  adelantadoSinEntregar: z.string(),
  renglonesSinPrecio: z.number().int(),
  renglones: z.array(RenglonDeudaSchema),
});
export type DeudaProveedor = z.infer<typeof DeudaProveedorSchema>;

/** Una compra que todavía espera mercadería, para ordenarlas por antigüedad. */
export const CompraAbiertaSchema = z.object({
  id: z.uuid(),
  numero: z.number().int(),
  estado: EstadoOrdenSchema,
  proveedor: Referencia,
  sucursal: SucursalRef,
  /** Cuándo se pidió (ISO). */
  pedidaAt: z.string().nullable(),
  /** Días desde que se pidió: "hace 12 días". */
  diasAbierta: z.number().int(),
  total: z.string().nullable(),
  valorRecibido: z.string(),
  valorPendiente: z.string(),
});
export type CompraAbierta = z.infer<typeof CompraAbiertaSchema>;

/**
 * Una compra terminada (cerrada con faltante o cancelada) que se pagó más de
 * lo que llegó: el proveedor tiene que devolver la diferencia.
 */
export const PlataAFavorSchema = z.object({
  id: z.uuid(),
  numero: z.number().int(),
  estado: EstadoOrdenSchema,
  proveedor: Referencia,
  monto: z.string(),
});
export type PlataAFavor = z.infer<typeof PlataAFavorSchema>;

export const LoQueMeDebenSchema = z.object({
  /** Todo lo que le deben, valorizado al precio de cada compra. */
  valorPendiente: z.string(),
  /**
   * Toda la plata suya que hoy tienen los proveedores: lo pagado y no
   * entregado de las compras abiertas, más la plata a favor de las terminadas.
   */
  adelantadoSinEntregar: z.string(),
  aFavor: z.array(PlataAFavorSchema),
  proveedores: z.array(DeudaProveedorSchema),
  /** De la más vieja a la más nueva. */
  comprasAbiertas: z.array(CompraAbiertaSchema),
});
export type LoQueMeDeben = z.infer<typeof LoQueMeDebenSchema>;

// ===========================================================================
// Historial y notas de una compra (Fase 12c)
// ===========================================================================

/** Una nota libre en una compra: "dicen que la próxima viene el 19". */
export const AgregarNotaSchema = z.object({
  texto: z.string().trim().min(1, 'Escribí la nota').max(500, 'Máximo 500 caracteres'),
});
export type AgregarNotaInput = z.infer<typeof AgregarNotaSchema>;

export const EventoHistorialSchema = z.object({
  tipo: z.enum(TIPOS_EVENTO),
  fecha: z.string(),
  usuario: Referencia.nullable(),
  titulo: z.string(),
  detalle: z.string().nullable(),
  recepcionId: z.uuid().nullable(),
});

export const HistorialCompraSchema = z.object({
  eventos: z.array(EventoHistorialSchema),
});
export type HistorialCompra = z.infer<typeof HistorialCompraSchema>;
