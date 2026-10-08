import { z } from 'zod';

import { aDecimal, esDecimalValido, normalizarNumero } from '../dominio/decimal.js';

/**
 * Un importe escrito por una persona.
 *
 * Mismo criterio que las cantidades (ver esquemas/insumos.ts): llega como
 * TEXTO, se acepta escrito a la argentina ("32.500,50") y se normaliza. Nunca
 * como number: un precio en float arrastra error al valuar el stock.
 */
const PrecioSchema = z
  .string()
  .trim()
  .min(1, 'Hay que indicar un precio')
  .transform(normalizarNumero)
  .refine((valor) => esDecimalValido(valor), 'No es un número válido')
  .refine((valor) => aDecimal(valor).greaterThanOrEqualTo(0), 'El precio no puede ser negativo');

/**
 * Precio opcional: el <input> vacío llega como '' y significa "no sé el
 * precio", que es distinto de "cuesta cero".
 */
const PrecioOpcional = z
  .union([z.literal(''), z.null(), PrecioSchema])
  .nullish()
  .transform((valor) => (valor === '' || valor === undefined ? null : valor));

/** Igual que en insumos: un <select> sin elegir manda '' y eso significa null. */
const UuidOpcional = z
  .union([z.literal(''), z.null(), z.uuid('Identificador inválido')])
  .nullish()
  .transform((valor) => (valor === '' || valor === undefined ? null : valor));

const TextoOpcional = (maximo: number) =>
  z
    .string()
    .trim()
    .max(maximo, `Máximo ${String(maximo)} caracteres`)
    .nullish()
    .transform((valor) => (valor === undefined || valor === null || valor === '' ? null : valor));

/**
 * El CUIT argentino: 11 dígitos. Se acepta con guiones porque así se lee y así
 * está impreso en la factura, y se guarda sin ellos para poder compararlos.
 *
 * NO se valida el dígito verificador a propósito: es una cuenta que podríamos
 * hacer, pero si el proveedor dicta mal un número por teléfono es peor
 * trabarle el alta al encargado que guardar un CUIT con un dígito cambiado.
 * Si el cliente lo pide, el lugar es acá y se agrega con su test.
 */
const CuitOpcional = z
  .string()
  .trim()
  .nullish()
  .transform((valor) =>
    valor === undefined || valor === null ? null : valor.replace(/[\s.-]/g, ''),
  )
  .refine(
    (valor) => valor === null || valor === '' || /^\d{11}$/.test(valor),
    'El CUIT tiene 11 dígitos',
  )
  .transform((valor) => (valor === '' ? null : valor));

/**
 * Días de entrega: entero, opcional.
 *
 * Acá sí usamos number y no Decimal, porque es una CUENTA de días, no una
 * cantidad ni dinero: no se multiplica por un precio ni se acumula en un
 * saldo, así que el redondeo del float no puede hacer daño.
 */
const DiasEntregaOpcional = z
  .union([z.string(), z.number(), z.null()])
  .nullish()
  // Primero normalizamos (el <input> manda texto) y DESPUÉS validamos. Si en
  // cambio pusiéramos el .int() adentro de la unión, Zod no podría saber qué
  // rama falló y el mensaje sería un "Invalid input" inservible.
  .transform((valor) => {
    if (valor === null || valor === undefined) return null;
    if (typeof valor === 'string' && valor.trim() === '') return null;
    return Number(valor);
  })
  .refine(
    (valor) => valor === null || Number.isInteger(valor),
    'Tiene que ser un número entero de días',
  )
  .refine((valor) => valor === null || valor >= 0, 'No puede ser negativo');

// ===========================================================================
// Entradas
// ===========================================================================

export const CrearProveedorSchema = z.object({
  nombre: z.string().trim().min(1, 'El nombre es obligatorio').max(120),
  razonSocial: TextoOpcional(160),
  cuit: CuitOpcional,
  // z.email() valida la forma del email; si está vacío, queda en null.
  email: z
    .union([z.literal(''), z.null(), z.email('No parece un email válido')])
    .nullish()
    .transform((valor) => (valor === '' || valor === undefined ? null : valor)),
  telefono: TextoOpcional(40),
  direccion: TextoOpcional(200),
  contactoNombre: TextoOpcional(120),
  diasEntrega: DiasEntregaOpcional,
  notas: TextoOpcional(500),
});
export type CrearProveedorInput = z.infer<typeof CrearProveedorSchema>;

/** PATCH: lo que no venga, no se toca. Un null sí borra el valor. */
export const ActualizarProveedorSchema = CrearProveedorSchema.partial();
export type ActualizarProveedorInput = z.infer<typeof ActualizarProveedorSchema>;

/**
 * Asociar un insumo a un proveedor.
 *
 * `insumoId` es obligatorio y `proveedorId` NO está: viene en la URL. Si
 * estuviera en el cuerpo habría dos fuentes para el mismo dato y habría que
 * decidir cuál gana.
 */
export const CrearProveedorInsumoSchema = z.object({
  insumoId: z.uuid('Hay que elegir un insumo'),
  /** Null = lo vende en la unidad base del insumo. */
  presentacionId: UuidOpcional,
  codigoProveedor: TextoOpcional(60),
  ultimoPrecio: PrecioOpcional,
  esPreferido: z.boolean().default(false),
});
export type CrearProveedorInsumoInput = z.infer<typeof CrearProveedorInsumoSchema>;

/**
 * Al editar la asociación NO se puede cambiar el insumo, y por eso el campo
 * directamente no existe acá (mismo truco que con la unidad base del insumo:
 * Zod descarta las claves que no declara).
 *
 * Cambiar el insumo de una asociación no sería "editar": sería borrar una
 * relación y crear otra, arrastrando por error el precio de la anterior.
 */
export const ActualizarProveedorInsumoSchema = CrearProveedorInsumoSchema.omit({
  insumoId: true,
})
  .partial()
  .extend({ activo: z.boolean().optional() });
export type ActualizarProveedorInsumoInput = z.infer<typeof ActualizarProveedorInsumoSchema>;

export const FiltroProveedoresSchema = z.object({
  busqueda: z.string().trim().max(80).optional(),
  incluirInactivos: z.stringbool().default(false),
});
export type FiltroProveedores = z.infer<typeof FiltroProveedoresSchema>;

// ===========================================================================
// Salidas
// ===========================================================================

export const ProveedorResumenSchema = z.object({
  id: z.uuid(),
  nombre: z.string(),
  razonSocial: z.string().nullable(),
  cuit: z.string().nullable(),
  email: z.string().nullable(),
  telefono: z.string().nullable(),
  direccion: z.string().nullable(),
  contactoNombre: z.string().nullable(),
  diasEntrega: z.number().int().nullable(),
  notas: z.string().nullable(),
  activo: z.boolean(),
  /** Cuántos insumos le compramos (solo las asociaciones activas). */
  cantidadInsumos: z.number().int(),
});
export type ProveedorResumen = z.infer<typeof ProveedorResumenSchema>;

/**
 * Una línea de la tabla puente, vista DESDE el proveedor: qué insumo es.
 *
 * El precio viaja como texto, igual que toda cantidad decimal del sistema.
 */
export const InsumoDeProveedorSchema = z.object({
  id: z.uuid(),
  insumo: z.object({
    id: z.uuid(),
    nombre: z.string(),
    activo: z.boolean(),
    unidadBaseCodigo: z.string(),
  }),
  presentacion: z.object({ id: z.uuid(), nombre: z.string(), cantidadBase: z.string() }).nullable(),
  codigoProveedor: z.string().nullable(),
  ultimoPrecio: z.string().nullable(),
  /** ISO 8601 en UTC; la pantalla lo muestra en hora de Argentina. */
  ultimoPrecioAt: z.string().nullable(),
  esPreferido: z.boolean(),
  activo: z.boolean(),
});
export type InsumoDeProveedor = z.infer<typeof InsumoDeProveedorSchema>;

/** La misma fila vista DESDE el insumo: quién lo provee. */
export const ProveedorDeInsumoSchema = InsumoDeProveedorSchema.omit({ insumo: true }).extend({
  proveedor: z.object({
    id: z.uuid(),
    nombre: z.string(),
    activo: z.boolean(),
    diasEntrega: z.number().int().nullable(),
  }),
});
export type ProveedorDeInsumo = z.infer<typeof ProveedorDeInsumoSchema>;

export const ProveedorDetalleSchema = ProveedorResumenSchema.extend({
  insumos: z.array(InsumoDeProveedorSchema),
});
export type ProveedorDetalle = z.infer<typeof ProveedorDetalleSchema>;

export const ListaProveedoresSchema = z.array(ProveedorResumenSchema);
export const ListaProveedoresDeInsumoSchema = z.array(ProveedorDeInsumoSchema);
