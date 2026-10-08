import { formatearCantidad, type InsumoResumen } from '@panaderia/shared';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router';

import {
  CLASE_BOTON_PRIMARIO,
  CLASE_BOTON_SECUNDARIO,
  CLASE_CONTROL,
  MensajeError,
} from '../components/formulario';
import { useDebounce } from '../hooks/useDebounce';
import { usePuede } from '../hooks/useSesion';
import { listarCategorias, listarInsumos } from '../lib/catalogo';

const POR_PAGINA = 20;

export function Insumos() {
  const [busqueda, setBusqueda] = useState('');
  const [categoriaId, setCategoriaId] = useState('');
  const [incluirInactivos, setIncluirInactivos] = useState(false);
  const [pagina, setPagina] = useState(0);

  // El buscador no dispara un pedido por tecla.
  const busquedaRetrasada = useDebounce(busqueda);
  const puedeEditar = usePuede('insumo:editar');

  const categorias = useQuery({ queryKey: ['categorias'], queryFn: listarCategorias });

  const filtro = {
    busqueda: busquedaRetrasada || undefined,
    categoriaId: categoriaId || undefined,
    incluirInactivos,
    limite: POR_PAGINA,
    desplazamiento: pagina * POR_PAGINA,
  };

  const insumos = useQuery({
    // El filtro forma parte de la CLAVE del caché: cada combinación se guarda
    // por separado, así volver a un filtro anterior es instantáneo.
    queryKey: ['insumos', filtro],
    queryFn: () => listarInsumos(filtro),
  });

  function cambiarFiltro(accion: () => void): void {
    accion();
    setPagina(0); // cualquier cambio de filtro vuelve a la primera página
  }

  const total = insumos.data?.total ?? 0;
  const ultimaPagina = Math.max(0, Math.ceil(total / POR_PAGINA) - 1);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="mr-auto">
          <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-50">Insumos</h1>
          <p className="text-sm text-slate-600 dark:text-slate-400">
            {insumos.isPending ? 'Cargando...' : `${String(total)} en el catálogo`}
          </p>
        </div>
        {puedeEditar && (
          <Link to="/insumos/nuevo" className={`${CLASE_BOTON_PRIMARIO} grid place-items-center`}>
            Nuevo insumo
          </Link>
        )}
      </div>

      <div className="grid gap-3 rounded-2xl bg-white p-4 shadow-sm sm:grid-cols-[2fr_1fr_auto] dark:bg-slate-900">
        <input
          type="search"
          value={busqueda}
          onChange={(evento) => {
            cambiarFiltro(() => {
              setBusqueda(evento.target.value);
            });
          }}
          placeholder="Buscar por nombre o código"
          aria-label="Buscar insumos"
          className={CLASE_CONTROL}
        />

        <select
          value={categoriaId}
          onChange={(evento) => {
            cambiarFiltro(() => {
              setCategoriaId(evento.target.value);
            });
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
            checked={incluirInactivos}
            onChange={(evento) => {
              cambiarFiltro(() => {
                setIncluirInactivos(evento.target.checked);
              });
            }}
            className="size-5"
          />
          Incluir inactivos
        </label>
      </div>

      {insumos.isError && <MensajeError>{insumos.error.message}</MensajeError>}

      {insumos.data && insumos.data.items.length === 0 && (
        <p className="rounded-2xl bg-white p-8 text-center text-slate-600 dark:text-slate-400 shadow-sm dark:bg-slate-900">
          No hay insumos que coincidan con la búsqueda.
        </p>
      )}

      {insumos.data && insumos.data.items.length > 0 && <ListaInsumos items={insumos.data.items} />}

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
    </div>
  );
}

function ListaInsumos({ items }: { items: readonly InsumoResumen[] }) {
  return (
    <div className="overflow-hidden rounded-2xl bg-white shadow-sm dark:bg-slate-900">
      {/* En pantallas angostas (un celular) una tabla no entra: mostramos
          tarjetas. De 768 px para arriba (una tablet en vertical) sí. */}
      <ul className="divide-y divide-slate-100 md:hidden dark:divide-slate-800">
        {items.map((insumo) => (
          <li key={insumo.id}>
            <Link
              to={`/insumos/${insumo.id}`}
              className="block p-4 transition hover:bg-slate-50 dark:hover:bg-slate-800/60"
            >
              <div className="flex items-baseline gap-2">
                <span className="font-medium">{insumo.nombre}</span>
                {!insumo.activo && <EtiquetaInactivo />}
              </div>
              <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
                {insumo.categoria?.nombre ?? 'Sin categoría'} · se lleva en{' '}
                {insumo.unidadBase.codigo} · {String(insumo.cantidadPresentaciones)} presentaciones
              </p>
            </Link>
          </li>
        ))}
      </ul>

      <table className="hidden w-full text-left md:table">
        <thead className="border-b border-slate-200 text-xs tracking-wide text-slate-600 dark:text-slate-400 uppercase dark:border-slate-700">
          <tr>
            <th className="px-4 py-3 font-semibold">Insumo</th>
            <th className="px-4 py-3 font-semibold">Categoría</th>
            <th className="px-4 py-3 font-semibold">Se lleva en</th>
            <th className="px-4 py-3 font-semibold">Presentaciones</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
          {items.map((insumo) => (
            <tr key={insumo.id} className="transition hover:bg-slate-50 dark:hover:bg-slate-800/60">
              {/* min-h-14 en la celda: filas altas, cómodas de tocar. */}
              <td className="px-4 py-3">
                <Link to={`/insumos/${insumo.id}`} className="flex min-h-10 items-center gap-2">
                  <span className="font-medium">{insumo.nombre}</span>
                  {insumo.codigo !== null && (
                    <span className="font-mono text-xs text-slate-600 dark:text-slate-400">
                      {insumo.codigo}
                    </span>
                  )}
                  {!insumo.activo && <EtiquetaInactivo />}
                </Link>
              </td>
              <td className="px-4 py-3 text-slate-600 dark:text-slate-300">
                {insumo.categoria?.nombre ?? '—'}
              </td>
              <td className="px-4 py-3 text-slate-600 dark:text-slate-300">
                {insumo.unidadBase.nombre} ({insumo.unidadBase.codigo})
              </td>
              <td className="px-4 py-3 text-slate-600 dark:text-slate-300">
                {formatearCantidad(String(insumo.cantidadPresentaciones), 0)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function EtiquetaInactivo() {
  return (
    <span className="rounded-full bg-slate-200 px-2 py-0.5 text-xs font-semibold text-slate-600 dark:bg-slate-700 dark:text-slate-300">
      inactivo
    </span>
  );
}
