import type { FormEvent, ReactNode } from 'react';

/**
 * Clases compartidas de los controles del formulario.
 *
 * Son constantes y no componentes a propósito: así se pueden aplicar a un
 * <input> común y combinarlas con lo que React Hook Form devuelve en
 * register(), sin una capa de componentes en el medio.
 *
 * min-h-12 (48 px) es la altura mínima cómoda para tocar con el dedo: es la
 * recomendación de accesibilidad para destinos táctiles, y esta aplicación se
 * usa en una tablet en el depósito.
 */
export const CLASE_CONTROL =
  'min-h-12 w-full rounded-xl border border-slate-300 bg-white px-3 text-slate-900 ' +
  'focus:border-corteza focus:outline-2 focus:outline-corteza/40 ' +
  'disabled:opacity-60 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100';

export const CLASE_BOTON_PRIMARIO =
  'min-h-12 rounded-xl bg-corteza px-5 font-semibold text-white transition ' +
  'active:scale-[0.99] disabled:opacity-50';

export const CLASE_BOTON_SECUNDARIO =
  'min-h-12 rounded-xl border border-slate-300 px-5 font-medium text-slate-700 transition ' +
  'hover:bg-slate-50 disabled:opacity-50 dark:border-slate-600 dark:text-slate-200 ' +
  'dark:hover:bg-slate-800';

export const CLASE_BOTON_PELIGRO =
  'min-h-12 rounded-xl border border-red-300 px-5 font-medium text-red-700 transition ' +
  'hover:bg-red-50 disabled:opacity-50 dark:border-red-800 dark:text-red-300 ' +
  'dark:hover:bg-red-950/40';

export function Campo({
  etiqueta,
  error,
  ayuda,
  children,
}: {
  etiqueta: string;
  error?: string | undefined;
  ayuda?: string;
  children: ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-200">
        {etiqueta}
      </span>
      {children}
      {ayuda !== undefined && error === undefined && (
        <span className="mt-1 block text-xs text-slate-500 dark:text-slate-400">{ayuda}</span>
      )}
      {error !== undefined && (
        <span role="alert" className="mt-1 block text-sm text-red-700 dark:text-red-400">
          {error}
        </span>
      )}
    </label>
  );
}

export function Tarjeta({ titulo, children }: { titulo: string; children: ReactNode }) {
  return (
    <section className="rounded-2xl bg-white p-5 shadow-sm dark:bg-slate-900">
      <h2 className="text-sm font-semibold tracking-wide text-slate-500 uppercase dark:text-slate-400">
        {titulo}
      </h2>
      <div className="mt-4">{children}</div>
    </section>
  );
}

export function MensajeError({ children }: { children: ReactNode }) {
  return (
    <p
      role="alert"
      className="rounded-lg bg-red-50 p-3 text-sm text-red-800 dark:bg-red-950/50 dark:text-red-300"
    >
      {children}
    </p>
  );
}

/**
 * Adapta el handleSubmit de React Hook Form al onSubmit de un <form>.
 *
 * handleSubmit devuelve una PROMESA (porque la validación puede ser
 * asincrónica), pero onSubmit espera una función que no devuelva nada. Pasarle
 * la promesa directamente es una "promesa flotante": si fuera rechazada, nadie
 * se enteraría. El linter lo detecta con la regla no-misused-promises.
 *
 * El operador `void` dice explícitamente "sé que devuelve una promesa y la
 * estoy descartando a propósito": React Hook Form ya maneja sus propios
 * errores adentro, así que acá no hay nada que esperar.
 */
export function alEnviar(
  manejador: (evento: FormEvent<HTMLFormElement>) => Promise<unknown>,
): (evento: FormEvent<HTMLFormElement>) => void {
  return (evento) => {
    void manejador(evento);
  };
}
