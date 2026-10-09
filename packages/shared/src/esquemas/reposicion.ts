import { z } from 'zod';

const SucursalRef = z.object({ id: z.uuid(), codigo: z.string(), nombre: z.string() });
const InsumoRef = z.object({ id: z.uuid(), nombre: z.string(), unidadBaseCodigo: z.string() });

/** Qué comprar de un insumo: al proveedor preferido, en bultos enteros. */
export const CompraSugeridaSchema = z.object({
  /** Null = el insumo no tiene proveedor preferido: hay que elegirlo. */
  proveedor: z
    .object({ id: z.uuid(), nombre: z.string(), diasEntrega: z.number().int().nullable() })
    .nullable(),
  /** Null = se compra suelto, en la unidad base. */
  presentacion: z.object({ id: z.uuid(), nombre: z.string(), cantidadBase: z.string() }).nullable(),
  /** Cuántos bultos (o unidades base, si es suelto), redondeado para arriba. */
  bultos: z.string(),
  /** bultos × lo que trae cada uno. Puede ser un poco más que lo que falta. */
  cantidadBase: z.string(),
  /** El último precio del bulto, y de cuándo es. */
  precioUnitario: z.string().nullable(),
  precioAt: z.string().nullable(),
  subtotal: z.string().nullable(),
});
export type CompraSugerida = z.infer<typeof CompraSugeridaSchema>;

/** Un insumo en alerta en una sucursal, con lo que hay que hacer. */
export const ItemReposicionSchema = z.object({
  sucursal: SucursalRef,
  insumo: InsumoRef,
  estado: z.enum(['CRITICO', 'BAJO']),
  saldo: z.string(),
  stockMinimo: z.string(),
  stockMaximo: z.string().nullable(),
  /** Lo que falta llegar de órdenes pedidas. */
  yaPedido: z.string(),
  /** Lo que viene en transferencias en tránsito. */
  enCamino: z.string(),
  objetivo: z.string(),
  /** Lo que falta, ya descontado lo pedido y lo que viene en camino. */
  faltante: z.string(),
  desdeCentral: z.string(),
  aComprar: z.string(),
  /** Null si no hay que comprar nada (lo cubre la Central o lo ya pedido). */
  compra: CompraSugeridaSchema.nullable(),
});
export type ItemReposicion = z.infer<typeof ItemReposicionSchema>;

export const ReposicionSchema = z.object({
  /** La que abastece a las demás. Null si la empresa no tiene central. */
  central: SucursalRef.nullable(),
  items: z.array(ItemReposicionSchema),
  /** Lo que la Central puede mandar, agrupado por sucursal de destino. */
  transferencias: z.array(
    z.object({
      destino: SucursalRef,
      lineas: z.array(z.object({ insumo: InsumoRef, cantidadBase: z.string() })),
    }),
  ),
  /**
   * Lo que hay que comprar, agrupado por proveedor Y sucursal: una orden de
   * compra es de UN proveedor para UNA sucursal, así que cada grupo es una
   * orden que se puede crear con un botón.
   */
  compras: z.array(
    z.object({
      proveedor: z
        .object({ id: z.uuid(), nombre: z.string(), diasEntrega: z.number().int().nullable() })
        .nullable(),
      sucursal: SucursalRef,
      lineas: z.array(CompraSugeridaSchema.omit({ proveedor: true }).extend({ insumo: InsumoRef })),
      /** Suma de los subtotales con precio. Null si ninguna línea tiene precio. */
      totalEstimado: z.string().nullable(),
    }),
  ),
});
export type Reposicion = z.infer<typeof ReposicionSchema>;

export const FiltroReposicionSchema = z.object({
  /** Opcional: sin él, todas las sucursales del usuario. */
  sucursalId: z.uuid().optional(),
});
export type FiltroReposicion = z.infer<typeof FiltroReposicionSchema>;

/** Cuántos insumos hay en alerta en una sucursal: el número del menú. */
export const ResumenAlertasSchema = z.object({
  critico: z.number().int(),
  bajo: z.number().int(),
});
export type ResumenAlertas = z.infer<typeof ResumenAlertasSchema>;
