import { z } from 'zod';

import { ESTADOS_PAGO, MEDIOS_PAGO } from '../dominio/acopio.js';
import { aDecimal } from '../dominio/decimal.js';
import { FechaHechoSchema, NotasOpcional } from './movimientos.js';
import { PrecioSchema } from './proveedores.js';

/**
 * PAGOS Y COMPROBANTES (Etapa 2, Fase 12b).
 *
 * Las imágenes viajan dentro del JSON, en base64 (texto que representa
 * bytes). Ocupa un tercio más que el archivo, pero a cambio el pago y sus
 * fotos se guardan en UN pedido y en UNA transacción: nunca queda un pago
 * sin su foto ni una foto sin su pago. Con imágenes de ~300 KB (el navegador
 * las achica antes de mandarlas) el tercio extra no importa.
 */

export const MedioPagoSchema = z.enum(MEDIOS_PAGO);
export const EstadoPagoSchema = z.enum(ESTADOS_PAGO);

export const TIPOS_COMPROBANTE = ['image/jpeg', 'image/png', 'image/webp'] as const;
export type TipoComprobante = (typeof TIPOS_COMPROBANTE)[number];

/** Tope por imagen. El mismo número está en un CHECK de la base. */
export const MAX_BYTES_COMPROBANTE = 2 * 1024 * 1024;
/** Cuántas imágenes por pago o por entrega. */
export const MAX_COMPROBANTES = 4;

/** Una imagen en base64. Cuatro caracteres de base64 son tres bytes. */
export const ImagenEntradaSchema = z.object({
  datos: z
    .base64('La imagen llegó dañada')
    .min(4, 'La imagen está vacía')
    .max(Math.ceil(MAX_BYTES_COMPROBANTE / 3) * 4, 'La imagen pesa más de 2 MB'),
});
export type ImagenEntrada = z.infer<typeof ImagenEntradaSchema>;

const Comprobantes = z
  .array(ImagenEntradaSchema)
  .max(MAX_COMPROBANTES, `Máximo ${String(MAX_COMPROBANTES)} imágenes`);

/** Un monto de plata: como un precio, pero mayor que cero. */
export const MontoSchema = PrecioSchema.refine(
  (valor) => aDecimal(valor).greaterThan(0),
  'El monto tiene que ser mayor que cero',
);

/** Registrar un pago de una compra, con sus comprobantes (opcionales). */
export const RegistrarPagoSchema = z.object({
  /** Cuándo se pagó. Vacío = ahora. Pasada sí, futura no. */
  fecha: FechaHechoSchema,
  monto: MontoSchema,
  medio: MedioPagoSchema,
  nota: NotasOpcional,
  comprobantes: Comprobantes.default([]),
});
export type RegistrarPagoInput = z.infer<typeof RegistrarPagoSchema>;

/** Anular un pago: el motivo es obligatorio (cambia lo que se debe). */
export const AnularPagoSchema = z.object({
  motivo: z.string().trim().min(3, 'Contá por qué se anula').max(300, 'Máximo 300 caracteres'),
});
export type AnularPagoInput = z.infer<typeof AnularPagoSchema>;

/** Agregar fotos a un pago o a una entrega que ya existe. */
export const AgregarComprobantesSchema = z.object({
  comprobantes: Comprobantes.min(1, 'Elegí al menos una imagen'),
});
export type AgregarComprobantesInput = z.infer<typeof AgregarComprobantesSchema>;

// ===========================================================================
// Salidas
// ===========================================================================

const Referencia = z.object({ id: z.uuid(), nombre: z.string() });

/** Un comprobante, SIN sus bytes: la imagen se pide aparte, por su URL. */
export const ComprobanteSalidaSchema = z.object({
  id: z.uuid(),
  tipo: z.enum(TIPOS_COMPROBANTE),
  bytes: z.number().int(),
  creadoAt: z.string(),
});
export type ComprobanteSalida = z.infer<typeof ComprobanteSalidaSchema>;

export const PagoSalidaSchema = z.object({
  id: z.uuid(),
  fecha: z.string(),
  monto: z.string(),
  medio: MedioPagoSchema,
  nota: z.string().nullable(),
  usuario: Referencia,
  anuladoAt: z.string().nullable(),
  anuladoPor: Referencia.nullable(),
  motivoAnulacion: z.string().nullable(),
  comprobantes: z.array(ComprobanteSalidaSchema),
});
export type PagoSalida = z.infer<typeof PagoSalidaSchema>;

/** Las dos cuentas de una compra (ver cuentaDeCompra en dominio/acopio.ts). */
export const CuentaCompraSchema = z.object({
  total: z.string().nullable(),
  pagado: z.string(),
  saldo: z.string().nullable(),
  estadoPago: EstadoPagoSchema,
  valorRecibido: z.string(),
  valorPendiente: z.string(),
  adelantadoSinEntregar: z.string(),
  renglonesSinPrecio: z.number().int(),
});
export type CuentaCompraSalida = z.infer<typeof CuentaCompraSchema>;
