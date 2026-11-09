import { type ComprobanteSalida, MAX_COMPROBANTES } from '@panaderia/shared';
import { useEffect, useId, useRef, useState } from 'react';

import {
  type ImagenPreparada,
  ImagenInvalida,
  prepararImagen,
  urlComprobante,
} from '../lib/imagenes';
import { CLASE_BOTON_SECUNDARIO } from './formulario';

/**
 * ELEGIR IMÁGENES (comprobantes de pago, foto del remito).
 *
 * Es un <input type="file"> NATIVO: en el celular abre el menú del teléfono
 * para sacar una foto o elegir de la galería (una captura de Mercado Pago),
 * sin librerías. Cada imagen elegida se achica en el navegador y se muestra
 * en miniatura, con un botón para sacarla antes de guardar.
 */
export function ElegirImagenes({
  etiqueta,
  imagenes,
  onCambiar,
  error,
}: {
  etiqueta: string;
  imagenes: readonly ImagenPreparada[];
  onCambiar: (imagenes: ImagenPreparada[]) => void;
  error?: string | undefined;
}) {
  const id = useId();
  const [trabajando, setTrabajando] = useState(false);
  const [problema, setProblema] = useState<string | null>(null);
  const lleno = imagenes.length >= MAX_COMPROBANTES;

  async function agregar(archivos: FileList | null): Promise<void> {
    if (archivos === null || archivos.length === 0) return;
    setProblema(null);
    setTrabajando(true);
    const nuevas: ImagenPreparada[] = [];
    try {
      for (const archivo of [...archivos].slice(0, MAX_COMPROBANTES - imagenes.length)) {
        nuevas.push(await prepararImagen(archivo));
      }
    } catch (causa) {
      setProblema(causa instanceof ImagenInvalida ? causa.message : 'No se pudo leer la imagen.');
    } finally {
      setTrabajando(false);
      onCambiar([...imagenes, ...nuevas]);
    }
  }

  const mensaje = problema ?? error;
  return (
    <div>
      <p className="mb-1 text-sm font-medium text-slate-700 dark:text-slate-200">{etiqueta}</p>
      {imagenes.length > 0 && (
        <ul className="mb-2 flex flex-wrap gap-2">
          {imagenes.map((imagen, indice) => (
            <li key={imagen.vista.slice(-32)} className="relative">
              <img
                src={imagen.vista}
                alt={`Imagen ${String(indice + 1)}`}
                className="h-20 w-20 rounded-lg border border-slate-200 object-cover dark:border-slate-700"
              />
              <button
                type="button"
                aria-label={`Sacar la imagen ${String(indice + 1)}`}
                onClick={() => {
                  onCambiar(imagenes.filter((_, i) => i !== indice));
                }}
                className="absolute -top-2 -right-2 grid h-8 w-8 place-items-center rounded-full bg-slate-900 text-sm font-bold text-white shadow"
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
      {!lleno && (
        <label
          htmlFor={id}
          className={`${CLASE_BOTON_SECUNDARIO} inline-grid cursor-pointer place-items-center`}
        >
          {trabajando
            ? 'Preparando...'
            : imagenes.length === 0
              ? 'Sacar foto o elegir captura'
              : 'Agregar otra'}
          <input
            id={id}
            type="file"
            accept="image/*"
            multiple
            className="sr-only"
            disabled={trabajando}
            onChange={(evento) => {
              const archivos = evento.target.files;
              void agregar(archivos);
              // Para poder volver a elegir el mismo archivo si lo sacó.
              evento.target.value = '';
            }}
          />
        </label>
      )}
      {mensaje !== undefined && mensaje !== null && (
        <p role="alert" className="mt-1 text-sm text-red-700 dark:text-red-400">
          {mensaje}
        </p>
      )}
    </div>
  );
}

/**
 * Las miniaturas de los comprobantes guardados. Tocar una la abre grande.
 * `loading="lazy"`: la imagen se pide recién cuando aparece en pantalla.
 */
export function MiniaturasComprobantes({
  comprobantes,
  titulo,
}: {
  comprobantes: readonly ComprobanteSalida[];
  titulo: string;
}) {
  const [abierto, setAbierto] = useState<string | null>(null);
  if (comprobantes.length === 0) return null;

  return (
    <>
      <ul className="flex flex-wrap gap-2">
        {comprobantes.map((comprobante, indice) => (
          <li key={comprobante.id}>
            <button
              type="button"
              onClick={() => {
                setAbierto(comprobante.id);
              }}
              aria-label={`Ver ${titulo} ${String(indice + 1)}`}
              className="block overflow-hidden rounded-lg border border-slate-200 dark:border-slate-700"
            >
              <img
                src={urlComprobante(comprobante.id)}
                alt=""
                loading="lazy"
                className="h-16 w-16 object-cover"
              />
            </button>
          </li>
        ))}
      </ul>
      <VisorImagen
        url={abierto === null ? null : urlComprobante(abierto)}
        titulo={titulo}
        onCerrar={() => {
          setAbierto(null);
        }}
      />
    </>
  );
}

/** La imagen grande, en un <dialog> nativo (se cierra con Escape o el botón). */
function VisorImagen({
  url,
  titulo,
  onCerrar,
}: {
  url: string | null;
  titulo: string;
  onCerrar: () => void;
}) {
  const dialogo = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const elemento = dialogo.current;
    if (!elemento) return;
    if (url !== null && !elemento.open) elemento.showModal();
    if (url === null && elemento.open) elemento.close();
  }, [url]);

  return (
    <dialog
      ref={dialogo}
      onClose={onCerrar}
      aria-label={titulo}
      className="m-auto max-h-[95dvh] w-[min(56rem,calc(100vw-1rem))] rounded-2xl bg-white p-3 shadow-xl backdrop:bg-black/70 dark:bg-slate-900"
    >
      <div className="mb-2 flex items-center justify-between gap-2">
        <p className="font-semibold text-slate-900 dark:text-slate-50">{titulo}</p>
        <div className="flex gap-2">
          {url !== null && (
            <a
              href={url}
              target="_blank"
              rel="noreferrer"
              className={`${CLASE_BOTON_SECUNDARIO} grid place-items-center`}
            >
              Abrir
            </a>
          )}
          <button type="button" onClick={onCerrar} className={CLASE_BOTON_SECUNDARIO}>
            Cerrar
          </button>
        </div>
      </div>
      {url !== null && (
        <img src={url} alt={titulo} className="mx-auto max-h-[80dvh] w-auto object-contain" />
      )}
    </dialog>
  );
}
