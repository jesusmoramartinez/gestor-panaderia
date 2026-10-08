import { formatearCantidad } from '@panaderia/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router';

import { textoCantidad } from '../components/compras';
import {
  CLASE_BOTON_PRIMARIO,
  CLASE_BOTON_SECUNDARIO,
  MensajeError,
} from '../components/formulario';
import { usePuede } from '../hooks/useSesion';
import { cambiarEstadoPlantilla, listarPlantillas } from '../lib/compras';

/**
 * Las plantillas de pedidos recurrentes ("Pedido semanal Molino").
 *
 * "Pedir" lleva a una orden NUEVA precargada con la plantilla: la plantilla
 * no se gasta ni se modifica, sirve otra vez la semana que viene.
 */
export function Plantillas() {
  const queryClient = useQueryClient();
  const puedePedir = usePuede('compra:pedir');
  const [verInactivas, setVerInactivas] = useState(false);

  const plantillas = useQuery({
    queryKey: ['plantillas', verInactivas],
    queryFn: () => listarPlantillas(verInactivas),
  });

  const cambiarEstado = useMutation({
    mutationFn: ({ id, activa }: { id: string; activa: boolean }) =>
      cambiarEstadoPlantilla(id, activa),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['plantillas'] });
    },
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="mr-auto">
          <Link
            to="/compras"
            className="text-sm text-corteza hover:underline dark:text-corteza-claro"
          >
            ← Volver a compras
          </Link>
          <h1 className="mt-1 text-2xl font-bold text-slate-900 dark:text-slate-50">
            Plantillas de pedido
          </h1>
          <p className="text-sm text-slate-600 dark:text-slate-400">
            Los pedidos que se repiten, listos para pedir con un toque.
          </p>
        </div>
        {puedePedir && (
          <Link
            to="/compras/plantillas/nueva"
            className={`${CLASE_BOTON_PRIMARIO} grid place-items-center`}
          >
            Nueva plantilla
          </Link>
        )}
      </div>

      <label className="flex min-h-12 items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={verInactivas}
          onChange={(evento) => {
            setVerInactivas(evento.target.checked);
          }}
          className="size-5"
        />
        Mostrar también las desactivadas
      </label>

      {plantillas.isError && <MensajeError>{plantillas.error.message}</MensajeError>}
      {cambiarEstado.isError && <MensajeError>{cambiarEstado.error.message}</MensajeError>}
      {plantillas.data?.length === 0 && (
        <p className="rounded-2xl bg-white p-8 text-center text-slate-600 shadow-sm dark:bg-slate-900 dark:text-slate-400">
          Todavía no hay plantillas. Se crean desde acá o con "Guardar como plantilla" al armar una
          orden.
        </p>
      )}

      <ul className="grid gap-3 md:grid-cols-2">
        {(plantillas.data ?? []).map((plantilla) => (
          <li
            key={plantilla.id}
            className={`rounded-2xl bg-white p-4 shadow-sm dark:bg-slate-900 ${
              plantilla.activa ? '' : 'opacity-60'
            }`}
          >
            <p className="font-semibold">{plantilla.nombre}</p>
            <p className="text-sm text-slate-600 dark:text-slate-400">
              {plantilla.proveedor.nombre} · para {plantilla.sucursal.nombre}
              {!plantilla.activa && ' · desactivada'}
            </p>
            <ul className="mt-2 space-y-0.5 text-sm">
              {plantilla.lineas.map((linea) => (
                <li key={linea.id}>
                  {linea.insumo.nombre}:{' '}
                  {textoCantidad(
                    linea.cantidad,
                    linea.presentacion,
                    linea.insumo.unidadBaseCodigo,
                    formatearCantidad,
                  )}
                </li>
              ))}
            </ul>

            {puedePedir && (
              <div className="mt-3 flex flex-wrap gap-2">
                {plantilla.activa && (
                  <Link
                    to={`/compras/nueva?plantilla=${plantilla.id}`}
                    className={`${CLASE_BOTON_PRIMARIO} grid place-items-center`}
                  >
                    Pedir
                  </Link>
                )}
                <Link
                  to={`/compras/plantillas/${plantilla.id}`}
                  className={`${CLASE_BOTON_SECUNDARIO} grid place-items-center`}
                >
                  Editar
                </Link>
                <button
                  type="button"
                  disabled={cambiarEstado.isPending}
                  onClick={() => {
                    cambiarEstado.mutate({ id: plantilla.id, activa: !plantilla.activa });
                  }}
                  className={CLASE_BOTON_SECUNDARIO}
                >
                  {plantilla.activa ? 'Desactivar' : 'Reactivar'}
                </button>
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
