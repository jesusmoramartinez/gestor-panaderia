import { useEffect, useId, useRef } from 'react';
import type { ReactNode } from 'react';

import { CLASE_BOTON_PELIGRO, CLASE_BOTON_SECUNDARIO } from './formulario';

/**
 * Diálogo modal con el elemento <dialog> NATIVO del navegador.
 *
 * Elegimos el nativo en lugar de una librería porque ya trae resuelto lo
 * difícil y lo que más se suele hacer mal:
 *   - atrapa el foco adentro del diálogo (no se puede tabular hacia afuera);
 *   - se cierra con la tecla Escape;
 *   - bloquea el resto de la página para los lectores de pantalla;
 *   - dibuja el fondo oscurecido con ::backdrop.
 *
 * Lo único que hay que hacer es llamar a showModal() y close(), y escuchar el
 * evento 'close' (que también se dispara con Escape, por eso avisamos de la
 * cancelación desde ahí y no solo desde el botón).
 */
export function DialogoConfirmacion({
  abierto,
  titulo,
  children,
  textoConfirmar,
  trabajando = false,
  onConfirmar,
  onCancelar,
}: {
  abierto: boolean;
  titulo: string;
  children: ReactNode;
  textoConfirmar: string;
  trabajando?: boolean;
  onConfirmar: () => void;
  onCancelar: () => void;
}) {
  const dialogo = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const elemento = dialogo.current;
    if (!elemento) return;
    if (abierto && !elemento.open) elemento.showModal();
    if (!abierto && elemento.open) elemento.close();
  }, [abierto]);

  return (
    <dialog
      ref={dialogo}
      onClose={onCancelar}
      className="m-auto w-[min(28rem,calc(100vw-2rem))] rounded-2xl bg-white p-6 text-slate-900 shadow-xl backdrop:bg-black/40 dark:bg-slate-900 dark:text-slate-100"
    >
      <h2 className="text-lg font-bold">{titulo}</h2>
      <div className="mt-2 text-sm text-slate-600 dark:text-slate-300">{children}</div>
      <div className="mt-6 flex flex-wrap justify-end gap-2">
        <button
          type="button"
          onClick={onCancelar}
          disabled={trabajando}
          className={CLASE_BOTON_SECUNDARIO}
        >
          Cancelar
        </button>
        <button
          type="button"
          onClick={onConfirmar}
          disabled={trabajando}
          className={CLASE_BOTON_PELIGRO}
        >
          {trabajando ? 'Un momento...' : textoConfirmar}
        </button>
      </div>
    </dialog>
  );
}

/**
 * Un modal con contenido libre (un formulario, por ejemplo), también con el
 * <dialog> nativo. Arriba el título y una ✕; el resto lo pone quien lo usa.
 *
 * `onCerrar` se llama al tocar la ✕, con Escape o tocando el fondo oscuro.
 */
export function Modal({
  abierto,
  titulo,
  onCerrar,
  children,
}: {
  abierto: boolean;
  titulo: string;
  onCerrar: () => void;
  children: ReactNode;
}) {
  const dialogo = useRef<HTMLDialogElement>(null);
  const idTitulo = useId();

  useEffect(() => {
    const elemento = dialogo.current;
    if (!elemento) return;
    if (abierto && !elemento.open) elemento.showModal();
    if (!abierto && elemento.open) elemento.close();
  }, [abierto]);

  return (
    <dialog
      ref={dialogo}
      // El título le da nombre al diálogo: el lector de pantalla dice
      // "Nuevo insumo, diálogo" al abrirlo.
      aria-labelledby={idTitulo}
      onClose={onCerrar}
      // Un clic en el fondo oscuro llega al <dialog> mismo (no a un hijo):
      // es la forma de saber que tocaron afuera del cuadro.
      onClick={(evento) => {
        if (evento.target === evento.currentTarget) onCerrar();
      }}
      className="m-auto w-[min(40rem,calc(100vw-2rem))] rounded-2xl bg-white text-slate-900 shadow-xl backdrop:bg-black/40 dark:bg-slate-900 dark:text-slate-100"
    >
      {/* El padding va en este div y no en el <dialog>: así un clic en el
          borde de adentro no cuenta como "tocar afuera". */}
      <div className="p-6">
        <div className="mb-4 flex items-start justify-between gap-3">
          <h2 id={idTitulo} className="text-xl font-bold">
            {titulo}
          </h2>
          <button
            type="button"
            onClick={onCerrar}
            aria-label="Cerrar"
            className="-mt-1 -mr-2 grid size-10 place-items-center rounded-lg text-xl text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
          >
            ✕
          </button>
        </div>
        {/* Solo se dibuja abierto: así el formulario arranca limpio cada vez. */}
        {abierto && children}
      </div>
    </dialog>
  );
}
