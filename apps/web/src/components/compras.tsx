import { type EstadoOrden, formatearDia } from '@panaderia/shared';

/**
 * Las piezas visuales que comparten las pantallas de compras.
 *
 * Igual que el semáforo del stock: QUÉ estado tiene una orden lo decide el
 * dominio (la máquina de estados en shared/dominio/compras.ts); esto solo
 * elige palabras y colores.
 */
const TEXTO_ESTADO: Record<EstadoOrden, string> = {
  BORRADOR: 'Borrador',
  PEDIDA: 'Pedida',
  PARCIAL: 'Llegó una parte',
  RECIBIDA: 'Recibida',
  CERRADA: 'Cerrada con faltante',
  CANCELADA: 'Cancelada',
};

const COLOR_ESTADO: Record<EstadoOrden, string> = {
  BORRADOR: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
  PEDIDA: 'bg-sky-100 text-sky-800 dark:bg-sky-950/60 dark:text-sky-300',
  PARCIAL: 'bg-amber-100 text-amber-900 dark:bg-amber-950/60 dark:text-amber-300',
  RECIBIDA: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300',
  CERRADA: 'bg-orange-100 text-orange-900 dark:bg-orange-950/60 dark:text-orange-300',
  CANCELADA: 'bg-slate-200 text-slate-600 dark:bg-slate-700 dark:text-slate-300',
};

export function EtiquetaEstadoOrden({ estado }: { estado: EstadoOrden }) {
  return (
    <span
      className={`inline-block rounded-full px-2 py-0.5 text-xs font-semibold ${COLOR_ESTADO[estado]}`}
    >
      {TEXTO_ESTADO[estado]}
    </span>
  );
}

/** Pedido C-8: que se vea de lejos lo que tendría que haber llegado y no llegó. */
export function EtiquetaAtrasada({ fecha }: { fecha: string | null }) {
  return (
    <span className="inline-block rounded-full bg-red-100 px-2 py-0.5 text-xs font-semibold text-red-800 dark:bg-red-950/60 dark:text-red-300">
      atrasada{fecha === null ? '' : ` (era el ${formatearDia(fecha)})`}
    </span>
  );
}

export function EtiquetaAnulada() {
  return (
    <span className="inline-block rounded-full bg-red-100 px-2 py-0.5 text-xs font-semibold text-red-800 dark:bg-red-950/60 dark:text-red-300">
      anulada
    </span>
  );
}

/**
 * Cómo se lee una cantidad de compra: "10 × Bolsa 25 kg" o "30 kg".
 *
 * Se muestra en la misma unidad en que se pidió, porque es como habla el
 * proveedor y como viene el remito. La cantidad en unidad base va aparte.
 */
export function textoCantidad(
  cantidad: string,
  presentacion: { nombre: string } | null,
  unidadBase: string,
  formatear: (valor: string) => string,
): string {
  return presentacion === null
    ? `${formatear(cantidad)} ${unidadBase}`
    : `${formatear(cantidad)} × ${presentacion.nombre}`;
}
