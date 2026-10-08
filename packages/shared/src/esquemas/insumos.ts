import { z } from 'zod';

import { aDecimal, esDecimalValido, normalizarNumero } from '../dominio/decimal.js';
import { DimensionSchema } from './unidades.js';

/**
 * Una cantidad escrita por una persona.
 *
 * Llega como TEXTO (JSON no tiene decimales exactos) y puede venir escrita a
 * la argentina ("1.234,5"). El esquema la normaliza y la valida, así que de
 * acá para adentro siempre es un texto que Decimal entiende.
 */
const CantidadBase = z
  .string()
  .trim()
  .min(1, 'Hay que indicar una cantidad')
  .transform(normalizarNumero)
  .refine((valor) => esDecimalValido(valor), 'No es un número válido');

export const CantidadPositivaSchema = CantidadBase.refine(
  (valor) => aDecimal(valor).greaterThan(0),
  'Tiene que ser mayor que cero',
);

export const CantidadNoNegativaSchema = CantidadBase.refine(
  (valor) => aDecimal(valor).greaterThanOrEqualTo(0),
  'No puede ser negativa',
);

/**
 * Un identificador opcional que acepta lo que manda un <select> vacío.
 *
 * Un select sin elegir devuelve la cadena vacía, no `undefined`. Si el esquema
 * solo aceptara un uuid, el formulario daría "identificador inválido" en un
 * campo que es opcional. Acá la cadena vacía se traduce a null, que es lo que
 * significa: "sin categoría".
 */
const UuidOpcional = z
  .union([z.literal(''), z.null(), z.uuid('Identificador inválido')])
  .nullish()
  .transform((valor) => (valor === '' || valor === undefined ? null : valor));

/** Texto opcional: la cadena vacía del formulario se guarda como null. */
const TextoOpcional = (maximo: number) =>
  z
    .string()
    .trim()
    .max(maximo, `Máximo ${String(maximo)} caracteres`)
    .nullish()
    .transform((valor) => (valor === undefined || valor === null || valor === '' ? null : valor));

// ===========================================================================
// Entradas (lo que manda el formulario)
// ===========================================================================

export const CrearCategoriaSchema = z.object({
  nombre: z.string().trim().min(1, 'El nombre es obligatorio').max(60),
});
export type CrearCategoriaInput = z.infer<typeof CrearCategoriaSchema>;

export const CrearInsumoSchema = z.object({
  nombre: z.string().trim().min(1, 'El nombre es obligatorio').max(120),
  codigo: TextoOpcional(40),
  categoriaId: UuidOpcional,
  /**
   * La unidad en la que se va a llevar el stock. Obligatoria al crear y
   * ausente en el esquema de actualización: ver ActualizarInsumoSchema.
   */
  unidadBaseId: z.uuid('Hay que elegir una unidad de medida'),
});
export type CrearInsumoInput = z.infer<typeof CrearInsumoSchema>;

/**
 * Al editar NO se puede tocar la unidad base, y por eso el campo directamente
 * no existe acá: cambiarla reinterpretaría todo el historial de movimientos
 * (los 100 "kg" pasarían a ser 100 "g"). Si alguien la manda igual, Zod la
 * descarta junto con cualquier otro campo que no esté en el esquema.
 *
 * Es PATCH: lo que no venga, no se toca. `categoriaId: null` sí la borra.
 */
export const ActualizarInsumoSchema = CrearInsumoSchema.omit({ unidadBaseId: true }).partial();
export type ActualizarInsumoInput = z.infer<typeof ActualizarInsumoSchema>;

export const CrearPresentacionSchema = z.object({
  nombre: z.string().trim().min(1, 'El nombre es obligatorio').max(60),
  /** Cuántas unidades base del insumo trae. "Bolsa 25 kg" → 25. */
  cantidadBase: CantidadPositivaSchema,
  esDefault: z.boolean().default(false),
});
export type CrearPresentacionInput = z.infer<typeof CrearPresentacionSchema>;

/**
 * `cantidadBase` NO se puede editar, a propósito.
 *
 * Los documentos viejos ya copiaron el factor, así que el historial está a
 * salvo; pero cambiarla alteraría en silencio todas las compras futuras. Si
 * una presentación cambia de contenido, se desactiva y se crea otra: queda
 * registro de que son dos cosas distintas.
 */
export const ActualizarPresentacionSchema = z.object({
  nombre: z.string().trim().min(1).max(60).optional(),
  esDefault: z.boolean().optional(),
  activa: z.boolean().optional(),
});
export type ActualizarPresentacionInput = z.infer<typeof ActualizarPresentacionSchema>;

export const ParametrosSucursalSchema = z
  .object({
    stockMinimo: CantidadNoNegativaSchema,
    stockMaximo: CantidadNoNegativaSchema.nullish(),
    ubicacion: TextoOpcional(120),
    activo: z.boolean().default(true),
  })
  .refine(
    (valor) =>
      valor.stockMaximo === undefined ||
      valor.stockMaximo === null ||
      aDecimal(valor.stockMaximo).greaterThanOrEqualTo(valor.stockMinimo),
    { error: 'El máximo no puede ser menor que el mínimo', path: ['stockMaximo'] },
  );
export type ParametrosSucursalInput = z.infer<typeof ParametrosSucursalSchema>;

/**
 * Cuántos insumos puede devolver UN pedido del listado, como máximo.
 *
 * Es una constante exportada y no un 100 escrito en el esquema por un bug real:
 * tres pantallas pedían `limite=200` para llenar un desplegable, la API las
 * rechazaba con 400 y el desplegable quedaba vacío sin decir nada. Con la
 * constante compartida, el front y la API no pueden volver a desincronizarse.
 *
 * 100 alcanza para un desplegable: el cliente tiene menos de 100 insumos (C-1).
 */
export const LIMITE_MAXIMO_LISTADO = 100;

/** Filtros del listado. Todo llega como texto en el query string. */
export const FiltroInsumosSchema = z.object({
  busqueda: z.string().trim().max(80).optional(),
  categoriaId: z.uuid().optional(),
  incluirInactivos: z.stringbool().default(false),
  limite: z.coerce.number().int().min(1).max(LIMITE_MAXIMO_LISTADO).default(25),
  desplazamiento: z.coerce.number().int().min(0).default(0),
});
export type FiltroInsumos = z.infer<typeof FiltroInsumosSchema>;

// ===========================================================================
// Salidas (lo que devuelve la API)
// ===========================================================================

export const CategoriaSchema = z.object({
  id: z.uuid(),
  nombre: z.string(),
  activa: z.boolean(),
});
export type Categoria = z.infer<typeof CategoriaSchema>;

export const PresentacionSchema = z.object({
  id: z.uuid(),
  nombre: z.string(),
  /** Texto, no número: es un decimal exacto. */
  cantidadBase: z.string(),
  esDefault: z.boolean(),
  activa: z.boolean(),
});
export type Presentacion = z.infer<typeof PresentacionSchema>;

export const ParametrosPorSucursalSchema = z.object({
  sucursalId: z.uuid(),
  sucursalCodigo: z.string(),
  sucursalNombre: z.string(),
  stockMinimo: z.string(),
  stockMaximo: z.string().nullable(),
  ubicacion: z.string().nullable(),
  activo: z.boolean(),
});
export type ParametrosPorSucursal = z.infer<typeof ParametrosPorSucursalSchema>;

/** La unidad base, acotada a lo que el listado necesita mostrar y convertir. */
export const UnidadBaseSchema = z.object({
  id: z.uuid(),
  codigo: z.string(),
  nombre: z.string(),
  dimension: DimensionSchema,
  factorABase: z.string(),
});

export const InsumoResumenSchema = z.object({
  id: z.uuid(),
  codigo: z.string().nullable(),
  nombre: z.string(),
  activo: z.boolean(),
  categoria: z.object({ id: z.uuid(), nombre: z.string() }).nullable(),
  unidadBase: UnidadBaseSchema,
  cantidadPresentaciones: z.number().int(),
});
export type InsumoResumen = z.infer<typeof InsumoResumenSchema>;

export const InsumoDetalleSchema = InsumoResumenSchema.extend({
  presentaciones: z.array(PresentacionSchema),
  porSucursal: z.array(ParametrosPorSucursalSchema),
});
export type InsumoDetalle = z.infer<typeof InsumoDetalleSchema>;

/** El listado viene paginado: los items de esta página y cuántos hay en total. */
export const ListadoInsumosSchema = z.object({
  items: z.array(InsumoResumenSchema),
  total: z.number().int(),
});
export type ListadoInsumos = z.infer<typeof ListadoInsumosSchema>;
