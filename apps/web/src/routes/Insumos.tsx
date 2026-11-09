import { formatearCantidad, type Categoria, type InsumoResumen } from '@panaderia/shared';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router';

import {
  CLASE_BOTON_PRIMARIO,
  CLASE_BOTON_SECUNDARIO,
  CLASE_CONTROL,
  MensajeError,
} from '../components/formulario';
import { CuadroIcono, iconoDe } from '../components/iconosInsumo';
import { ModalNuevoInsumo } from '../components/ModalNuevoInsumo';
import { useDebounce } from '../hooks/useDebounce';
import { usePuede } from '../hooks/useSesion';
import { listarCategorias, listarInsumos } from '../lib/catalogo';

const POR_PAGINA = 20;

/**
 * La lista de insumos. `nuevo`: la URL es /insumos/nuevo y el modal de
 * "Nuevo insumo" está abierto encima de la lista. Que el modal tenga su URL
 * hace que el botón "atrás" del navegador lo cierre, como se espera.
 */
export function Insumos({ nuevo = false }: { nuevo?: boolean }) {
  const navegar = useNavigate();
  const [busqueda, setBusqueda] = useState('');
  // Las categorías marcadas en la barra de arriba. Ninguna = todas.
  const [categoriaIds, setCategoriaIds] = useState<string[]>([]);
  const [incluirInactivos, setIncluirInactivos] = useState(false);
  const [pagina, setPagina] = useState(0);

  // El buscador no dispara un pedido por tecla.
  const busquedaRetrasada = useDebounce(busqueda);
  const puedeEditar = usePuede('insumo:editar');

  const categorias = useQuery({ queryKey: ['categorias'], queryFn: listarCategorias });

  const filtro = {
    busqueda: busquedaRetrasada || undefined,
    categoriaIds,
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

        <input
          type="search"
          value={busqueda}
          onChange={(evento) => {
            cambiarFiltro(() => {
              setBusqueda(evento.target.value);
            });
          }}
          placeholder="Buscar..."
          aria-label="Buscar insumos por nombre o código"
          className={`${CLASE_CONTROL} sm:w-56`}
        />
        <label className="flex min-h-12 items-center gap-2 text-sm text-slate-700 dark:text-slate-200">
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
          Inactivos
        </label>
        {puedeEditar && (
          <Link to="/insumos/nuevo" className={`${CLASE_BOTON_PRIMARIO} grid place-items-center`}>
            Nuevo insumo
          </Link>
        )}
      </div>

      <BarraCategorias
        categorias={categorias.data ?? []}
        elegidas={categoriaIds}
        onCambiar={(ids) => {
          cambiarFiltro(() => {
            setCategoriaIds(ids);
          });
        }}
      />

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

      <ModalNuevoInsumo
        abierto={nuevo && puedeEditar}
        onCerrar={() => {
          void navegar('/insumos', { replace: true });
        }}
      />
    </div>
  );
}

/**
 * Las categorías como las historias de Instagram o los estados de WhatsApp:
 * una fila de círculos con su ícono y el nombre abajo, que se desliza de
 * costado. Se marcan una o varias; ninguna marcada es "todas".
 *
 * Cada círculo es un <button> con `aria-pressed`: así el lector de pantalla
 * dice "Harinas, botón, presionado", que es exactamente lo que es (un
 * interruptor), y Playwright lo puede verificar.
 */
function BarraCategorias({
  categorias,
  elegidas,
  onCambiar,
}: {
  categorias: readonly Categoria[];
  elegidas: readonly string[];
  onCambiar: (ids: string[]) => void;
}) {
  function alternar(id: string): void {
    onCambiar(elegidas.includes(id) ? elegidas.filter((e) => e !== id) : [...elegidas, id]);
  }

  // En la PC, la rueda del mouse (que va para abajo) desliza la barra de
  // costado, como se espera de una fila así. En el celular se desliza con el
  // dedo y esto no interviene.
  //
  // Va con addEventListener y no con onWheel de React porque hay que llamar a
  // preventDefault (si no, además se movería la página), y React registra la
  // rueda como "pasiva": un listener pasivo promete no frenar el scroll.
  const barra = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const elemento = barra.current;
    if (!elemento) return;
    const alGirar = (evento: WheelEvent): void => {
      const sobraLugar = elemento.scrollWidth <= elemento.clientWidth;
      if (sobraLugar || Math.abs(evento.deltaY) <= Math.abs(evento.deltaX)) return;
      evento.preventDefault();
      elemento.scrollLeft += evento.deltaY;
    };
    elemento.addEventListener('wheel', alGirar, { passive: false });
    return () => {
      elemento.removeEventListener('wheel', alGirar);
    };
  }, []);

  return (
    <div
      role="group"
      aria-label="Filtrar por categoría"
      ref={barra}
      className="-mx-1 flex gap-1 overflow-x-auto px-1 pt-1.5 pb-2"
    >
      <Burbuja
        icono="🗂️"
        nombre="Todas"
        marcada={elegidas.length === 0}
        onClick={() => {
          onCambiar([]);
        }}
      />
      {categorias.map((categoria) => (
        <Burbuja
          key={categoria.id}
          icono={categoria.icono ?? '📦'}
          nombre={categoria.nombre}
          marcada={elegidas.includes(categoria.id)}
          onClick={() => {
            alternar(categoria.id);
          }}
        />
      ))}
    </div>
  );
}

function Burbuja({
  icono,
  nombre,
  marcada,
  onClick,
}: {
  icono: string;
  nombre: string;
  marcada: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={marcada}
      onClick={onClick}
      title={nombre}
      className="group flex w-20 shrink-0 flex-col items-center gap-1.5 rounded-xl py-1"
    >
      {/* El aro de color es lo que dice "marcada", como el aro de una
          historia sin ver. Además el fondo cambia: no depende solo del color. */}
      <span
        className={`grid size-14 place-items-center rounded-full text-[1.7rem] transition ${
          marcada
            ? 'bg-amber-100 ring-3 ring-corteza ring-offset-2 ring-offset-masa dark:bg-slate-700 dark:ring-corteza-claro dark:ring-offset-horno'
            : 'bg-white ring-1 ring-slate-200 group-hover:ring-slate-400 dark:bg-slate-900 dark:ring-slate-700'
        }`}
      >
        <span aria-hidden="true">{icono}</span>
      </span>
      <span
        // Hasta dos renglones: "Semillas y frutos secos" entra entero.
        className={`line-clamp-2 w-full text-center text-xs leading-tight ${
          marcada
            ? 'font-semibold text-corteza dark:text-corteza-claro'
            : 'text-slate-700 dark:text-slate-300'
        }`}
      >
        {nombre}
      </span>
    </button>
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
              <div className="flex items-center gap-3">
                <CuadroIcono icono={iconoDe(insumo)} />
                <div className="min-w-0">
                  <div className="flex items-baseline gap-2">
                    <span className="font-medium">{insumo.nombre}</span>
                    {!insumo.activo && <EtiquetaInactivo />}
                  </div>
                  <p className="mt-0.5 text-sm text-slate-600 dark:text-slate-400">
                    {insumo.categoria?.nombre ?? 'Sin categoría'} · se lleva en{' '}
                    {insumo.unidadBase.codigo} · {String(insumo.cantidadPresentaciones)}{' '}
                    presentaciones
                  </p>
                </div>
              </div>
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
                <Link to={`/insumos/${insumo.id}`} className="flex min-h-10 items-center gap-3">
                  <CuadroIcono icono={iconoDe(insumo)} />
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
