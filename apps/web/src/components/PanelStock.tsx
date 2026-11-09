import { aDecimal, type FilaStock, formatearCantidad } from '@panaderia/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router';

import { usePuede } from '../hooks/useSesion';
import { agotarStock, cargarConsumo, obtenerStock } from '../lib/stock';
import { DialogoConfirmacion } from './Dialogo';
import { CLASE_CONTROL, MensajeError } from './formulario';
import { CuadroIcono } from './iconosInsumo';
import { Saldo, Semaforo } from './stock';
import { useSucursalActiva } from './SucursalActiva';

// Botones de fila: más bajos que los de un formulario (40 px, que siguen
// siendo cómodos de tocar) para que una lista larga no sea toda botones.
const CLASE_BOTON_FILA =
  'min-h-10 rounded-lg px-3 text-sm font-medium transition disabled:opacity-50';

/**
 * EL STOCK, EN EL INICIO: lo que hay en la sucursal elegida, y dos botones
 * por insumo para descontar sin ir a otra pantalla:
 *
 *   - "Usé…": se escribe cuánto se usó y se carga un CONSUMO de eso.
 *   - "Se terminó": se descuenta TODO lo que queda, también como consumo.
 *     La cantidad la calcula el servidor con el saldo de ese momento (ver
 *     `agotar` en la API), así que no importa si la pantalla quedó vieja.
 *
 * Solo muestra lo que TIENE (saldo distinto de cero): con un catálogo de 100
 * insumos, la lista de todos sería casi toda ceros.
 */
export function PanelStock() {
  const { sucursales, activa, cambiar } = useSucursalActiva();
  const puedeDescontar = usePuede('consumo:crear');
  const [busqueda, setBusqueda] = useState('');

  const stock = useQuery({
    queryKey: ['stock', { sucursalId: activa?.id ?? '', soloAlertas: false }],
    queryFn: () => obtenerStock({ sucursalId: activa?.id ?? '', soloAlertas: false }),
    enabled: activa !== null,
  });

  if (activa === null) {
    return <MensajeError>No tenés ninguna sucursal asignada.</MensajeError>;
  }

  const texto = busqueda.trim().toLowerCase();
  const conStock = (stock.data?.items ?? []).filter(
    (fila) =>
      !aDecimal(fila.saldo).isZero() && (texto === '' || fila.nombre.toLowerCase().includes(texto)),
  );

  return (
    <section aria-labelledby="titulo-stock" className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <div className="mr-auto">
          <h2 id="titulo-stock" className="text-2xl font-bold text-slate-900 dark:text-slate-50">
            Stock
          </h2>
          <p className="text-sm text-slate-600 dark:text-slate-400">Lo que hay en el depósito.</p>
        </div>
        {/* Las sucursales como botones de un interruptor: se ve cuál está
            elegida sin abrir nada. Con una sola sucursal no hace falta. */}
        {sucursales.length > 1 && (
          <div
            role="group"
            aria-label="Sucursal"
            className="flex rounded-xl bg-slate-100 p-1 dark:bg-slate-800"
          >
            {sucursales.map((sucursal) => (
              <button
                key={sucursal.id}
                type="button"
                aria-pressed={sucursal.id === activa.id}
                onClick={() => {
                  cambiar(sucursal.id);
                }}
                className={`min-h-10 rounded-lg px-3 text-sm font-medium transition ${
                  sucursal.id === activa.id
                    ? 'bg-white text-corteza shadow-sm dark:bg-slate-900 dark:text-corteza-claro'
                    : 'text-slate-600 hover:text-slate-900 dark:text-slate-300'
                }`}
              >
                {sucursal.nombre}
              </button>
            ))}
          </div>
        )}
      </div>

      <input
        type="search"
        value={busqueda}
        onChange={(evento) => {
          setBusqueda(evento.target.value);
        }}
        placeholder="Buscar en el stock..."
        aria-label="Buscar en el stock"
        className={CLASE_CONTROL}
      />

      {stock.isError && <MensajeError>{stock.error.message}</MensajeError>}
      {stock.isPending && <p className="text-sm text-slate-600 dark:text-slate-400">Cargando...</p>}

      {stock.data && conStock.length === 0 && (
        <p className="rounded-2xl bg-white p-6 text-center text-slate-600 shadow-sm dark:bg-slate-900 dark:text-slate-400">
          {texto === ''
            ? `No hay stock en ${activa.nombre}. Entra con las entregas de las compras.`
            : 'Ningún insumo con stock coincide con la búsqueda.'}
        </p>
      )}

      {conStock.length > 0 && (
        <ul className="divide-y divide-slate-100 overflow-hidden rounded-2xl bg-white shadow-sm dark:divide-slate-800 dark:bg-slate-900">
          {conStock.map((fila) => (
            <FilaInsumo
              key={fila.insumoId}
              fila={fila}
              sucursalId={activa.id}
              puedeDescontar={puedeDescontar}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

function FilaInsumo({
  fila,
  sucursalId,
  puedeDescontar,
}: {
  fila: FilaStock;
  sucursalId: string;
  puedeDescontar: boolean;
}) {
  const queryClient = useQueryClient();
  const [usando, setUsando] = useState(false);
  const [cantidad, setCantidad] = useState('');
  const [confirmarFin, setConfirmarFin] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Después de descontar, todo lo que muestra stock quedó viejo.
  async function refrescar(): Promise<void> {
    await queryClient.invalidateQueries({ queryKey: ['stock'] });
  }

  const usar = useMutation({
    mutationFn: () =>
      cargarConsumo({
        sucursalId,
        fecha: null,
        notas: null,
        motivoId: null,
        forzar: false,
        lineas: [{ insumoId: fila.insumoId, cantidad, unidadId: null, notas: null }],
      }),
    onSuccess: async () => {
      setUsando(false);
      setCantidad('');
      setError(null);
      await refrescar();
    },
    onError: (e) => {
      setError(e.message);
    },
  });

  const terminar = useMutation({
    mutationFn: () =>
      agotarStock({ sucursalId, insumoId: fila.insumoId, fecha: null, notas: null }),
    onSuccess: async () => {
      setConfirmarFin(false);
      setError(null);
      await refrescar();
    },
    onError: (e) => {
      setConfirmarFin(false);
      setError(e.message);
    },
  });

  const positivo = aDecimal(fila.saldo).greaterThan(0);

  return (
    <li className="p-3">
      <div className="flex flex-wrap items-center gap-3">
        <CuadroIcono icono={fila.icono ?? '📦'} />
        {/* basis-40: si el nombre y los botones no entran juntos (celular), los
            botones bajan a otra línea en vez de cortar el nombre. */}
        <div className="min-w-0 flex-1 basis-40">
          <Link
            to={`/stock/${fila.insumoId}`}
            className="block truncate font-medium text-slate-900 hover:underline dark:text-slate-50"
          >
            {fila.nombre}
          </Link>
          <span className="flex items-center gap-2 text-sm">
            <Saldo valor={fila.saldo} unidad={fila.unidadBaseCodigo} />
            {/* El semáforo solo dice algo si el insumo tiene un mínimo. */}
            {!aDecimal(fila.stockMinimo).isZero() && <Semaforo estado={fila.estado} />}
          </span>
        </div>
        {puedeDescontar && positivo && !usando && (
          <div className="ml-auto flex gap-2">
            <button
              type="button"
              onClick={() => {
                setUsando(true);
                setError(null);
              }}
              className={`${CLASE_BOTON_FILA} border border-slate-300 text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800`}
            >
              Usé…
            </button>
            <button
              type="button"
              onClick={() => {
                setConfirmarFin(true);
              }}
              className={`${CLASE_BOTON_FILA} text-red-700 hover:bg-red-50 dark:text-red-300 dark:hover:bg-red-950/40`}
            >
              Se terminó
            </button>
          </div>
        )}
      </div>

      {usando && (
        <form
          onSubmit={(evento) => {
            evento.preventDefault();
            usar.mutate();
          }}
          className="mt-3 flex flex-wrap items-center gap-2 pl-13"
        >
          <label className="flex items-center gap-2">
            <span className="text-sm text-slate-700 dark:text-slate-200">Usé</span>
            <input
              type="text"
              inputMode="decimal"
              autoFocus
              value={cantidad}
              onChange={(evento) => {
                setCantidad(evento.target.value);
              }}
              aria-label={`Cuánto usaste de ${fila.nombre}`}
              placeholder="0"
              className={`${CLASE_CONTROL} min-h-10 w-28`}
            />
            <span className="text-sm text-slate-700 dark:text-slate-200">
              {fila.unidadBaseCodigo}
            </span>
          </label>
          <button
            type="submit"
            disabled={usar.isPending || cantidad.trim() === ''}
            className={`${CLASE_BOTON_FILA} bg-corteza px-4 text-white`}
          >
            {usar.isPending ? 'Descontando...' : 'Descontar'}
          </button>
          <button
            type="button"
            onClick={() => {
              setUsando(false);
              setCantidad('');
              setError(null);
            }}
            className={`${CLASE_BOTON_FILA} text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800`}
          >
            Cancelar
          </button>
        </form>
      )}

      {error !== null && (
        <p role="alert" className="mt-2 pl-13 text-sm text-red-700 dark:text-red-400">
          {error}
        </p>
      )}

      <DialogoConfirmacion
        abierto={confirmarFin}
        titulo={`¿Se terminó ${fila.nombre}?`}
        textoConfirmar="Sí, se terminó"
        trabajando={terminar.isPending}
        onConfirmar={() => {
          terminar.mutate();
        }}
        onCancelar={() => {
          setConfirmarFin(false);
        }}
      >
        Se descuenta como consumo todo lo que queda ({formatearCantidad(fila.saldo)}{' '}
        {fila.unidadBaseCodigo}) y el stock queda en cero.
      </DialogoConfirmacion>
    </li>
  );
}
