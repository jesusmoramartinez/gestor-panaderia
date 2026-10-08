import { formatearCantidad, type FilaStock } from '@panaderia/shared';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router';

import { Saldo, Semaforo } from '../components/stock';
import {
  CLASE_BOTON_PRIMARIO,
  CLASE_BOTON_SECUNDARIO,
  CLASE_CONTROL,
  MensajeError,
} from '../components/formulario';
import { useSucursalActiva } from '../components/SucursalActiva';
import { useDebounce } from '../hooks/useDebounce';
import { usePuede } from '../hooks/useSesion';
import { listarCategorias } from '../lib/catalogo';
import { obtenerStock } from '../lib/stock';

export function Stock() {
  const { activa } = useSucursalActiva();
  const [busqueda, setBusqueda] = useState('');
  const [categoriaId, setCategoriaId] = useState('');
  const [soloAlertas, setSoloAlertas] = useState(false);

  const busquedaRetrasada = useDebounce(busqueda);
  const puedeConsumo = usePuede('consumo:crear');
  const puedeMerma = usePuede('merma:crear');
  const puedeInicial = usePuede('stock:cargar-inicial');

  const categorias = useQuery({ queryKey: ['categorias'], queryFn: listarCategorias });

  const filtro = {
    sucursalId: activa?.id ?? '',
    busqueda: busquedaRetrasada || undefined,
    categoriaId: categoriaId || undefined,
    soloAlertas,
  };

  const stock = useQuery({
    queryKey: ['stock', filtro],
    queryFn: () => obtenerStock(filtro),
    // Sin sucursal elegida no hay nada que pedir: el stock es DE una sucursal.
    enabled: activa !== null,
  });

  if (activa === null) {
    return (
      <MensajeError>
        No tenés ninguna sucursal asignada, así que no hay stock que mostrar. Pedile al dueño que te
        habilite una.
      </MensajeError>
    );
  }

  const resumen = stock.data?.resumen;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="mr-auto">
          <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-50">Stock</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            {activa.nombre}
            {stock.isPending ? ' · cargando...' : ''}
          </p>
        </div>
        {puedeConsumo && (
          <Link to="/stock/consumo" className={`${CLASE_BOTON_PRIMARIO} grid place-items-center`}>
            Cargar consumo
          </Link>
        )}
        {puedeMerma && (
          <Link to="/stock/merma" className={`${CLASE_BOTON_SECUNDARIO} grid place-items-center`}>
            Cargar merma
          </Link>
        )}
        {puedeInicial && (
          <Link
            to="/stock/saldo-inicial"
            className={`${CLASE_BOTON_SECUNDARIO} grid place-items-center`}
          >
            Saldo inicial
          </Link>
        )}
      </div>

      {resumen && (
        <div className="grid grid-cols-3 gap-3">
          <Resumen
            etiqueta="Sin stock"
            cantidad={resumen.critico}
            color="text-red-700 dark:text-red-400"
          />
          <Resumen
            etiqueta="Bajo el mínimo"
            cantidad={resumen.bajo}
            color="text-amber-700 dark:text-amber-400"
          />
          <Resumen
            etiqueta="En orden"
            cantidad={resumen.ok}
            color="text-emerald-700 dark:text-emerald-400"
          />
        </div>
      )}

      <div className="grid gap-3 rounded-2xl bg-white p-4 shadow-sm sm:grid-cols-[2fr_1fr_auto] dark:bg-slate-900">
        <input
          type="search"
          value={busqueda}
          onChange={(evento) => {
            setBusqueda(evento.target.value);
          }}
          placeholder="Buscar por nombre o código"
          aria-label="Buscar insumos"
          className={CLASE_CONTROL}
        />

        <select
          value={categoriaId}
          onChange={(evento) => {
            setCategoriaId(evento.target.value);
          }}
          aria-label="Filtrar por categoría"
          className={CLASE_CONTROL}
        >
          <option value="">Todas las categorías</option>
          {(categorias.data ?? []).map((categoria) => (
            <option key={categoria.id} value={categoria.id}>
              {categoria.nombre}
            </option>
          ))}
        </select>

        <label className="flex min-h-12 items-center gap-2 px-1 text-sm text-slate-700 dark:text-slate-200">
          <input
            type="checkbox"
            checked={soloAlertas}
            onChange={(evento) => {
              setSoloAlertas(evento.target.checked);
            }}
            className="size-5"
          />
          Solo lo que falta
        </label>
      </div>

      {stock.isError && <MensajeError>{stock.error.message}</MensajeError>}

      {stock.data?.items.length === 0 && (
        <p className="rounded-2xl bg-white p-8 text-center text-slate-500 shadow-sm dark:bg-slate-900 dark:text-slate-400">
          {soloAlertas
            ? 'No hay nada por debajo del mínimo. 👌'
            : 'No hay insumos que coincidan con la búsqueda.'}
        </p>
      )}

      {stock.data && stock.data.items.length > 0 && <Tabla items={stock.data.items} />}
    </div>
  );
}

function Resumen({
  etiqueta,
  cantidad,
  color,
}: {
  etiqueta: string;
  cantidad: number;
  color: string;
}) {
  return (
    <div className="rounded-2xl bg-white p-4 text-center shadow-sm dark:bg-slate-900">
      <p className={`text-2xl font-bold tabular-nums ${color}`}>{String(cantidad)}</p>
      <p className="text-xs text-slate-500 dark:text-slate-400">{etiqueta}</p>
    </div>
  );
}

function Tabla({ items }: { items: readonly FilaStock[] }) {
  return (
    <div className="overflow-hidden rounded-2xl bg-white shadow-sm dark:bg-slate-900">
      {/* En un celular la tabla no entra: tarjetas. De 768 px (tablet en
          vertical) para arriba, tabla. */}
      <ul className="divide-y divide-slate-100 md:hidden dark:divide-slate-800">
        {items.map((item) => (
          <li key={item.insumoId}>
            <Link
              to={`/stock/${item.insumoId}`}
              className="block p-4 transition hover:bg-slate-50 dark:hover:bg-slate-800/60"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium">{item.nombre}</span>
                <Saldo valor={item.saldo} unidad={item.unidadBaseCodigo} />
              </div>
              <div className="mt-1 flex items-center gap-2 text-sm text-slate-500 dark:text-slate-400">
                <Semaforo estado={item.estado} negativo={item.saldo.startsWith('-')} />
                <span>
                  mínimo {formatearCantidad(item.stockMinimo)} {item.unidadBaseCodigo}
                </span>
              </div>
            </Link>
          </li>
        ))}
      </ul>

      <table className="hidden w-full text-left md:table">
        <thead className="border-b border-slate-200 text-xs tracking-wide text-slate-500 uppercase dark:border-slate-700 dark:text-slate-400">
          <tr>
            <th className="px-4 py-3 font-semibold">Insumo</th>
            <th className="px-4 py-3 font-semibold">Categoría</th>
            <th className="px-4 py-3 text-right font-semibold">Stock</th>
            <th className="px-4 py-3 text-right font-semibold">Mínimo</th>
            <th className="px-4 py-3 font-semibold">Estado</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
          {items.map((item) => (
            <tr
              key={item.insumoId}
              className="transition hover:bg-slate-50 dark:hover:bg-slate-800/60"
            >
              <td className="px-4 py-3">
                <Link
                  to={`/stock/${item.insumoId}`}
                  className="flex min-h-10 flex-wrap items-center gap-2"
                >
                  <span className="font-medium">{item.nombre}</span>
                  {item.ubicacion !== null && (
                    <span className="text-xs text-slate-400">{item.ubicacion}</span>
                  )}
                </Link>
              </td>
              <td className="px-4 py-3 text-slate-600 dark:text-slate-300">
                {item.categoriaNombre ?? '—'}
              </td>
              <td className="px-4 py-3 text-right">
                <Saldo valor={item.saldo} unidad={item.unidadBaseCodigo} />
              </td>
              <td className="px-4 py-3 text-right text-slate-600 tabular-nums dark:text-slate-300">
                {formatearCantidad(item.stockMinimo)} {item.unidadBaseCodigo}
              </td>
              <td className="px-4 py-3">
                <Semaforo estado={item.estado} negativo={item.saldo.startsWith('-')} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
