import { formatearCantidad, type ProveedorResumen } from '@panaderia/shared';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router';

import { CLASE_BOTON_PRIMARIO, CLASE_CONTROL, MensajeError } from '../components/formulario';
import { useDebounce } from '../hooks/useDebounce';
import { usePuede } from '../hooks/useSesion';
import { listarProveedores } from '../lib/proveedores';

export function Proveedores() {
  const [busqueda, setBusqueda] = useState('');
  const [incluirInactivos, setIncluirInactivos] = useState(false);

  // El buscador no dispara un pedido por tecla.
  const busquedaRetrasada = useDebounce(busqueda);
  const puedeEditar = usePuede('proveedor:editar');

  const filtro = { busqueda: busquedaRetrasada || undefined, incluirInactivos };

  const proveedores = useQuery({
    queryKey: ['proveedores', filtro],
    queryFn: () => listarProveedores(filtro),
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="mr-auto">
          <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-50">Proveedores</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            {proveedores.isPending
              ? 'Cargando...'
              : `${String(proveedores.data?.length ?? 0)} en la lista`}
          </p>
        </div>
        {puedeEditar && (
          <Link
            to="/proveedores/nuevo"
            className={`${CLASE_BOTON_PRIMARIO} grid place-items-center`}
          >
            Nuevo proveedor
          </Link>
        )}
      </div>

      <div className="grid gap-3 rounded-2xl bg-white p-4 shadow-sm sm:grid-cols-[1fr_auto] dark:bg-slate-900">
        <input
          type="search"
          value={busqueda}
          onChange={(evento) => {
            setBusqueda(evento.target.value);
          }}
          placeholder="Buscar por nombre, razón social o CUIT"
          aria-label="Buscar proveedores"
          className={CLASE_CONTROL}
        />

        <label className="flex min-h-12 items-center gap-2 px-1 text-sm text-slate-700 dark:text-slate-200">
          <input
            type="checkbox"
            checked={incluirInactivos}
            onChange={(evento) => {
              setIncluirInactivos(evento.target.checked);
            }}
            className="size-5"
          />
          Incluir inactivos
        </label>
      </div>

      {proveedores.isError && <MensajeError>{proveedores.error.message}</MensajeError>}

      {proveedores.data?.length === 0 && (
        <p className="rounded-2xl bg-white p-8 text-center text-slate-500 shadow-sm dark:bg-slate-900 dark:text-slate-400">
          No hay proveedores que coincidan con la búsqueda.
        </p>
      )}

      {proveedores.data && proveedores.data.length > 0 && <Lista items={proveedores.data} />}
    </div>
  );
}

/** Cuánto tarda en entregar. Cero y "no sé" NO son lo mismo. */
function textoEntrega(dias: number | null): string {
  if (dias === null) return 'Entrega: sin dato';
  if (dias === 0) return 'Entrega en el día';
  if (dias === 1) return 'Entrega en 1 día';
  return `Entrega en ${String(dias)} días`;
}

function Lista({ items }: { items: readonly ProveedorResumen[] }) {
  return (
    <div className="overflow-hidden rounded-2xl bg-white shadow-sm dark:bg-slate-900">
      {/* En un celular una tabla no entra: tarjetas. De 768 px (tablet en
          vertical) para arriba, tabla. */}
      <ul className="divide-y divide-slate-100 md:hidden dark:divide-slate-800">
        {items.map((proveedor) => (
          <li key={proveedor.id}>
            <Link
              to={`/proveedores/${proveedor.id}`}
              className="block p-4 transition hover:bg-slate-50 dark:hover:bg-slate-800/60"
            >
              <div className="flex items-baseline gap-2">
                <span className="font-medium">{proveedor.nombre}</span>
                {!proveedor.activo && <EtiquetaInactivo />}
              </div>
              <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                {String(proveedor.cantidadInsumos)} insumos · {textoEntrega(proveedor.diasEntrega)}
                {proveedor.telefono !== null && ` · ${proveedor.telefono}`}
              </p>
            </Link>
          </li>
        ))}
      </ul>

      <table className="hidden w-full text-left md:table">
        <thead className="border-b border-slate-200 text-xs tracking-wide text-slate-500 uppercase dark:border-slate-700 dark:text-slate-400">
          <tr>
            <th className="px-4 py-3 font-semibold">Proveedor</th>
            <th className="px-4 py-3 font-semibold">Contacto</th>
            <th className="px-4 py-3 font-semibold">Entrega</th>
            <th className="px-4 py-3 font-semibold">Insumos</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
          {items.map((proveedor) => (
            <tr
              key={proveedor.id}
              className="transition hover:bg-slate-50 dark:hover:bg-slate-800/60"
            >
              <td className="px-4 py-3">
                <Link
                  to={`/proveedores/${proveedor.id}`}
                  className="flex min-h-10 flex-wrap items-center gap-2"
                >
                  <span className="font-medium">{proveedor.nombre}</span>
                  {proveedor.cuit !== null && (
                    <span className="font-mono text-xs text-slate-400">{proveedor.cuit}</span>
                  )}
                  {!proveedor.activo && <EtiquetaInactivo />}
                </Link>
              </td>
              <td className="px-4 py-3 text-slate-600 dark:text-slate-300">
                {proveedor.contactoNombre ?? proveedor.telefono ?? '—'}
              </td>
              <td className="px-4 py-3 text-slate-600 dark:text-slate-300">
                {textoEntrega(proveedor.diasEntrega)}
              </td>
              <td className="px-4 py-3 text-slate-600 dark:text-slate-300">
                {formatearCantidad(String(proveedor.cantidadInsumos), 0)}
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
