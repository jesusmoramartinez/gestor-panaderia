// Import NOMBRADO, no por defecto: decimal.js declara `Decimal` como clase y
// como namespace a la vez, y con NodeNext el import por defecto resuelve al
// namespace del módulo (sin constructor). Los tests pasaban igual porque
// Vitest no verifica tipos: lo encontró `pnpm typecheck`.
import { Decimal } from 'decimal.js';

/**
 * Aritmética decimal exacta para todo el sistema.
 *
 * Por qué no se usa `number`: el tipo number de JavaScript es un float binario,
 * y en binario 0.1 no se puede representar exactamente. Entonces
 * `0.1 + 0.2 === 0.3` es false. En un kardex eso significa un stock que nunca
 * cierra. El detalle está en docs/aprendizaje/04-dinero-y-cantidades-decimal.md
 *
 * Usamos decimal.js porque es la MISMA librería que Prisma empaqueta por
 * dentro: así los valores viajan a la base y vuelven con la misma semántica de
 * redondeo, sin conversiones intermedias donde se pierda precisión.
 */

// Configuración global, una sola vez para todo el proyecto.
Decimal.set({
  // Dígitos significativos en los cálculos intermedios. 40 es holgado: una
  // división como "precio ÷ 25 kg" no pierde nada.
  precision: 40,
  // "Mitad hacia arriba": 0.5 redondea a 1. Es lo que espera cualquier persona
  // y lo que usa la calculadora del dueño. Lo fijamos explícitamente para que
  // no dependa de un valor por defecto que podría cambiar.
  rounding: Decimal.ROUND_HALF_UP,
  // Evita que al convertir a texto aparezca notación exponencial ("1e-7"), que
  // es correcta pero ilegible y confunde al guardarla o mostrarla.
  toExpNeg: -30,
  toExpPos: 30,
});

export { Decimal };

/**
 * Lo que se acepta como número en el dominio.
 *
 * Fijate que `number` NO está en la lista, y es a propósito: TypeScript mismo
 * impide pasar un float por accidente. Si tenés un literal, escribilo como
 * texto: aDecimal('2.5'), no aDecimal(2.5).
 */
export type Numerico = Decimal | string;

export function aDecimal(valor: Numerico): Decimal {
  return valor instanceof Decimal ? valor : new Decimal(valor);
}

/**
 * Escalas de almacenamiento. Coinciden con los tipos de la base:
 *   cantidades  NUMERIC(18,6)
 *   dinero      NUMERIC(18,4)
 *
 * 6 decimales en kilos es hasta el miligramo: suficiente para la esencia de
 * vainilla y el mejorador, que se usan en gramos. 4 decimales en dinero es
 * para que un precio unitario (precio de la bolsa ÷ 25 kg) no pierda nada; se
 * redondea a 2 solo AL MOSTRAR.
 */
export const ESCALA_CANTIDAD = 6;
export const ESCALA_DINERO = 4;

/**
 * Redondea una cantidad a la escala con la que se guarda.
 *
 * Es una operación EXPLÍCITA a propósito. Si no se llamara, Postgres
 * redondearía igual al guardar, pero en silencio: el valor que creés que
 * guardaste y el que quedó serían distintos y nadie se enteraría.
 */
export function redondearCantidad(valor: Numerico): Decimal {
  return aDecimal(valor).toDecimalPlaces(ESCALA_CANTIDAD);
}

export function redondearDinero(valor: Numerico): Decimal {
  return aDecimal(valor).toDecimalPlaces(ESCALA_DINERO);
}

/**
 * Formatea una cantidad para mostrarla en pantalla, en formato argentino
 * (coma decimal y punto de miles): 1234.5 → "1.234,5"
 *
 * Quita los ceros al final: 2.500000 se muestra "2,5" y no "2,500000".
 */
export function formatearCantidad(valor: Numerico, decimalesMaximos = ESCALA_CANTIDAD): string {
  const texto = aDecimal(valor).toFixed(decimalesMaximos);
  // Ojo: le pasamos el TEXTO, no un number. Intl acepta cadenas y las formatea
  // con todos sus dígitos. Si pasáramos por .toNumber(), un valor grande se
  // deformaría: 123456789012345678,123456 se convierte en ...680.
  return new Intl.NumberFormat('es-AR', {
    minimumFractionDigits: 0,
    maximumFractionDigits: decimalesMaximos,
    // La aserción es legítima: toFixed() SIEMPRE devuelve un literal numérico
    // válido, pero el tipo que pide Intl es una plantilla que TypeScript no
    // puede verificar sobre un string cualquiera. Es el caso de uso correcto
    // de un cast: sabemos algo que el compilador no puede demostrar.
  }).format(texto as Intl.StringNumericLiteral);
}

/**
 * Normaliza un número escrito por una persona a la forma que entiende Decimal.
 *
 * En Argentina se escribe "1.234,5": punto de miles y COMA decimal. Pero
 * decimal.js (como todo el ecosistema) espera "1234.5". Sin esta traducción,
 * alguien que escribe "2,5" kg recibiría un error incomprensible.
 *
 * La regla es la del idioma y es determinista:
 *   - si hay una coma, la coma es el separador decimal y los puntos son de
 *     miles (se descartan):   "1.234,5" → "1234.5"   "2,5" → "2.5"
 *   - si no hay coma, el punto es el separador decimal: "2.5" → "2.5"
 *
 * No valida: si el texto no es un número, lo devuelve tal cual y que falle la
 * validación de quien corresponde (así el mensaje de error es el adecuado).
 */
export function normalizarNumero(texto: string): string {
  const limpio = texto.trim();
  if (!limpio.includes(',')) return limpio;
  return limpio.replaceAll('.', '').replace(',', '.');
}

/** ¿Este texto es un número decimal válido? Nunca lanza. */
export function esDecimalValido(texto: string): boolean {
  try {
    return new Decimal(normalizarNumero(texto)).isFinite();
  } catch {
    return false;
  }
}
