import { MAX_BYTES_COMPROBANTE } from '@panaderia/shared';

/**
 * ACHICAR UNA FOTO ANTES DE SUBIRLA (Fase 12b).
 *
 * Una foto de celular pesa 3 o 4 MB y mide 4000 px de ancho. Para leer un
 * comprobante alcanza con 1600 px: se dibuja más chica en un <canvas> (un
 * lienzo del navegador, sin librerías) y se guarda como JPEG. Queda en ~300
 * KB, y una captura de Mercado Pago se sigue leyendo perfecto.
 *
 * `imageOrientation: 'from-image'` respeta cómo se sacó la foto: sin eso, una
 * foto vertical del celular puede quedar acostada.
 */
const LADO_MAXIMO = 1600;
const CALIDAD_JPEG = 0.82;

export type ImagenPreparada = {
  /** Lo que se manda a la API: los bytes en base64. */
  datos: string;
  /**
   * Para la vista previa: una URL "data:". No se usa URL.createObjectURL
   * (que da una "blob:") porque la política de seguridad de la página (CSP)
   * solo permite imágenes del propio sitio y "data:".
   */
  vista: string;
  bytes: number;
};

export class ImagenInvalida extends Error {
  override readonly name = 'ImagenInvalida';
}

export async function prepararImagen(archivo: File): Promise<ImagenPreparada> {
  if (!archivo.type.startsWith('image/')) {
    throw new ImagenInvalida(`"${archivo.name}" no es una imagen.`);
  }

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(archivo, { imageOrientation: 'from-image' });
  } catch {
    throw new ImagenInvalida(`No se pudo abrir "${archivo.name}". Probá con otra foto o captura.`);
  }

  const escala = Math.min(1, LADO_MAXIMO / Math.max(bitmap.width, bitmap.height));
  const lienzo = document.createElement('canvas');
  lienzo.width = Math.round(bitmap.width * escala);
  lienzo.height = Math.round(bitmap.height * escala);
  const contexto = lienzo.getContext('2d');
  if (!contexto) throw new ImagenInvalida('El navegador no pudo procesar la imagen.');
  // Fondo blanco: un PNG con transparencia quedaría negro al pasarlo a JPEG.
  contexto.fillStyle = '#ffffff';
  contexto.fillRect(0, 0, lienzo.width, lienzo.height);
  contexto.drawImage(bitmap, 0, 0, lienzo.width, lienzo.height);
  bitmap.close();

  const vista = lienzo.toDataURL('image/jpeg', CALIDAD_JPEG);
  // "data:image/jpeg;base64,AAAA..." → solo lo que va después de la coma.
  const datos = vista.slice(vista.indexOf(',') + 1);
  // Cada 4 caracteres de base64 son 3 bytes.
  const bytes = Math.floor((datos.length * 3) / 4);
  if (bytes > MAX_BYTES_COMPROBANTE) {
    throw new ImagenInvalida(`"${archivo.name}" sigue pesando más de 2 MB aun achicada.`);
  }
  return { datos, vista, bytes };
}

/** La URL para ver un comprobante ya guardado. */
export function urlComprobante(id: string): string {
  return `/api/comprobantes/${id}`;
}
