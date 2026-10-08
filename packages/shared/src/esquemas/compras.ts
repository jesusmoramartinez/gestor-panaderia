import { z } from 'zod';

import { ACCIONES_ORDEN, ESTADOS_ORDEN } from '../dominio/compras.js';
import { aDecimal, esDecimalValido, normalizarNumero } from '../dominio/decimal.js';
import { CantidadMovimientoSchema, FechaHechoSchema, NotasOpcional } from './movimientos.js';
import { PrecioOpcional, PrecioSchema } from './proveedores.js';

export const EstadoOrdenSchema = z.enum(ESTADOS_ORDEN);
export const AccionOrdenSchema = z.enum(ACCIONES_ORDEN);
export const EstadoRecepcionSchema = z.enum(['CONFIRMADA', 'ANULADA']);

/** Igual que en los otros esquemas: un <select> sin elegir manda '' = null. */
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
 * Un DÍA de calendario, 'AAAA-MM-DD'. Lo que manda un <input type="date">.
 *
 * Es la fecha estimada de entrega: "llega el jueves". No es un instante y por
 * eso no lleva hora ni zona (ver el comentario de la columna en el schema).
 */
const DiaOpcional = z
  .union([z.literal(''), z.null(), z.iso.date('Fecha inválida')])
  .nullish()
  .transform((valor) => (valor === '' || valor === undefined ? null : valor));

/** Ningún insumo dos veces en el mismo documento. */
function sinInsumosRepetidos(lineas: readonly { insumoId: string }[]): boolean {
  return new Set(lineas.map((linea) => linea.insumoId)).size === lineas.length;
}

const MENSAJE_REPETIDO = 'Hay un insumo repetido: ponelo una sola vez con la cantidad total';

// ===========================================================================
// Entradas: órdenes de compra
// ===========================================================================

/**
 * Una línea de la orden: qué insumo, cuántas presentaciones y a qué precio.
 *
 * `presentacionId` null = se pide en la unidad base ("30 kg"). Con
 * presentación, la cantidad es en presentaciones ("10 bolsas").
 *
 * El precio es OPCIONAL (C-9: el cliente quiere cargarlo al pedir, pero puede
 * no saberlo) y es por PRESENTACIÓN, que es como lo dice el proveedor: "la
 * bolsa está $18.500", no "el kilo está $740".
 */
export const LineaOrdenSchema = z.object({
  insumoId: z.uuid('Hay que elegir un insumo'),
  presentacionId: UuidOpcional,
  cantidad: CantidadMovimientoSchema,
  precioUnitario: PrecioOpcional,
});
export type LineaOrdenInput = z.infer<typeof LineaOrdenSchema>;

const DatosOrden = z.object({
  sucursalId: z.uuid('Hay que elegir la sucursal que recibe'),
  proveedorId: z.uuid('Hay que elegir un proveedor'),
  fechaEntregaEstimada: DiaOpcional,
  notas: NotasOpcional,
  lineas: z
    .array(LineaOrdenSchema)
    .min(1, 'Hay que pedir al menos un insumo')
    .max(100, 'Máximo 100 líneas por orden')
    .refine(sinInsumosRepetidos, MENSAJE_REPETIDO),
});

/**
 * Crear una orden.
 *
 * `pedir` decide dónde nace (pedido del cliente: las dos cosas tienen que
 * poder pasar):
 *   - true  → nace PEDIDA: el dueño la carga mientras le escribe al proveedor;
 *   - false → queda en BORRADOR, para terminarla y pedirla más tarde.
 */
export const CrearOrdenSchema = DatosOrden.extend({
  pedir: z.boolean().default(true),
});
export type CrearOrdenInput = z.infer<typeof CrearOrdenSchema>;

/**
 * Editar una orden: REEMPLAZA todo (cabecera y líneas).
 *
 * Es un PUT y no un PATCH a propósito: las líneas de una orden se piensan
 * juntas ("en realidad eran 8 bolsas y no pedí azúcar"), y editarlas una por
 * una obligaría a la pantalla a llevar la cuenta de qué agregó y qué borró.
 * Solo se puede mientras no llegó nada (lo controla el servicio).
 */
export const EditarOrdenSchema = DatosOrden;
export type EditarOrdenInput = z.infer<typeof EditarOrdenSchema>;

/** Cancelar o cerrar con faltante. La nota explica por qué (opcional). */
export const CerrarOrdenSchema = z.object({ nota: NotasOpcional });
export type CerrarOrdenInput = z.infer<typeof CerrarOrdenSchema>;

export const FiltroOrdenesSchema = z.object({
  estado: EstadoOrdenSchema.optional(),
  sucursalId: z.uuid().optional(),
  proveedorId: z.uuid().optional(),
  /** Solo lo que todavía se espera: PEDIDA y PARCIAL. */
  soloPendientes: z.stringbool().default(false),
  limite: z.coerce.number().int().min(1).max(200).default(50),
  desplazamiento: z.coerce.number().int().min(0).default(0),
});
export type FiltroOrdenes = z.infer<typeof FiltroOrdenesSchema>;

// ===========================================================================
// Entradas: recepciones
// ===========================================================================

/** Lo común a las dos recepciones: cuándo llegó y qué papeles trajo. */
const DatosRecepcion = z.object({
  /** Cuándo llegó. Opcional (ahora); pasada sí, futura no. */
  fecha: FechaHechoSchema,
  numeroRemito: TextoOpcional(40),
  numeroFactura: TextoOpcional(40),
  notas: NotasOpcional,
});

/**
 * Una línea de una recepción DIRECTA (sin orden).
 *
 * Acá el precio es OBLIGATORIO: respuesta C-7 del cliente, "el precio se carga
 * cada vez que se carga una compra". Y además sin precio no hay costo, y sin
 * costo el promedio no se puede calcular.
 */
export const LineaRecepcionDirectaSchema = z.object({
  insumoId: z.uuid('Hay que elegir un insumo'),
  presentacionId: UuidOpcional,
  cantidad: CantidadMovimientoSchema,
  precioUnitario: PrecioSchema,
});

/** Llegó mercadería que no tenía orden: la compra por teléfono. */
export const RecepcionDirectaSchema = DatosRecepcion.extend({
  sucursalId: z.uuid('Hay que elegir la sucursal que recibe'),
  proveedorId: z.uuid('Hay que elegir un proveedor'),
  lineas: z
    .array(LineaRecepcionDirectaSchema)
    .min(1, 'Hay que cargar al menos un insumo')
    .max(100, 'Máximo 100 líneas por recepción')
    .refine(sinInsumosRepetidos, MENSAJE_REPETIDO),
});
export type RecepcionDirectaInput = z.infer<typeof RecepcionDirectaSchema>;

/**
 * Una línea de una recepción CON orden: cuánto llegó de una línea de la orden.
 *
 * No trae insumo ni presentación: salen de la línea de la orden. Si vinieran
 * en el pedido, habría que decidir qué pasa cuando no coinciden.
 *
 * La cantidad es en la MISMA presentación en que se pidió ("llegaron 4 de las
 * 10 bolsas"). El precio se puede corregir (C-9): viene precargado con el de
 * la orden, pero el que manda es el que se pagó.
 */
export const LineaRecepcionOrdenSchema = z.object({
  lineaOrdenId: z.uuid('Línea de orden inválida'),
  cantidad: CantidadMovimientoSchema,
  precioUnitario: PrecioSchema,
});

export const RecepcionDeOrdenSchema = DatosRecepcion.extend({
  lineas: z
    .array(LineaRecepcionOrdenSchema)
    .min(1, 'Hay que recibir al menos una línea')
    .max(100, 'Máximo 100 líneas por recepción')
    .refine(
      (lineas) => new Set(lineas.map((linea) => linea.lineaOrdenId)).size === lineas.length,
      'Hay una línea repetida',
    ),
});
export type RecepcionDeOrdenInput = z.infer<typeof RecepcionDeOrdenSchema>;

/**
 * Anular una recepción. El motivo es OBLIGATORIO: anular una compra cambia el
 * stock y el costo de toda la empresa, y "¿por qué se anuló?" es la primera
 * pregunta que se va a hacer el dueño cuando lo vea.
 *
 * Lleva `forzar` por la misma razón que la anulación de un movimiento: si la
 * harina que entró ya se usó, sacarla deja el stock en negativo.
 */
export const AnularRecepcionSchema = z.object({
  motivo: z.string().trim().min(3, 'Contá por qué se anula').max(300, 'Máximo 300 caracteres'),
  forzar: z.boolean().default(false),
});
export type AnularRecepcionInput = z.infer<typeof AnularRecepcionSchema>;

export const FiltroRecepcionesSchema = z.object({
  sucursalId: z.uuid().optional(),
  proveedorId: z.uuid().optional(),
  limite: z.coerce.number().int().min(1).max(200).default(50),
  desplazamiento: z.coerce.number().int().min(0).default(0),
});
export type FiltroRecepciones = z.infer<typeof FiltroRecepcionesSchema>;

// ===========================================================================
// Entradas: plantillas de pedidos recurrentes
// ===========================================================================

export const LineaPlantillaSchema = z.object({
  insumoId: z.uuid('Hay que elegir un insumo'),
  presentacionId: UuidOpcional,
  cantidad: CantidadMovimientoSchema,
});

/**
 * Una plantilla: "Pedido semanal Molino". Crear y editar usan el mismo
 * esquema; editar reemplaza las líneas, igual que en la orden.
 */
export const GuardarPlantillaSchema = z.object({
  nombre: z.string().trim().min(1, 'Ponele un nombre').max(80, 'Máximo 80 caracteres'),
  proveedorId: z.uuid('Hay que elegir un proveedor'),
  sucursalId: z.uuid('Hay que elegir la sucursal que recibe'),
  notas: NotasOpcional,
  lineas: z
    .array(LineaPlantillaSchema)
    .min(1, 'La plantilla necesita al menos un insumo')
    .max(100, 'Máximo 100 líneas')
    .refine(sinInsumosRepetidos, MENSAJE_REPETIDO),
});
export type GuardarPlantillaInput = z.infer<typeof GuardarPlantillaSchema>;

// ===========================================================================
// Salidas
// ===========================================================================

const Referencia = z.object({ id: z.uuid(), nombre: z.string() });
const SucursalRef = z.object({ id: z.uuid(), codigo: z.string(), nombre: z.string() });
const InsumoRef = z.object({ id: z.uuid(), nombre: z.string(), unidadBaseCodigo: z.string() });
const PresentacionRef = z.object({ id: z.uuid(), nombre: z.string() });

export const OrdenResumenSchema = z.object({
  id: z.uuid(),
  numero: z.number().int(),
  estado: EstadoOrdenSchema,
  sucursal: SucursalRef,
  proveedor: Referencia,
  usuario: Referencia,
  /** 'AAAA-MM-DD' o null. */
  fechaEntregaEstimada: z.string().nullable(),
  /** Pedida, con la fecha estimada ya pasada y todavía esperando (C-8). */
  atrasada: z.boolean(),
  creadaAt: z.string(),
  pedidaAt: z.string().nullable(),
  /** Suma de cantidad × precio de las líneas con precio. Null si ninguna tiene. */
  totalEstimado: z.string().nullable(),
  cantidadLineas: z.number().int(),
});
export type OrdenResumen = z.infer<typeof OrdenResumenSchema>;
export const ListaOrdenesSchema = z.object({
  items: z.array(OrdenResumenSchema),
  total: z.number().int(),
});
export type ListaOrdenes = z.infer<typeof ListaOrdenesSchema>;

export const LineaOrdenSalidaSchema = z.object({
  id: z.uuid(),
  insumo: InsumoRef,
  presentacion: PresentacionRef.nullable(),
  /** En presentaciones (o en unidad base, si no hay presentación). */
  cantidad: z.string(),
  factorConversion: z.string(),
  cantidadBase: z.string(),
  precioUnitario: z.string().nullable(),
  /** Lo que llegó, sumando las recepciones CONFIRMADAS. En unidad base. */
  recibidoBase: z.string(),
  pendienteBase: z.string(),
  /** Lo pendiente expresado en presentaciones: "faltan 6 bolsas". */
  pendiente: z.string(),
});
export type LineaOrdenSalida = z.infer<typeof LineaOrdenSalidaSchema>;

export const RecepcionResumenSchema = z.object({
  id: z.uuid(),
  numero: z.number().int(),
  estado: EstadoRecepcionSchema,
  fecha: z.string(),
  sucursal: SucursalRef,
  proveedor: Referencia,
  orden: z.object({ id: z.uuid(), numero: z.number().int() }).nullable(),
  numeroRemito: z.string().nullable(),
  numeroFactura: z.string().nullable(),
  /** Suma de cantidad × precio. Se calcula, no se guarda. */
  total: z.string(),
  usuario: Referencia,
  anuladaAt: z.string().nullable(),
});
export type RecepcionResumen = z.infer<typeof RecepcionResumenSchema>;
export const ListaRecepcionesSchema = z.object({
  items: z.array(RecepcionResumenSchema),
  total: z.number().int(),
});
export type ListaRecepciones = z.infer<typeof ListaRecepcionesSchema>;

export const OrdenDetalleSchema = OrdenResumenSchema.extend({
  notas: z.string().nullable(),
  notaCierre: z.string().nullable(),
  cerradaAt: z.string().nullable(),
  lineas: z.array(LineaOrdenSalidaSchema),
  recepciones: z.array(RecepcionResumenSchema),
  /**
   * Qué se puede hacer con esta orden AHORA. Lo calcula el servidor con la
   * máquina de estados, así la pantalla no repite la regla: muestra los
   * botones que vienen en esta lista y ninguno más.
   */
  acciones: z.array(AccionOrdenSchema),
});
export type OrdenDetalle = z.infer<typeof OrdenDetalleSchema>;

export const LineaRecepcionSalidaSchema = z.object({
  id: z.uuid(),
  lineaOrdenId: z.uuid().nullable(),
  insumo: InsumoRef,
  presentacion: PresentacionRef.nullable(),
  cantidad: z.string(),
  factorConversion: z.string(),
  cantidadBase: z.string(),
  precioUnitario: z.string(),
  /** precio ÷ factor: lo que costó una unidad base. */
  costoUnitarioBase: z.string(),
  subtotal: z.string(),
});
export type LineaRecepcionSalida = z.infer<typeof LineaRecepcionSalidaSchema>;

export const RecepcionDetalleSchema = RecepcionResumenSchema.extend({
  notas: z.string().nullable(),
  operacionId: z.uuid(),
  anuladaPor: Referencia.nullable(),
  motivoAnulacion: z.string().nullable(),
  lineas: z.array(LineaRecepcionSalidaSchema),
  /**
   * El costo promedio ACTUAL de cada insumo de la recepción. Recién
   * confirmada, es el que quedó después de ella ("la harina quedó en
   * $1.100/kg"); mirada días después, ya incluye las compras posteriores.
   */
  costos: z.array(
    z.object({
      insumoId: z.uuid(),
      insumoNombre: z.string(),
      unidadBaseCodigo: z.string(),
      costoPromedio: z.string().nullable(),
    }),
  ),
});
export type RecepcionDetalle = z.infer<typeof RecepcionDetalleSchema>;

export const LineaPlantillaSalidaSchema = z.object({
  id: z.uuid(),
  insumo: InsumoRef,
  presentacion: PresentacionRef.nullable(),
  cantidad: z.string(),
});

export const PlantillaSchema = z.object({
  id: z.uuid(),
  nombre: z.string(),
  proveedor: Referencia,
  sucursal: SucursalRef,
  notas: z.string().nullable(),
  activa: z.boolean(),
  lineas: z.array(LineaPlantillaSalidaSchema),
});
export type Plantilla = z.infer<typeof PlantillaSchema>;
export const ListaPlantillasSchema = z.array(PlantillaSchema);

/** El costo promedio de un insumo, para la ficha del insumo. */
export const CostoInsumoSchema = z.object({
  insumoId: z.uuid(),
  unidadBaseCodigo: z.string(),
  costoPromedio: z.string().nullable(),
});
export type CostoInsumo = z.infer<typeof CostoInsumoSchema>;

// ===========================================================================
// El formulario del frontend
// ===========================================================================

/**
 * El esquema que usa LA PANTALLA de líneas de compra, para sus tres usos:
 * orden de compra, recepción sin orden y plantilla.
 *
 * Mismo truco que `CargarMovimientoFormSchema` (Fase 6): un formulario de
 * React Hook Form necesita UN tipo de valores, así que este esquema es el
 * más PERMISIVO de los tres (todo lo opcional, opcional). Cuando la pantalla
 * es una recepción, le encadena `conPrecioObligatorio()`.
 *
 * La API valida igual con su esquema estricto: esto es para que el error
 * aparezca abajo del campo antes de mandar nada, no la defensa.
 */
export const FormularioCompraSchema = z.object({
  /** Solo para las plantillas. */
  nombre: z.string().trim().max(80, 'Máximo 80 caracteres'),
  proveedorId: z.uuid('Hay que elegir un proveedor'),
  sucursalId: z.uuid('Hay que elegir la sucursal que recibe'),
  fechaEntregaEstimada: DiaOpcional,
  fecha: FechaHechoSchema,
  numeroRemito: TextoOpcional(40),
  numeroFactura: TextoOpcional(40),
  notas: NotasOpcional,
  lineas: z
    .array(LineaOrdenSchema)
    .min(1, 'Hay que cargar al menos un insumo')
    .max(100, 'Máximo 100 líneas')
    .refine(sinInsumosRepetidos, MENSAJE_REPETIDO),
});
export type FormularioCompraInput = z.infer<typeof FormularioCompraSchema>;

/** En una recepción el precio es obligatorio (C-7): sin precio no hay costo. */
export function conPrecioObligatorio(esquema: typeof FormularioCompraSchema) {
  return esquema.superRefine((valores, ctx) => {
    valores.lineas.forEach((linea, indice) => {
      if (linea.precioUnitario === null) {
        ctx.addIssue({
          code: 'custom',
          message: 'Hay que indicar el precio',
          path: ['lineas', indice, 'precioUnitario'],
        });
      }
    });
  });
}

/** Una plantilla necesita nombre. */
export function conNombreObligatorio(esquema: typeof FormularioCompraSchema) {
  return esquema.refine((valores) => valores.nombre.length > 0, {
    error: 'Ponele un nombre',
    path: ['nombre'],
  });
}

/**
 * El formulario de "recibir una orden".
 *
 * La pantalla muestra TODAS las líneas con lo pendiente precargado, y la
 * persona corrige lo que llegó distinto. Lo que no llegó se deja en cero o
 * vacío: por eso acá la cantidad acepta cero, y la API no (una línea de cero
 * no significa nada). `aRecepcionDeOrden` filtra esas líneas antes de mandar.
 */
const CantidadRecibidaSchema = z
  .string()
  .trim()
  .transform((valor) => (valor === '' ? '0' : normalizarNumero(valor)))
  .refine((valor) => esDecimalValido(valor), 'No es un número válido')
  .refine((valor) => aDecimal(valor).greaterThanOrEqualTo(0), 'No puede ser negativo');

export const RecibirOrdenFormSchema = DatosRecepcion.extend({
  lineas: z
    .array(
      z.object({
        lineaOrdenId: z.uuid(),
        cantidad: CantidadRecibidaSchema,
        precioUnitario: PrecioOpcional,
      }),
    )
    .superRefine((lineas, ctx) => {
      if (lineas.every((linea) => aDecimal(linea.cantidad).isZero())) {
        ctx.addIssue({ code: 'custom', message: 'No cargaste ninguna cantidad recibida' });
      }
      lineas.forEach((linea, indice) => {
        // Solo lo que LLEGÓ necesita precio (C-7).
        if (!aDecimal(linea.cantidad).isZero() && linea.precioUnitario === null) {
          ctx.addIssue({
            code: 'custom',
            message: 'Hay que indicar el precio',
            path: [indice, 'precioUnitario'],
          });
        }
      });
    }),
});
export type RecibirOrdenFormInput = z.infer<typeof RecibirOrdenFormSchema>;

/** Lo que va a la API: solo las líneas que llegaron. */
export function aRecepcionDeOrden(valores: RecibirOrdenFormInput): RecepcionDeOrdenInput {
  return {
    fecha: valores.fecha,
    numeroRemito: valores.numeroRemito,
    numeroFactura: valores.numeroFactura,
    notas: valores.notas,
    lineas: valores.lineas
      .filter((linea) => !aDecimal(linea.cantidad).isZero())
      .map((linea) => ({
        lineaOrdenId: linea.lineaOrdenId,
        cantidad: linea.cantidad,
        precioUnitario: linea.precioUnitario ?? '0',
      })),
  };
}
