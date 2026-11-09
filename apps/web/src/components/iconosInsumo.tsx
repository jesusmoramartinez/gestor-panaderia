import { useId } from 'react';

/**
 * LOS ÍCONOS DE LOS INSUMOS: emoji.
 *
 * Un emoji es un carácter de texto, como una letra: se guarda en la base
 * como texto (columna `icono`), no pesa nada y se reconoce al instante (🥚
 * es huevo en cualquier idioma). Lo dibuja el sistema operativo, así que se
 * ve un poco distinto en Android, iPhone y Windows, pero siempre se entiende.
 *
 * Esta es la lista para ELEGIR, agrupada como se piensa en una panadería. El
 * nombre de cada uno es para el lector de pantalla y para el cartelito que
 * aparece al pasar el mouse.
 */
export const GRUPOS_DE_ICONOS: readonly {
  grupo: string;
  iconos: readonly (readonly [string, string])[];
}[] = [
  {
    grupo: 'Harinas y masas',
    iconos: [
      ['🌾', 'Trigo, harina'],
      ['🌽', 'Maíz, polenta'],
      ['🍚', 'Arroz, almidón'],
      ['🫧', 'Levadura'],
      ['🥖', 'Pan'],
      ['🍞', 'Pan de molde'],
      ['🥐', 'Medialuna, hojaldre'],
      ['🫓', 'Prepizza, tapas'],
    ],
  },
  {
    grupo: 'Grasas, azúcar y sal',
    iconos: [
      ['🧈', 'Manteca, margarina'],
      ['🐄', 'Grasa vacuna'],
      ['🌻', 'Aceite de girasol'],
      ['🫒', 'Aceite de oliva, aceitunas'],
      ['🍬', 'Azúcar'],
      ['🍯', 'Miel, dulce de leche'],
      ['🧂', 'Sal'],
      ['🧪', 'Aditivo, mejorador, esencia'],
    ],
  },
  {
    grupo: 'Lácteos y huevos',
    iconos: [
      ['🥛', 'Leche'],
      ['🍦', 'Crema'],
      ['🧀', 'Queso'],
      ['🥚', 'Huevo'],
    ],
  },
  {
    grupo: 'Dulces y rellenos',
    iconos: [
      ['🍫', 'Chocolate, cacao'],
      ['🍓', 'Frutilla, mermelada'],
      ['🍑', 'Durazno'],
      ['🍒', 'Cereza, fruta abrillantada'],
      ['🍋', 'Limón'],
      ['🍎', 'Manzana'],
      ['🍠', 'Batata'],
      ['🍇', 'Pasas de uva'],
      ['🥥', 'Coco'],
      ['🌰', 'Nuez, castaña, almendra'],
      ['🥜', 'Maní'],
      ['🌱', 'Semillas'],
      ['✨', 'Grana, decoración'],
      ['🎂', 'Torta'],
      ['🍪', 'Galletita'],
      ['🍩', 'Dona, bola de fraile'],
    ],
  },
  {
    grupo: 'Salados',
    iconos: [
      ['🥓', 'Jamón, panceta'],
      ['🍗', 'Pollo'],
      ['🥩', 'Carne'],
      ['🐟', 'Atún, pescado'],
      ['🍅', 'Tomate, salsa'],
      ['🧅', 'Cebolla'],
      ['🧄', 'Ajo'],
      ['🫑', 'Morrón'],
      ['🥬', 'Verdura de hoja'],
      ['🌿', 'Orégano, hierbas'],
      ['🌶️', 'Ají, pimentón'],
    ],
  },
  {
    grupo: 'Bebidas',
    iconos: [
      ['☕', 'Café'],
      ['🍵', 'Té, mate cocido'],
      ['🧃', 'Jugo'],
      ['🥤', 'Gaseosa'],
      ['💧', 'Agua'],
    ],
  },
  {
    grupo: 'Envases, limpieza y otros',
    iconos: [
      ['📦', 'Caja'],
      ['🛍️', 'Bolsa'],
      ['🧻', 'Papel'],
      ['🥡', 'Bandeja, envase'],
      ['🫙', 'Frasco, pote'],
      ['🥫', 'Lata'],
      ['🏷️', 'Etiqueta'],
      ['🧤', 'Guantes, descartables'],
      ['🧽', 'Limpieza'],
      ['🧴', 'Detergente, lavandina'],
      ['🔥', 'Gas, combustible'],
    ],
  },
];

/** Lo que se muestra: el ícono del insumo, o el de su categoría, o una bolsa. */
export function iconoDe(insumo: {
  icono: string | null;
  categoria: { icono: string | null } | null;
}): string {
  return insumo.icono ?? insumo.categoria?.icono ?? '📦';
}

/** El ícono dentro de un cuadradito, para listas y tarjetas. */
export function CuadroIcono({ icono, grande = false }: { icono: string; grande?: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={`grid shrink-0 place-items-center rounded-xl bg-amber-50 dark:bg-slate-800 ${
        grande ? 'size-12 text-2xl' : 'size-10 text-xl'
      }`}
    >
      {icono}
    </span>
  );
}

/**
 * El botón que muestra el ícono elegido y abre la grilla para cambiarlo.
 *
 * La grilla usa el atributo `popover` del HTML: el navegador la pone por
 * encima de todo (también de un <dialog>), la cierra con Escape o al tocar
 * afuera, y el botón la abre con `popoverTarget`. Sin JavaScript propio para
 * abrir, cerrar ni posicionar.
 *
 * `sugerido` es el que se usaría si no se elige ninguno (el de la categoría):
 * se muestra apagado, para que se entienda que todavía no es una elección.
 */
export function SelectorIcono({
  valor,
  sugerido,
  onCambiar,
  deshabilitado = false,
}: {
  valor: string | null;
  sugerido: string | null;
  onCambiar: (icono: string | null) => void;
  deshabilitado?: boolean;
}) {
  const id = useId();
  const idGrilla = `grilla-iconos-${id}`;
  const mostrado = valor ?? sugerido;

  function elegir(icono: string | null): void {
    onCambiar(icono);
    // Cerrar la grilla después de elegir.
    document.getElementById(idGrilla)?.hidePopover();
  }

  return (
    <div>
      <span className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-200">
        Ícono
      </span>
      <button
        type="button"
        popoverTarget={idGrilla}
        disabled={deshabilitado}
        aria-label={valor === null ? 'Elegir ícono' : `Ícono: ${valor}. Cambiar`}
        className={`grid size-12 place-items-center rounded-xl border border-slate-300 bg-white text-2xl transition hover:border-corteza disabled:opacity-60 dark:border-slate-600 dark:bg-slate-800 ${
          valor === null ? 'text-slate-400' : ''
        }`}
      >
        {mostrado === null ? (
          <span className="text-xl" aria-hidden="true">
            ＋
          </span>
        ) : (
          <span aria-hidden="true" className={valor === null ? 'opacity-40 grayscale' : ''}>
            {mostrado}
          </span>
        )}
      </button>

      <div
        id={idGrilla}
        popover="auto"
        className="m-auto max-h-[80dvh] w-[min(34rem,calc(100vw-2rem))] overflow-y-auto rounded-2xl bg-white p-4 text-slate-900 shadow-xl backdrop:bg-black/20 dark:bg-slate-900 dark:text-slate-100"
      >
        <div className="mb-3 flex items-center justify-between gap-2">
          <p className="font-semibold">Elegí un ícono</p>
          <button
            type="button"
            onClick={() => {
              elegir(null);
            }}
            className="min-h-10 rounded-lg px-3 text-sm text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
          >
            {sugerido === null ? 'Sin ícono' : `Usar el de la categoría (${sugerido})`}
          </button>
        </div>
        {GRUPOS_DE_ICONOS.map(({ grupo, iconos }) => (
          <section key={grupo} className="mb-3">
            <h3 className="mb-1 text-xs font-semibold tracking-wide text-slate-500 uppercase dark:text-slate-400">
              {grupo}
            </h3>
            <div className="grid grid-cols-8 gap-1">
              {iconos.map(([icono, nombre]) => (
                <button
                  key={icono}
                  type="button"
                  title={nombre}
                  aria-label={nombre}
                  aria-pressed={valor === icono}
                  onClick={() => {
                    elegir(icono);
                  }}
                  className={`grid aspect-square place-items-center rounded-lg text-2xl transition hover:bg-amber-50 dark:hover:bg-slate-800 ${
                    valor === icono
                      ? 'bg-amber-100 ring-2 ring-corteza dark:bg-slate-800 dark:ring-corteza-claro'
                      : ''
                  }`}
                >
                  {icono}
                </button>
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
