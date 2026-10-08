import { randomBytes, scrypt, timingSafeEqual, type ScryptOptions } from 'node:crypto';

/**
 * Hasheo de contraseñas con scrypt (incluido en Node, sin dependencias).
 *
 * Un HASH es una transformación irreversible: de la contraseña se guarda el
 * hash, nunca la contraseña. Se puede verificar si una contraseña coincide,
 * pero no recuperarla. No es cifrado (el cifrado se deshace con la clave).
 *
 * ¿Por qué no un hash común como SHA-256? Porque SHA-256 está diseñado para
 * ser RÁPIDO, y eso es exactamente lo que no querés: con una placa de video se
 * prueban miles de millones de combinaciones por segundo. scrypt está diseñado
 * para ser LENTO y para consumir MUCHA MEMORIA, lo que vuelve carísimo el
 * ataque por fuerza bruta.
 */

/** Separador del formato almacenado. No puede aparecer en base64. */
const SEPARADOR = '$';
const ETIQUETA = 'scrypt';

/**
 * Parámetros de costo.
 *  N = costo de CPU y memoria (es el que manda: duplicarlo duplica las dos cosas)
 *  r = tamaño del bloque
 *  p = paralelismo
 * Memoria usada ≈ 128 * N * r bytes.
 */
export const PARAMETROS_POR_DEFECTO = { N: 65_536, r: 8, p: 1 } as const;

const LARGO_SALT = 16;
const LARGO_HASH = 32;

/**
 * Node limita por defecto scrypt a 32 MB y nuestros parámetros piden ~67 MB,
 * así que hay que subir el techo explícitamente.
 */
const MAX_MEM = 256 * 1024 * 1024;

export type ParametrosScrypt = { N: number; r: number; p: number };

/**
 * Envuelve la función de Node (que usa callback) en una promesa.
 * Es el patrón para adaptar cualquier API vieja de Node a async/await.
 */
function derivar(
  password: string,
  salt: Buffer,
  largo: number,
  parametros: ParametrosScrypt,
): Promise<Buffer> {
  const opciones: ScryptOptions = { ...parametros, maxmem: MAX_MEM };
  return new Promise((resolver, rechazar) => {
    scrypt(password, salt, largo, opciones, (error, clave) => {
      if (error) rechazar(error);
      else resolver(clave);
    });
  });
}

/**
 * Las tildes y la ñ se pueden representar de dos formas distintas en Unicode:
 * "ñ" puede ser un solo carácter o ser "n" + "~" combinados. Se ven igual pero
 * son bytes distintos, así que hashean distinto. Normalizar evita que la misma
 * contraseña falle según el teclado o el sistema desde el que se escribió.
 * En un sistema en español esto no es un detalle.
 */
function normalizar(password: string): string {
  return password.normalize('NFKC');
}

/**
 * Devuelve un texto autocontenido con TODO lo necesario para verificar después:
 *
 *   scrypt$65536$8$1$<salt en base64>$<hash en base64>
 *
 * Guardar los parámetros adentro es importante: el día que subamos el costo
 * (porque las máquinas son más rápidas), las contraseñas viejas siguen
 * verificándose con los parámetros con los que fueron creadas.
 */
export async function hashearPassword(
  password: string,
  parametros: ParametrosScrypt = PARAMETROS_POR_DEFECTO,
): Promise<string> {
  // El SALT es un valor aleatorio distinto para cada contraseña. Sin salt, dos
  // usuarios con la misma contraseña tendrían el mismo hash, y se podrían usar
  // tablas precalculadas para romperlas todas de una.
  const salt = randomBytes(LARGO_SALT);
  const hash = await derivar(normalizar(password), salt, LARGO_HASH, parametros);

  return [
    ETIQUETA,
    parametros.N,
    parametros.r,
    parametros.p,
    salt.toString('base64'),
    hash.toString('base64'),
  ].join(SEPARADOR);
}

/** Verifica una contraseña contra un hash almacenado. Nunca lanza. */
export async function verificarPassword(password: string, almacenado: string): Promise<boolean> {
  const partes = almacenado.split(SEPARADOR);
  if (partes.length !== 6 || partes[0] !== ETIQUETA) return false;

  const N = Number(partes[1]);
  const r = Number(partes[2]);
  const p = Number(partes[3]);
  if (!esEnteroPositivo(N) || !esEnteroPositivo(r) || !esEnteroPositivo(p)) return false;

  const salt = Buffer.from(partes[4], 'base64');
  const esperado = Buffer.from(partes[5], 'base64');
  if (salt.length === 0 || esperado.length === 0) return false;

  let obtenido: Buffer;
  try {
    obtenido = await derivar(normalizar(password), salt, esperado.length, { N, r, p });
  } catch {
    // Parámetros absurdos (un N gigante) hacen fallar a scrypt. Un hash que no
    // se puede verificar no valida: devolvemos false, no un error.
    return false;
  }

  // timingSafeEqual compara SIEMPRE en el mismo tiempo. Con === la comparación
  // corta en el primer byte distinto, y midiendo cuánto tarda se puede ir
  // adivinando el hash byte por byte (ataque de temporización).
  return timingSafeEqual(obtenido, esperado);
}

function esEnteroPositivo(valor: number): boolean {
  return Number.isInteger(valor) && valor > 0;
}
