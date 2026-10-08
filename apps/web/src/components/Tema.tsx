import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';

/**
 * Claro, oscuro o lo que diga el sistema operativo.
 *
 * "auto" no es un tema: es una instrucción. Se resuelve a `claro` u `oscuro`
 * consultando `prefers-color-scheme`, y lo que termina en el <html> es siempre
 * uno de los dos concretos. Eso mantiene el CSS simple (una sola condición:
 * `data-tema="oscuro"`) y deja toda la lógica en un lugar.
 */
export const TEMAS = ['claro', 'oscuro', 'auto'] as const;
export type Tema = (typeof TEMAS)[number];

const CLAVE_ALMACENAMIENTO = 'panaderia.tema';
const CONSULTA_OSCURO = '(prefers-color-scheme: dark)';

type ValorContexto = {
  /** Lo que eligió la persona: puede ser 'auto'. */
  tema: Tema;
  /** Lo que se está viendo de verdad: nunca 'auto'. */
  resuelto: 'claro' | 'oscuro';
  cambiar: (tema: Tema) => void;
};

const Contexto = createContext<ValorContexto | null>(null);

function esTema(valor: unknown): valor is Tema {
  return typeof valor === 'string' && (TEMAS as readonly string[]).includes(valor);
}

/** localStorage puede fallar (modo privado, permisos): nunca sin try/catch. */
function leerGuardado(): Tema {
  try {
    const guardado = localStorage.getItem(CLAVE_ALMACENAMIENTO);
    return esTema(guardado) ? guardado : 'auto';
  } catch {
    return 'auto';
  }
}

function guardar(tema: Tema): void {
  try {
    localStorage.setItem(CLAVE_ALMACENAMIENTO, tema);
  } catch {
    // Si no se puede guardar, la elección vale solo para esta visita.
  }
}

function sistemaPrefiereOscuro(): boolean {
  // matchMedia no existe en algunos entornos (tests, renderizado en servidor).
  return typeof window !== 'undefined' && window.matchMedia(CONSULTA_OSCURO).matches;
}

export function ProveedorTema({ children }: { children: ReactNode }) {
  const [tema, setTema] = useState<Tema>(leerGuardado);
  const [sistemaOscuro, setSistemaOscuro] = useState(sistemaPrefiereOscuro);

  // Si la persona eligió "automático" y después cambia el tema del sistema
  // operativo, la aplicación tiene que acompañar sin recargar la página.
  useEffect(() => {
    const consulta = window.matchMedia(CONSULTA_OSCURO);
    const alCambiar = (evento: MediaQueryListEvent): void => {
      setSistemaOscuro(evento.matches);
    };
    consulta.addEventListener('change', alCambiar);
    return () => {
      consulta.removeEventListener('change', alCambiar);
    };
  }, []);

  const resuelto: 'claro' | 'oscuro' =
    tema === 'auto' ? (sistemaOscuro ? 'oscuro' : 'claro') : tema;

  // El atributo en <html> es lo que hace efecto: de ahí lo lee el
  // `@custom-variant dark` de index.css y también `color-scheme`.
  useEffect(() => {
    document.documentElement.dataset.tema = resuelto;
  }, [resuelto]);

  const cambiar = useCallback((nuevo: Tema) => {
    setTema(nuevo);
    guardar(nuevo);
  }, []);

  const valor = useMemo<ValorContexto>(
    () => ({ tema, resuelto, cambiar }),
    [tema, resuelto, cambiar],
  );

  return <Contexto.Provider value={valor}>{children}</Contexto.Provider>;
}

export function useTema(): ValorContexto {
  const valor = useContext(Contexto);
  if (!valor) throw new Error('useTema se usó fuera de ProveedorTema');
  return valor;
}

const ETIQUETA: Record<Tema, string> = {
  claro: '☀ Claro',
  oscuro: '☾ Oscuro',
  auto: '⌁ Automático',
};

/**
 * El selector de tema.
 *
 * Es un `<select>` nativo y no tres botones, por la misma razón que el resto
 * del proyecto: en la tablet abre el selector del sistema, ya es accesible con
 * teclado y no hay que mantener el foco a mano.
 */
export function SelectorTema() {
  const { tema, cambiar } = useTema();

  return (
    <label className="flex items-center gap-2 text-sm">
      <span className="sr-only">Tema de la pantalla</span>
      <select
        value={tema}
        onChange={(evento) => {
          const elegido = evento.target.value;
          if (esTema(elegido)) cambiar(elegido);
        }}
        aria-label="Tema de la pantalla"
        className="min-h-11 rounded-lg border border-slate-300 bg-white px-3 font-medium text-slate-800 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
      >
        {TEMAS.map((opcion) => (
          <option key={opcion} value={opcion}>
            {ETIQUETA[opcion]}
          </option>
        ))}
      </select>
    </label>
  );
}
