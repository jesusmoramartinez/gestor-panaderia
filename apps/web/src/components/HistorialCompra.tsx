import { formatearFechaArgentina, type TipoEvento } from '@panaderia/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router';

import { usePuede } from '../hooks/useSesion';
import { agregarNota, obtenerHistorial } from '../lib/acopio';
import { CLASE_BOTON_PRIMARIO, CLASE_CONTROL, MensajeError, Tarjeta } from './formulario';

/** El color del punto de cada evento: verde lo que suma, rojo lo que se anula. */
const COLOR: Record<TipoEvento, string> = {
  CREADA: 'bg-slate-400',
  PEDIDA: 'bg-sky-500',
  EDITADA: 'bg-slate-400',
  PAGO: 'bg-emerald-600',
  PAGO_ANULADO: 'bg-red-600',
  ENTREGA: 'bg-corteza',
  ENTREGA_ANULADA: 'bg-red-600',
  NOTA: 'bg-amber-500',
  CERRADA: 'bg-orange-600',
  CANCELADA: 'bg-red-600',
};

/**
 * EL HISTORIAL DE UNA COMPRA (Fase 12c): todo lo que le pasó, en orden, y una
 * nota libre para lo que no es un pago ni una entrega.
 */
export function HistorialCompra({ ordenId }: { ordenId: string }) {
  const queryClient = useQueryClient();
  const puedeAnotar = usePuede('compra:recibir');
  const [texto, setTexto] = useState('');

  const historial = useQuery({
    queryKey: ['historial-compra', ordenId],
    queryFn: () => obtenerHistorial(ordenId),
  });
  const anotar = useMutation({
    mutationFn: () => agregarNota(ordenId, { texto }),
    onSuccess: (actualizado) => {
      queryClient.setQueryData(['historial-compra', ordenId], actualizado);
      setTexto('');
    },
  });

  return (
    <Tarjeta titulo="Historial">
      {puedeAnotar && (
        <form
          className="mb-5 flex flex-col gap-2 sm:flex-row"
          onSubmit={(evento) => {
            evento.preventDefault();
            if (texto.trim() !== '') anotar.mutate();
          }}
        >
          <label className="min-w-0 flex-1">
            <span className="sr-only">Nota</span>
            <input
              type="text"
              value={texto}
              maxLength={500}
              onChange={(evento) => {
                setTexto(evento.target.value);
              }}
              placeholder="Anotar algo: «la próxima viene el 19»"
              className={CLASE_CONTROL}
            />
          </label>
          <button
            type="submit"
            disabled={anotar.isPending || texto.trim() === ''}
            className={CLASE_BOTON_PRIMARIO}
          >
            {anotar.isPending ? 'Guardando...' : 'Agregar nota'}
          </button>
        </form>
      )}
      {anotar.isError && <MensajeError>{anotar.error.message}</MensajeError>}

      {historial.isError && <MensajeError>{historial.error.message}</MensajeError>}
      {historial.isPending && (
        <p className="text-sm text-slate-600 dark:text-slate-400">Cargando el historial...</p>
      )}

      {historial.data !== undefined && (
        // Una línea de tiempo con <ol>: es una lista ORDENADA de verdad, y así
        // la lee un lector de pantalla.
        <ol className="relative space-y-4 border-l-2 border-slate-200 pl-5 dark:border-slate-700">
          {historial.data.eventos.map((evento, indice) => (
            <li key={`${evento.tipo}-${evento.fecha}-${String(indice)}`} className="relative">
              <span
                aria-hidden="true"
                className={`absolute top-1.5 -left-[1.6rem] h-3 w-3 rounded-full ring-4 ring-white dark:ring-slate-900 ${COLOR[evento.tipo]}`}
              />
              <p className="text-xs text-slate-600 dark:text-slate-400">
                {formatearFechaArgentina(new Date(evento.fecha))}
                {evento.usuario !== null && ` · ${evento.usuario.nombre}`}
              </p>
              <p className="font-semibold text-slate-900 dark:text-slate-50">
                {evento.recepcionId !== null && evento.tipo === 'ENTREGA' ? (
                  <Link to={`/recepciones/${evento.recepcionId}`} className="hover:underline">
                    {evento.titulo}
                  </Link>
                ) : (
                  evento.titulo
                )}
              </p>
              {evento.detalle !== null && (
                <p
                  className={`text-sm text-slate-700 dark:text-slate-300 ${
                    evento.tipo === 'NOTA' ? 'italic' : ''
                  }`}
                >
                  {evento.tipo === 'NOTA' ? `«${evento.detalle}»` : evento.detalle}
                </p>
              )}
            </li>
          ))}
        </ol>
      )}
    </Tarjeta>
  );
}
