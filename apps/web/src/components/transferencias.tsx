import type { EstadoTransferencia } from '@panaderia/shared';

const TEXTO: Record<EstadoTransferencia, string> = {
  ENVIADA: 'en tránsito',
  RECIBIDA: 'recibida',
  ANULADA: 'anulada',
};

const COLOR: Record<EstadoTransferencia, string> = {
  ENVIADA: 'bg-sky-100 text-sky-800 dark:bg-sky-950/60 dark:text-sky-300',
  RECIBIDA: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300',
  ANULADA: 'bg-slate-200 text-slate-600 dark:bg-slate-700 dark:text-slate-300',
};

export function EtiquetaEstadoTransferencia({ estado }: { estado: EstadoTransferencia }) {
  return (
    <span
      className={`inline-block rounded-full px-2 py-0.5 text-xs font-semibold ${COLOR[estado]}`}
    >
      {TEXTO[estado]}
    </span>
  );
}
