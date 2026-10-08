import { NOMBRE_SISTEMA } from '@panaderia/shared';
import { useQuery } from '@tanstack/react-query';
import type { ReactNode } from 'react';

import { obtenerSalud } from './lib/api';

function Indicador({ estado }: { estado: 'ok' | 'error' | 'cargando' }) {
  const estilos = {
    ok: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300',
    error: 'bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300',
    cargando: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300',
  }[estado];

  const texto = { ok: 'ok', error: 'error', cargando: '...' }[estado];

  return <span className={`rounded-full px-3 py-1 text-sm font-semibold ${estilos}`}>{texto}</span>;
}

function Fila({ etiqueta, children }: { etiqueta: string; children: ReactNode }) {
  return (
    <div className="flex min-h-14 items-center justify-between gap-4 border-b border-slate-200 py-3 last:border-0 dark:border-slate-700">
      <span className="text-slate-600 dark:text-slate-300">{etiqueta}</span>
      {children}
    </div>
  );
}

export function App() {
  // useQuery se encarga del estado de carga, de los errores, del caché y de
  // los reintentos. Sin esto harían falta tres useState y un useEffect.
  const consulta = useQuery({
    queryKey: ['salud'],
    queryFn: obtenerSalud,
  });

  const salud = consulta.data;

  return (
    <main className="flex min-h-dvh items-center justify-center bg-masa p-4 dark:bg-horno">
      <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-lg sm:p-8 dark:bg-slate-900">
        <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-50">{NOMBRE_SISTEMA}</h1>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          Fase 0 — verificación de que todas las piezas están conectadas
        </p>

        <div className="mt-6">
          <Fila etiqueta="API (Express)">
            <Indicador estado={consulta.isPending ? 'cargando' : salud ? 'ok' : 'error'} />
          </Fila>

          <Fila etiqueta="Base de datos (PostgreSQL)">
            <Indicador estado={consulta.isPending ? 'cargando' : salud ? salud.db : 'error'} />
          </Fila>

          {salud && (
            <>
              <Fila etiqueta="Hora del servidor (Argentina)">
                <span className="font-mono text-sm text-slate-900 dark:text-slate-100">
                  {salud.ahoraArgentina}
                </span>
              </Fila>
              <Fila etiqueta="Contrato compartido">
                <span className="font-mono text-sm text-slate-900 dark:text-slate-100">
                  v{salud.version}
                </span>
              </Fila>
            </>
          )}
        </div>

        {consulta.isError && (
          <p className="mt-4 rounded-lg bg-red-50 p-3 text-sm text-red-800 dark:bg-red-950/50 dark:text-red-300">
            {consulta.error.message}
          </p>
        )}

        {salud?.db === 'error' && (
          <p className="mt-4 rounded-lg bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-950/50 dark:text-amber-200">
            La API responde pero no alcanza la base. Probá <code>pnpm db:up</code>.
            {salud.detalleError && (
              <span className="mt-1 block font-mono text-xs opacity-75">{salud.detalleError}</span>
            )}
          </p>
        )}

        {/* min-h-12 = botón cómodo para usar con el dedo en una tablet */}
        <button
          type="button"
          onClick={() => void consulta.refetch()}
          disabled={consulta.isFetching}
          className="mt-6 min-h-12 w-full rounded-xl bg-corteza px-4 font-semibold text-white transition active:scale-[0.99] disabled:opacity-50"
        >
          {consulta.isFetching ? 'Verificando...' : 'Verificar de nuevo'}
        </button>
      </div>
    </main>
  );
}
