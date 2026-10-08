import { formatearCantidad, formatearFechaArgentina, type Movimiento } from '@panaderia/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useParams } from 'react-router';

import { DialogoConfirmacion } from '../components/Dialogo';
import { CLASE_BOTON_SECUNDARIO, MensajeError, Tarjeta } from '../components/formulario';
import { CantidadMovimiento, EtiquetaTipo, Saldo } from '../components/stock';
import { useSucursalActiva } from '../components/SucursalActiva';
import { usePuede } from '../hooks/useSesion';
import { ErrorDeApi } from '../lib/api';
import { obtenerInsumo } from '../lib/catalogo';
import { anularMovimiento, obtenerHistorial } from '../lib/stock';

const POR_PAGINA = 25;

export function HistorialInsumo() {
  const { insumoId = '' } = useParams();
  const { activa } = useSucursalActiva();
  const queryClient = useQueryClient();
  const puedeAnular = usePuede('movimiento:anular');
  const puedeForzar = usePuede('stock:forzar');

  const [pagina, setPagina] = useState(0);
  const [aAnular, setAAnular] = useState<Movimiento | null>(null);
  const [errorAnular, setErrorAnular] = useState<string | null>(null);
  const [necesitaForzar, setNecesitaForzar] = useState(false);

  const filtro = {
    sucursalId: activa?.id ?? '',
    limite: POR_PAGINA,
    desplazamiento: pagina * POR_PAGINA,
  };

  const insumo = useQuery({
    queryKey: ['insumo', insumoId],
    queryFn: () => obtenerInsumo(insumoId),
  });

  const historial = useQuery({
    queryKey: ['historial', insumoId, filtro],
    queryFn: () => obtenerHistorial(insumoId, filtro),
    enabled: activa !== null,
  });

  const anular = useMutation({
    mutationFn: ({ id, forzar }: { id: string; forzar: boolean }) =>
      anularMovimiento(id, { notas: null, forzar }),
    onSuccess: async () => {
      setAAnular(null);
      setErrorAnular(null);
      setNecesitaForzar(false);
      await queryClient.invalidateQueries({ queryKey: ['historial'] });
      await queryClient.invalidateQueries({ queryKey: ['stock'] });
    },
    onError: (error) => {
      if (error instanceof ErrorDeApi && error.codigo === 'STOCK_INSUFICIENTE') {
        setNecesitaForzar(true);
      }
      setErrorAnular(error.message);
    },
  });

  if (activa === null) {
    return <MensajeError>No tenés ninguna sucursal asignada.</MensajeError>;
  }
  if (historial.isError) {
    return (
      <div className="space-y-3">
        <MensajeError>{historial.error.message}</MensajeError>
        <Link to="/stock" className="text-sm text-corteza dark:text-corteza-claro hover:underline">
          ← Volver al stock
        </Link>
      </div>
    );
  }

  const unidad = insumo.data?.unidadBase.codigo ?? '';
  const total = historial.data?.total ?? 0;
  const ultimaPagina = Math.max(0, Math.ceil(total / POR_PAGINA) - 1);

  return (
    <div className="space-y-4">
      <div>
        <Link to="/stock" className="text-sm text-corteza dark:text-corteza-claro hover:underline">
          ← Volver al stock
        </Link>
        <h1 className="mt-1 text-2xl font-bold text-slate-900 dark:text-slate-50">
          {insumo.data?.nombre ?? 'Historial'}
        </h1>
        <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
          {activa.nombre} · {String(total)} movimientos
        </p>
      </div>

      <Tarjeta titulo="Stock actual">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <Saldo valor={historial.data?.saldo ?? '0'} unidad={unidad} grande />
          <Link
            to={`/insumos/${insumoId}`}
            className="text-sm text-corteza dark:text-corteza-claro hover:underline"
          >
            Ver la ficha del insumo →
          </Link>
        </div>
        <p className="mt-2 text-xs text-slate-600 dark:text-slate-400">
          Este número no está guardado en ninguna parte: es la suma de los {String(total)}{' '}
          movimientos de abajo.
        </p>
      </Tarjeta>

      {historial.data?.items.length === 0 ? (
        <p className="rounded-2xl bg-white p-8 text-center text-slate-600 dark:text-slate-400 shadow-sm dark:bg-slate-900">
          Este insumo todavía no tiene movimientos en {activa.nombre}.
        </p>
      ) : (
        <ul className="space-y-2">
          {(historial.data?.items ?? []).map((movimiento) => (
            <Fila
              key={movimiento.id}
              movimiento={movimiento}
              unidad={unidad}
              puedeAnular={puedeAnular}
              onAnular={() => {
                setErrorAnular(null);
                setNecesitaForzar(false);
                setAAnular(movimiento);
              }}
            />
          ))}
        </ul>
      )}

      {ultimaPagina > 0 && (
        <div className="flex items-center justify-center gap-3">
          <button
            type="button"
            onClick={() => {
              setPagina((p) => Math.max(0, p - 1));
            }}
            disabled={pagina === 0}
            className={CLASE_BOTON_SECUNDARIO}
          >
            Anterior
          </button>
          <span className="text-sm text-slate-600 dark:text-slate-300">
            Página {String(pagina + 1)} de {String(ultimaPagina + 1)}
          </span>
          <button
            type="button"
            onClick={() => {
              setPagina((p) => Math.min(ultimaPagina, p + 1));
            }}
            disabled={pagina >= ultimaPagina}
            className={CLASE_BOTON_SECUNDARIO}
          >
            Siguiente
          </button>
        </div>
      )}

      <DialogoConfirmacion
        abierto={aAnular !== null}
        titulo="¿Anular este movimiento?"
        textoConfirmar={necesitaForzar ? 'Anular igual (queda negativo)' : 'Anular'}
        trabajando={anular.isPending}
        onConfirmar={() => {
          if (aAnular === null) return;
          if (necesitaForzar && !puedeForzar) return;
          anular.mutate({ id: aAnular.id, forzar: necesitaForzar });
        }}
        onCancelar={() => {
          setAAnular(null);
          setErrorAnular(null);
          setNecesitaForzar(false);
        }}
      >
        <p>
          El movimiento <strong>no se borra</strong>: se agrega otro igual y opuesto que lo anula
          (un contra-asiento). Los dos quedan en el historial, así que se puede ver que hubo un
          error y cuándo se corrigió.
        </p>
        {aAnular !== null && (
          <p className="mt-2">
            Se van a devolver{' '}
            <strong>
              {formatearCantidad(aAnular.cantidadBase.replace('-', ''))} {unidad}
            </strong>{' '}
            {aAnular.cantidadBase.startsWith('-') ? 'al stock' : 'quitándolos del stock'}.
          </p>
        )}
        {errorAnular !== null && (
          <p className="mt-2 text-red-700 dark:text-red-400">{errorAnular}</p>
        )}
        {necesitaForzar && !puedeForzar && (
          <p className="mt-2 text-red-700 dark:text-red-400">
            Solo el encargado o el dueño pueden anularlo dejando el stock en negativo.
          </p>
        )}
      </DialogoConfirmacion>
    </div>
  );
}

function Fila({
  movimiento,
  unidad,
  puedeAnular,
  onAnular,
}: {
  movimiento: Movimiento;
  unidad: string;
  puedeAnular: boolean;
  onAnular: () => void;
}) {
  // Un movimiento ya anulado se muestra atenuado: sigue siendo parte del
  // historial (no se borró), pero ya no afecta el saldo.
  const anulado = movimiento.revertido;

  return (
    <li
      className={`rounded-2xl bg-white p-4 shadow-sm dark:bg-slate-900 ${anulado ? 'opacity-60' : ''}`}
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <EtiquetaTipo tipo={movimiento.tipo} />
        {movimiento.motivo !== null && (
          <span className="text-sm text-slate-600 dark:text-slate-300">
            {movimiento.motivo.nombre}
          </span>
        )}
        {movimiento.forzado && (
          <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-semibold text-red-800 dark:bg-red-950/60 dark:text-red-300">
            forzado
          </span>
        )}
        {anulado && (
          <span className="rounded-full bg-slate-200 px-2 py-0.5 text-xs font-semibold text-slate-600 dark:bg-slate-700 dark:text-slate-300">
            anulado
          </span>
        )}
        <span className="ml-auto">
          <CantidadMovimiento cantidadBase={movimiento.cantidadBase} unidad={unidad} />
        </span>
      </div>

      <div className="mt-1 text-sm text-slate-600 dark:text-slate-400">
        {formatearFechaArgentina(new Date(movimiento.fecha))} · {movimiento.usuario.nombre}
        {/* Si lo tipeó en otra unidad, el historial lo cuenta tal cual pasó:
            "cargó 2000 g = 2 kg". Las tres piezas salen del movimiento. */}
        {movimiento.unidadIngresada.codigo !== unidad && (
          <>
            {' · cargó '}
            {formatearCantidad(movimiento.cantidadIngresada)} {movimiento.unidadIngresada.codigo}
            {' = '}
            {formatearCantidad(movimiento.cantidadBase.replace('-', ''))} {unidad}
          </>
        )}
      </div>

      {movimiento.notas !== null && (
        <p className="mt-1 text-sm text-slate-600 italic dark:text-slate-300">
          «{movimiento.notas}»
        </p>
      )}

      {puedeAnular && !anulado && movimiento.tipo !== 'REVERSA' && (
        <button
          type="button"
          onClick={onAnular}
          className="mt-2 min-h-10 rounded-lg px-3 text-sm text-red-700 hover:underline dark:text-red-400"
        >
          Anular
        </button>
      )}
    </li>
  );
}
