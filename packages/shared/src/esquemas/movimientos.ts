import { z } from 'zod';

import { aDecimal, esDecimalValido, normalizarNumero } from '../dominio/decimal.js';
import { esFechaFutura, ESTADOS_STOCK, TIPOS_MOVIMIENTO } from '../dominio/stock.js';

export const TipoMovimientoSchema = z.enum(TIPOS_MOVIMIENTO);
export const EstadoStockSchema = z.enum(ESTADOS_STOCK);

/**
 * Una cantidad tipeada por una persona: SIEMPRE positiva y sin signo.
 *
 * El signo lo pone el tipo del movimiento (ver `conSignoDelTipo`). Si el
 * formulario aceptara signos, "-30" de consumo sumaría stock.
 */
export const CantidadMovimientoSchema = z
  .string()
  .trim()
  .min(1, 'Hay que indicar una cantidad')
  .transform(normalizarNumero)
  .refine((valor) => esDecimalValido(valor), 'No es un número válido')
  .refine((valor) => aDecimal(valor).greaterThan(0), 'Tiene que ser mayor que cero');

const UuidOpcional = z
  .union([z.literal(''), z.null(), z.uuid('Identificador inválido')])
  .nullish()
  .transform((valor) => (valor === '' || valor === undefined ? null : valor));

export const NotasOpcional = z
  .string()
  .trim()
  .max(300, 'Máximo 300 caracteres')
  .nullish()
  .transform((valor) => (valor === undefined || valor === null || valor === '' ? null : valor));

/**
 * Cuándo ocurrió el hecho. Opcional: si no viene, es ahora.
 *
 * Se acepta una fecha pasada a propósito (la merma del sábado se carga el
 * lunes) pero NO una futura: rompería cualquier pregunta del tipo "¿cuánto
 * había el día 5?" y además quedaría primera en el historial para siempre.
 *
 * Esta validación no puede ser un CHECK en la base: Postgres solo admite
 * funciones inmutables en un CHECK, y `now()` no lo es.
 */
export const FechaHechoSchema = z
  .union([z.literal(''), z.null(), z.iso.datetime({ offset: true })])
  .nullish()
  .transform((valor) => (valor === '' || valor === undefined || valor === null ? null : valor))
  .refine(
    (valor) => valor === null || !esFechaFutura(new Date(valor), new Date()),
    'La fecha no puede estar en el futuro',
  );

// ===========================================================================
// Entradas
// ===========================================================================

/**
 * Una línea de una carga: qué insumo, cuánta cantidad y en qué unidad.
 *
 * `unidadId` es opcional: si no viene, se usa la unidad base del insumo. Eso
 * cubre el caso normal ("30 kg de harina") sin obligar al formulario a mandar
 * un id redundante, y deja disponible el caso interesante ("2000 g de un
 * insumo que se lleva en kg").
 */
export const LineaMovimientoSchema = z.object({
  insumoId: z.uuid('Hay que elegir un insumo'),
  cantidad: CantidadMovimientoSchema,
  unidadId: UuidOpcional,
  notas: NotasOpcional,
});
export type LineaMovimientoInput = z.infer<typeof LineaMovimientoSchema>;

/** Lo común a las tres cargas: dónde, cuándo y las líneas. */
const CargaBase = z.object({
  sucursalId: z.uuid('Hay que elegir una sucursal'),
  fecha: FechaHechoSchema,
  notas: NotasOpcional,
  lineas: z
    .array(LineaMovimientoSchema)
    .min(1, 'Hay que cargar al menos una línea')
    .max(100, 'Máximo 100 líneas por carga')
    // Un insumo repetido tendría dos "cantidades" en la misma operación y
    // haría ambiguo el control de stock negativo. Se rechaza con el campo
    // señalado en lugar de sumarlas en silencio.
    // Sin `path`: el path de un refine es RELATIVO al campo que se refina, así
    // que poner ['lineas'] acá daría 'lineas.lineas' y el formulario no
    // encontraría dónde mostrar el mensaje.
    .refine(
      (lineas) => new Set(lineas.map((linea) => linea.insumoId)).size === lineas.length,
      'Hay un insumo repetido: ponelo una sola vez con la cantidad total',
    ),
});

export const CargarSaldoInicialSchema = CargaBase;
export type CargarSaldoInicialInput = z.infer<typeof CargarSaldoInicialSchema>;

/**
 * El consumo de producción. Multi-línea porque así se carga en la realidad:
 * al terminar el turno se anota todo lo que se usó, de una vez.
 *
 * `forzar` pide dejar el stock en negativo. Solo se honra si el rol tiene el
 * permiso `stock:forzar`; si no lo tiene, se ignora y la carga falla con 409.
 */
export const CargarConsumoSchema = CargaBase.extend({
  motivoId: UuidOpcional,
  forzar: z.boolean().default(false),
});
export type CargarConsumoInput = z.infer<typeof CargarConsumoSchema>;

/**
 * Una merma. El motivo es OBLIGATORIO y va a nivel de la operación, no de
 * cada línea: el caso real es "se mojó el depósito" o "venció el lote", y eso
 * afecta a varios insumos por la misma razón. Si hubiera dos razones
 * distintas, son dos mermas.
 */
export const CargarMermaSchema = CargaBase.extend({
  motivoId: z.uuid('Hay que elegir un motivo'),
  forzar: z.boolean().default(false),
});
export type CargarMermaInput = z.infer<typeof CargarMermaSchema>;

/**
 * Lo que la persona CONTÓ en el depósito.
 *
 * A diferencia de las otras cargas, acá el cero ES un valor válido y además es
 * el caso más común: "se terminó y nadie lo cargó". Por eso este esquema
 * acepta cero y los otros no.
 */
const CantidadContadaSchema = z
  .string()
  .trim()
  .min(1, 'Hay que indicar cuánto contaste')
  .transform(normalizarNumero)
  .refine((valor) => esDecimalValido(valor), 'No es un número válido')
  .refine((valor) => aDecimal(valor).greaterThanOrEqualTo(0), 'No puede ser negativo');

/**
 * Una línea de ajuste: qué insumo y CUÁNTO HAY.
 *
 * Fijate en lo que NO tiene: no tiene `cantidad` (la diferencia) ni `unidadId`.
 *
 *   - La DIFERENCIA la calcula el servidor (`contado − saldo`). Si la escribiera
 *     la persona, tendría que hacer una resta con signo en la cabeza, y
 *     equivocarse en el signo deja el stock al doble de mal que antes.
 *   - La UNIDAD es siempre la base del insumo. Contar es comparar contra el
 *     saldo, y el saldo está en la unidad base: dejar contar en gramos algo
 *     que se lleva en kilos solo invita a errores. La pantalla muestra la
 *     unidad al lado del campo.
 */
export const LineaAjusteSchema = z.object({
  insumoId: z.uuid('Hay que elegir un insumo'),
  cantidadContada: CantidadContadaSchema,
  notas: NotasOpcional,
});
export type LineaAjusteInput = z.infer<typeof LineaAjusteSchema>;

/**
 * Un ajuste de stock: "conté y hay esto".
 *
 * El motivo es OBLIGATORIO y tiene que ser de tipo AJUSTE. Un ajuste sin
 * motivo es alguien cambiando el número del stock sin decir en nombre de qué,
 * y es la operación más fácil de usar para tapar un faltante.
 *
 * NO lleva `forzar`, y no es un olvido: como lo contado nunca puede ser
 * negativo, el saldo que queda tampoco. Un ajuste no puede dejar el stock en
 * negativo; de hecho es la forma de ARREGLARLO cuando quedó negativo.
 */
export const AjustarStockSchema = z.object({
  sucursalId: z.uuid('Hay que elegir una sucursal'),
  motivoId: z.uuid('Hay que elegir un motivo'),
  fecha: FechaHechoSchema,
  notas: NotasOpcional,
  lineas: z
    .array(LineaAjusteSchema)
    .min(1, 'Hay que contar al menos un insumo')
    .max(100, 'Máximo 100 insumos por ajuste')
    .refine(
      (lineas) => new Set(lineas.map((linea) => linea.insumoId)).size === lineas.length,
      'Hay un insumo repetido: contalo una sola vez',
    ),
});
export type AjustarStockInput = z.infer<typeof AjustarStockSchema>;

/**
 * El esquema que usa EL FORMULARIO del frontend para las tres cargas.
 *
 * ¿Por qué uno aparte? Porque la pantalla es una sola para consumo, merma y
 * saldo inicial, y un formulario de React Hook Form necesita UN tipo de
 * valores. Si se tipara con los tres esquemas de arriba, TypeScript elegiría
 * el más angosto (el del saldo inicial, que no tiene `motivoId`) y el campo
 * del motivo no existiría.
 *
 * Es el más PERMISIVO de los tres: el motivo es opcional. Cuando la carga es
 * una merma, la pantalla le encadena `conMotivoObligatorio()`, que agrega la
 * exigencia sin cambiar el tipo de los valores.
 *
 * Y la API sigue validando con su esquema estricto: el formulario es comodidad
 * para que el error aparezca abajo del campo, no la defensa.
 */
export const CargarMovimientoFormSchema = CargaBase.extend({
  motivoId: UuidOpcional,
  forzar: z.boolean().default(false),
});
export type CargarMovimientoFormInput = z.infer<typeof CargarMovimientoFormSchema>;

export function conMotivoObligatorio(esquema: typeof CargarMovimientoFormSchema) {
  return esquema.refine((valores) => valores.motivoId !== null, {
    error: 'Hay que elegir un motivo',
    path: ['motivoId'],
  });
}

/**
 * Anular un movimiento. El porqué va en las notas.
 *
 * Lleva `forzar` porque anular una ENTRADA es una salida: si se cargó un saldo
 * inicial de 100, ya se consumieron 70 y se anula el saldo inicial, el stock
 * queda en -70. Es exactamente el caso en el que hay que avisar y pedir
 * confirmación, no hacerlo en silencio.
 */
export const AnularMovimientoSchema = z.object({
  notas: NotasOpcional,
  forzar: z.boolean().default(false),
});
export type AnularMovimientoInput = z.infer<typeof AnularMovimientoSchema>;

/** Filtros de la pantalla de stock. Todo llega como texto en el query. */
export const FiltroStockSchema = z.object({
  sucursalId: z.uuid('Hay que elegir una sucursal'),
  busqueda: z.string().trim().max(80).optional(),
  categoriaId: z.uuid().optional(),
  /** Solo lo que está en CRITICO o BAJO: el adelanto de la vista de reposición. */
  soloAlertas: z.stringbool().default(false),
});
export type FiltroStock = z.infer<typeof FiltroStockSchema>;

export const FiltroHistorialSchema = z.object({
  sucursalId: z.uuid('Hay que elegir una sucursal'),
  limite: z.coerce.number().int().min(1).max(200).default(50),
  desplazamiento: z.coerce.number().int().min(0).default(0),
});
export type FiltroHistorial = z.infer<typeof FiltroHistorialSchema>;

// ===========================================================================
// Salidas
// ===========================================================================

export const MotivoSchema = z.object({
  id: z.uuid(),
  tipoAplicable: z.enum(['MERMA', 'AJUSTE', 'CONSUMO']),
  nombre: z.string(),
  activo: z.boolean(),
});
export type Motivo = z.infer<typeof MotivoSchema>;
export const ListaMotivosSchema = z.array(MotivoSchema);

/**
 * Un movimiento tal como lo devuelve la API.
 *
 * Todas las cantidades viajan como TEXTO: son decimales exactos y JSON no
 * tiene ese tipo. Las fechas, como ISO 8601 en UTC; la pantalla las muestra en
 * hora de Argentina.
 *
 * Fijate que NO hay `costoUnitario`, aunque desde la Fase 8 la base lo tiene:
 * es un dato de plata y el historial lo ve también el empleado. Un campo que
 * no se manda no se puede filtrar. El costo se ve en las recepciones, que sí
 * piden el permiso `compra:ver`.
 */
export const MovimientoSchema = z.object({
  id: z.uuid(),
  tipo: TipoMovimientoSchema,
  /** Con signo: positivo entró, negativo salió. En la unidad base del insumo. */
  cantidadBase: z.string(),
  /** Lo que la persona tipeó, sin signo, y en qué unidad. */
  cantidadIngresada: z.string(),
  unidadIngresada: z.object({ id: z.uuid(), codigo: z.string() }),
  factorConversion: z.string(),
  /** Cuándo ocurrió en la realidad. */
  fecha: z.string(),
  /** Cuándo se registró en el sistema. Puede ser muy distinto. */
  creadoAt: z.string(),
  usuario: z.object({ id: z.uuid(), nombre: z.string() }),
  motivo: z.object({ id: z.uuid(), nombre: z.string() }).nullable(),
  notas: z.string().nullable(),
  /** Agrupa los movimientos cargados en la misma operación. */
  operacionId: z.uuid(),
  forzado: z.boolean(),
  /** Si este movimiento ES una reversa, a qué movimiento anula. */
  revierteAId: z.uuid().nullable(),
  /** Si este movimiento YA FUE anulado por una reversa. */
  revertido: z.boolean(),
  insumo: z.object({ id: z.uuid(), nombre: z.string(), unidadBaseCodigo: z.string() }),
  sucursal: z.object({ id: z.uuid(), codigo: z.string(), nombre: z.string() }),
  /**
   * La recepción de compra que lo originó (o que anuló), con el remito para
   * poder cruzarlo con el papel. Null en todo lo que no es una compra.
   */
  recepcion: z
    .object({
      id: z.uuid(),
      numero: z.number().int(),
      numeroRemito: z.string().nullable(),
      proveedorNombre: z.string(),
    })
    .nullable(),
});
export type Movimiento = z.infer<typeof MovimientoSchema>;

/** Lo que devuelve una carga: los movimientos escritos y el saldo que quedó. */
export const ResultadoCargaSchema = z.object({
  operacionId: z.uuid(),
  movimientos: z.array(MovimientoSchema),
  /** El saldo de cada insumo tocado, DESPUÉS de la carga. */
  saldos: z.array(
    z.object({
      insumoId: z.uuid(),
      insumoNombre: z.string(),
      unidadBaseCodigo: z.string(),
      saldo: z.string(),
      estado: EstadoStockSchema,
    }),
  ),
});
export type ResultadoCarga = z.infer<typeof ResultadoCargaSchema>;

/** Una fila de la pantalla "Stock por sucursal". */
export const FilaStockSchema = z.object({
  insumoId: z.uuid(),
  nombre: z.string(),
  codigo: z.string().nullable(),
  categoriaNombre: z.string().nullable(),
  unidadBaseCodigo: z.string(),
  /** El saldo: la SUMA de los movimientos. Nunca un campo guardado. */
  saldo: z.string(),
  stockMinimo: z.string(),
  stockMaximo: z.string().nullable(),
  ubicacion: z.string().nullable(),
  estado: EstadoStockSchema,
  /** Cuántos movimientos tiene en esta sucursal: 0 = nunca se tocó. */
  cantidadMovimientos: z.number().int(),
});
export type FilaStock = z.infer<typeof FilaStockSchema>;

export const StockPorSucursalSchema = z.object({
  sucursal: z.object({ id: z.uuid(), codigo: z.string(), nombre: z.string() }),
  items: z.array(FilaStockSchema),
  /** Para el resumen de arriba de la pantalla. */
  resumen: z.object({ critico: z.number().int(), bajo: z.number().int(), ok: z.number().int() }),
});
export type StockPorSucursal = z.infer<typeof StockPorSucursalSchema>;

/**
 * El informe de un ajuste: qué había, qué se contó y qué se corrigió.
 *
 * Devuelve TODAS las líneas, incluidas las que no generaron movimiento porque
 * la cuenta coincidía. Esa información vale: "conté 12 insumos y 10 estaban
 * bien" es un resultado, y además es la prueba de que el sistema no inventó
 * movimientos de cero.
 */
export const ResultadoAjusteSchema = z.object({
  /** null si ninguna línea tenía diferencia: no se escribió nada. */
  operacionId: z.uuid().nullable(),
  lineas: z.array(
    z.object({
      insumoId: z.uuid(),
      insumoNombre: z.string(),
      unidadBaseCodigo: z.string(),
      /** Lo que decía el sistema antes de ajustar. */
      saldoAnterior: z.string(),
      /** Lo que contó la persona. */
      contado: z.string(),
      /** contado − saldoAnterior, con signo. '0' si coincidía. */
      diferencia: z.string(),
      /** false si la cuenta coincidía y no se escribió ningún movimiento. */
      ajustado: z.boolean(),
    }),
  ),
  movimientos: z.array(MovimientoSchema),
});
export type ResultadoAjuste = z.infer<typeof ResultadoAjusteSchema>;

export const HistorialMovimientosSchema = z.object({
  items: z.array(MovimientoSchema),
  total: z.number().int(),
  /** El saldo actual del insumo en esa sucursal, para el encabezado. */
  saldo: z.string(),
});
export type HistorialMovimientos = z.infer<typeof HistorialMovimientosSchema>;
