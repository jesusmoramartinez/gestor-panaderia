import { useEffect, useRef } from 'react';
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
