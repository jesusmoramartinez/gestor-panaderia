import { type ImagenEntrada, MAX_BYTES_COMPROBANTE, type TipoComprobante } from '@panaderia/shared';

import { errores } from './errores.js';
import type { Tx } from '../modules/movimientos/motor.js';

/**
 * QUÉ TIPO DE IMAGEN ES, mirando sus primeros bytes.
 *
 * No se le cree al navegador ni al nombre del archivo: un ".jpg" puede ser
 * cualquier cosa. Cada formato empieza con una FIRMA fija ("magic number"):
 *   JPEG  FF D8 FF
 *   PNG   89 50 4E 47 0D 0A 1A 0A   (‰PNG y un salto de línea)
 *   WebP  "RIFF" ···· "WEBP"
 * Si no es ninguna, no es una imagen que sepamos mostrar, y se rechaza. Es
 * también lo que hace seguro devolverla después: se sirve con el tipo que
 * dijeron sus bytes, nunca con uno que mandó alguien.
 */
export function detectarTipoImagen(bytes: Uint8Array): TipoComprobante | null {
  const empieza = (firma: readonly number[], desde = 0) =>
    bytes.length >= desde + firma.length && firma.every((valor, i) => bytes[desde + i] === valor);

  if (empieza([0xff, 0xd8, 0xff])) return 'image/jpeg';
  if (empieza([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png';
  // "RIFF" y, 8 bytes después, "WEBP".
  if (empieza([0x52, 0x49, 0x46, 0x46]) && empieza([0x57, 0x45, 0x42, 0x50], 8)) {
    return 'image/webp';
  }
  return null;
}

export type ImagenDecodificada = { tipo: TipoComprobante; datos: Uint8Array<ArrayBuffer> };

/**
 * Pasa las imágenes de base64 a bytes y las verifica, ANTES de abrir la
 * transacción: es trabajo de CPU y no conviene tener la base esperando.
 *
 * `campo` es el nombre del campo en el formulario, para que el error
 * aparezca abajo del selector de archivos.
 */
export function decodificarImagenes(
  entradas: readonly ImagenEntrada[],
  campo = 'comprobantes',
): ImagenDecodificada[] {
  return entradas.map((entrada, indice) => {
    const buffer = Buffer.from(entrada.datos, 'base64');
    const datos = new Uint8Array(buffer.byteLength);
    datos.set(buffer);
    const donde = entradas.length === 1 ? campo : `${campo}.${String(indice)}`;

    if (datos.byteLength === 0 || datos.byteLength > MAX_BYTES_COMPROBANTE) {
      throw errores.datosInvalidos({ [donde]: 'La imagen tiene que pesar menos de 2 MB.' });
    }
    const tipo = detectarTipoImagen(datos);
    if (tipo === null) {
      throw errores.datosInvalidos({
        [donde]: 'Eso no es una imagen (tiene que ser una foto o una captura: JPG, PNG o WebP).',
      });
    }
    return { tipo, datos };
  });
}

/** Guarda las imágenes colgadas de UN pago o de UNA entrega, en la transacción del que llama. */
export async function guardarComprobantes(
  tx: Tx,
  dueno: { empresaId: string; usuarioId: string },
  de: { pagoId: string } | { recepcionCompraId: string },
  imagenes: readonly ImagenDecodificada[],
): Promise<void> {
  for (const imagen of imagenes) {
    await tx.comprobante.create({
      data: {
        empresaId: dueno.empresaId,
        usuarioId: dueno.usuarioId,
        ...de,
        tipo: imagen.tipo,
        datos: imagen.datos,
        bytes: imagen.datos.byteLength,
      },
      select: { id: true },
    });
  }
}
