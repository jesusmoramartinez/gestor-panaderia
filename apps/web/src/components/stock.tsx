import { type EstadoStock, formatearCantidad, type TipoMovimiento } from '@panaderia/shared';

/**
 * El semáforo del stock.
 *
 * Los tres estados los decide una función pura del dominio (`estadoDeStock`),
 * no la pantalla: así el mismo criterio vale en la API, en los informes y acá.
 * Esto solo elige los colores.
 */
const COLOR_ESTADO: Record<EstadoStock, string> = {
  CRITICO: 'bg-red-100 text-red-800 dark:bg-red-950/60 dark:text-red-300',
  BAJO: 'bg-amber-100 text-amber-900 dark:bg-amber-950/60 dark:text-amber-300',
  OK: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300',
};

const TEXTO_ESTADO: Record<EstadoStock, string> = {
  CRITICO: 'sin stock',
  BAJO: 'bajo',
  OK: 'ok',
};

export function Semaforo({
  estado,
  negativo = false,
}: {
  estado: EstadoStock;
  negativo?: boolean;
}) {
  return (
    <span
      className={`inline-block rounded-full px-2 py-0.5 text-xs font-semibold ${COLOR_ESTADO[estado]}`}
    >
      {negativo ? 'NEGATIVO' : TEXTO_ESTADO[estado]}
    </span>
  );
}

/**
 * Un saldo, en rojo si está en negativo.
 *
 * Un saldo negativo no es un error de la pantalla: significa que alguien forzó
 * una salida con permiso especial, y hay que verlo de lejos.
 */
export function Saldo({
  valor,
  unidad,
  grande = false,
}: {
  valor: string;
  unidad: string;
  grande?: boolean;
}) {
  const negativo = valor.startsWith('-');
  return (
    <span
      className={`tabular-nums ${grande ? 'text-2xl font-bold' : 'font-semibold'} ${
        negativo ? 'text-red-700 dark:text-red-400' : ''
      }`}
    >
      {formatearCantidad(valor)} {unidad}
    </span>
  );
}

const ETIQUETA_TIPO: Record<TipoMovimiento, string> = {
  SALDO_INICIAL: 'Saldo inicial',
  COMPRA: 'Compra',
  CONSUMO: 'Consumo',
  MERMA: 'Merma',
  AJUSTE: 'Ajuste',
  TRANSFERENCIA_SALIDA: 'Transferencia (salida)',
  TRANSFERENCIA_ENTRADA: 'Transferencia (entrada)',
  REVERSA: 'Anulación',
};

const COLOR_TIPO: Record<TipoMovimiento, string> = {
  SALDO_INICIAL: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
  COMPRA: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300',
  CONSUMO: 'bg-sky-100 text-sky-800 dark:bg-sky-950/60 dark:text-sky-300',
  MERMA: 'bg-red-100 text-red-800 dark:bg-red-950/60 dark:text-red-300',
  AJUSTE: 'bg-violet-100 text-violet-800 dark:bg-violet-950/60 dark:text-violet-300',
  TRANSFERENCIA_SALIDA: 'bg-amber-100 text-amber-900 dark:bg-amber-950/60 dark:text-amber-300',
  TRANSFERENCIA_ENTRADA: 'bg-amber-100 text-amber-900 dark:bg-amber-950/60 dark:text-amber-300',
  REVERSA: 'bg-slate-200 text-slate-800 dark:bg-slate-700 dark:text-slate-200',
};

export function EtiquetaTipo({ tipo }: { tipo: TipoMovimiento }) {
  return (
    <span
      className={`inline-block rounded-full px-2 py-0.5 text-xs font-semibold ${COLOR_TIPO[tipo]}`}
    >
      {ETIQUETA_TIPO[tipo]}
    </span>
  );
}

/** La cantidad de un movimiento, con su signo bien visible. */
export function CantidadMovimiento({
  cantidadBase,
  unidad,
}: {
  cantidadBase: string;
  unidad: string;
}) {
  const entra = !cantidadBase.startsWith('-');
  return (
    <span
      className={`font-semibold tabular-nums ${
        entra ? 'text-emerald-700 dark:text-emerald-400' : 'text-slate-900 dark:text-slate-100'
      }`}
    >
      {entra ? '+' : '−'}
      {formatearCantidad(cantidadBase.replace('-', ''))} {unidad}
    </span>
  );
}
