import {
  ESTADOS_ORDEN,
  type EstadoOrden,
  formatearDia,
  formatearDinero,
  formatearFechaArgentina,
  type OrdenResumen,
  type RecepcionResumen,
} from '@panaderia/shared';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router';

import { EtiquetaAnulada, EtiquetaAtrasada, EtiquetaEstadoOrden } from '../components/compras';
import {
  CLASE_BOTON_PRIMARIO,
  CLASE_BOTON_SECUNDARIO,
  CLASE_CONTROL,
  MensajeError,
} from '../components/formulario';
import { usePuede } from '../hooks/useSesion';
import { listarOrdenes, listarRecepciones } from '../lib/compras';

type Pestana = 'ordenes' | 'recepciones';

/**
 * Compras: lo que se pidió y lo que llegó.
 *
 * La vista por defecto es "pendientes de recibir" (PEDIDA y PARCIAL): es la
 * pregunta que el dueño se hace todos los días ("¿qué me falta que llegue?").
 * Lo atrasado aparece marcado en rojo (pedido C-8).
 */
export function Compras() {
  const [pestana, setPestana] = useState<Pestana>('ordenes');
  const puedePedir = usePuede('compra:pedir');
  const puedeRecibir = usePuede('compra:recibir');
  const puedeVer = usePuede('compra:ver');

  if (!puedeVer) return <MensajeError>No tenés permiso para ver las compras.</MensajeError>;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="mr-auto">
          <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-50">Compras</h1>
          <p className="text-sm text-slate-600 dark:text-slate-400">
            Pedir no suma stock: lo suma la recepción, cuando la mercadería llega.
          </p>
        </div>
        <Link
          to="/compras/plantillas"
          className={`${CLASE_BOTON_SECUNDARIO} grid place-items-center`}
        >
          Plantillas
        </Link>
        {puedeRecibir && (
          <Link
            to="/recepciones/nueva"
            className={`${CLASE_BOTON_SECUNDARIO} grid place-items-center`}
          >
            Recepción sin orden
          </Link>
        )}
        {puedePedir && (
          <Link to="/compras/nueva" className={`${CLASE_BOTON_PRIMARIO} grid place-items-center`}>
            Nueva orden
          </Link>
        )}
      </div>

      <div role="tablist" className="flex gap-1 border-b border-slate-200 dark:border-slate-700">
        {(
          [
            ['ordenes', 'Órdenes'],
            ['recepciones', 'Recepciones'],
          ] as const
        ).map(([valor, texto]) => (
          <button
            key={valor}
            type="button"
            role="tab"
            aria-selected={pestana === valor}
            onClick={() => {
              setPestana(valor);
            }}
            className={`min-h-12 border-b-2 px-4 font-medium ${
              pestana === valor
                ? 'border-corteza text-corteza dark:border-corteza-claro dark:text-corteza-claro'
                : 'border-transparent text-slate-600 dark:text-slate-300'
            }`}
          >
            {texto}
          </button>
        ))}
      </div>

      {pestana === 'ordenes' ? <ListaOrdenes /> : <ListaRecepciones />}
    </div>
  );
}

const POR_PAGINA = 30;

function ListaOrdenes() {
  // '' = pendientes de recibir (la vista por defecto); 'TODAS' = sin filtro.
  const [filtro, setFiltro] = useState<'' | 'TODAS' | EstadoOrden>('');

  const consulta = {
    soloPendientes: filtro === '',
    estado: filtro === '' || filtro === 'TODAS' ? undefined : filtro,
    limite: POR_PAGINA,
  };
  const ordenes = useQuery({
    queryKey: ['ordenes', consulta],
    queryFn: () => listarOrdenes(consulta),
  });

  return (
    <div className="space-y-3">
      <select
        value={filtro}
        onChange={(evento) => {
          setFiltro(evento.target.value as typeof filtro);
        }}
        aria-label="Filtrar órdenes"
        className={`${CLASE_CONTROL} sm:max-w-xs`}
      >
        <option value="">Pendientes de recibir</option>
        <option value="TODAS">Todas</option>
        {ESTADOS_ORDEN.map((estado) => (
          <option key={estado} value={estado}>
            {estado.charAt(0) + estado.slice(1).toLowerCase()}
          </option>
        ))}
      </select>

      {ordenes.isError && <MensajeError>{ordenes.error.message}</MensajeError>}
      {ordenes.isPending && (
        <p className="text-sm text-slate-600 dark:text-slate-400">Cargando órdenes...</p>
      )}
      {ordenes.data?.items.length === 0 && (
        <p className="rounded-2xl bg-white p-8 text-center text-slate-600 shadow-sm dark:bg-slate-900 dark:text-slate-400">
          {filtro === '' ? 'No hay nada pendiente de recibir.' : 'No hay órdenes con ese filtro.'}
        </p>
      )}

      <ul className="space-y-2">
        {(ordenes.data?.items ?? []).map((orden) => (
          <FilaOrden key={orden.id} orden={orden} />
        ))}
      </ul>
    </div>
  );
}

function FilaOrden({ orden }: { orden: OrdenResumen }) {
  return (
    <li>
      <Link
        to={`/compras/${orden.id}`}
        className="block rounded-2xl bg-white p-4 shadow-sm transition hover:bg-slate-50 dark:bg-slate-900 dark:hover:bg-slate-800/60"
      >
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span className="font-semibold">OC {orden.numero}</span>
          <span className="font-medium">{orden.proveedor.nombre}</span>
          <EtiquetaEstadoOrden estado={orden.estado} />
          {orden.atrasada && <EtiquetaAtrasada fecha={orden.fechaEntregaEstimada} />}
          <span className="ml-auto font-semibold tabular-nums">
            {orden.totalEstimado === null ? '' : formatearDinero(orden.totalEstimado)}
          </span>
        </div>
        <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
          {orden.sucursal.nombre} · {orden.cantidadLineas}{' '}
          {orden.cantidadLineas === 1 ? 'insumo' : 'insumos'}
          {orden.pedidaAt !== null &&
            ` · pedida ${formatearFechaArgentina(new Date(orden.pedidaAt))}`}
          {orden.fechaEntregaEstimada !== null &&
            !orden.atrasada &&
            ` · llega el ${formatearDia(orden.fechaEntregaEstimada)}`}
        </p>
      </Link>
    </li>
  );
}

function ListaRecepciones() {
  const recepciones = useQuery({
    queryKey: ['recepciones', { limite: POR_PAGINA }],
    queryFn: () => listarRecepciones({ limite: POR_PAGINA }),
  });

  return (
    <div className="space-y-3">
      {recepciones.isError && <MensajeError>{recepciones.error.message}</MensajeError>}
      {recepciones.data?.items.length === 0 && (
        <p className="rounded-2xl bg-white p-8 text-center text-slate-600 shadow-sm dark:bg-slate-900 dark:text-slate-400">
          Todavía no se registró ninguna recepción.
        </p>
      )}
      <ul className="space-y-2">
        {(recepciones.data?.items ?? []).map((recepcion) => (
          <FilaRecepcion key={recepcion.id} recepcion={recepcion} />
        ))}
      </ul>
    </div>
  );
}

export function FilaRecepcion({ recepcion }: { recepcion: RecepcionResumen }) {
  const anulada = recepcion.estado === 'ANULADA';
  return (
    <li>
      <Link
        to={`/recepciones/${recepcion.id}`}
        className={`block rounded-2xl bg-white p-4 shadow-sm transition hover:bg-slate-50 dark:bg-slate-900 dark:hover:bg-slate-800/60 ${
          anulada ? 'opacity-60' : ''
        }`}
      >
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span className="font-semibold">Recepción {recepcion.numero}</span>
          <span className="font-medium">{recepcion.proveedor.nombre}</span>
          {anulada && <EtiquetaAnulada />}
          <span className="ml-auto font-semibold tabular-nums">
            {formatearDinero(recepcion.total)}
          </span>
        </div>
        <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
          {formatearFechaArgentina(new Date(recepcion.fecha))} · {recepcion.sucursal.nombre}
          {recepcion.orden === null ? ' · sin orden' : ` · OC ${String(recepcion.orden.numero)}`}
          {recepcion.numeroRemito !== null && ` · remito ${recepcion.numeroRemito}`}
        </p>
      </Link>
    </li>
  );
}
