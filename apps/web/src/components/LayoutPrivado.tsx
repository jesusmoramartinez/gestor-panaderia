import { formatearFechaArgentina, type UsuarioSesion } from '@panaderia/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { NavLink, Outlet, useNavigate } from 'react-router';

import { usePuede } from '../hooks/useSesion';
import { cerrarSesion } from '../lib/sesion';
import { ProveedorSucursalActiva, useSucursalActiva } from './SucursalActiva';
import { SelectorTema } from './Tema';

const ETIQUETA_ROL: Record<UsuarioSesion['rol'], string> = {
  DUENO: 'Dueño',
  ENCARGADO: 'Encargado',
  EMPLEADO: 'Empleado',
};

function SelectorSucursal() {
  const { sucursales, activa, cambiar } = useSucursalActiva();

  if (sucursales.length === 0) {
    return (
      <span className="rounded-lg bg-amber-100 px-3 py-2 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-200">
        Sin sucursales asignadas
      </span>
    );
  }

  // Una sola sucursal: no tiene sentido un selector, se muestra el nombre.
  if (sucursales.length === 1) {
    return (
      <span className="rounded-lg bg-slate-100 px-3 py-2 text-sm font-medium dark:bg-slate-800">
        {activa?.nombre}
      </span>
    );
  }

  return (
    <label className="flex items-center gap-2 text-sm">
      <span className="sr-only">Sucursal</span>
      {/* min-h-11 = alto cómodo para tocar con el dedo en la tablet */}
      <select
        value={activa?.id ?? ''}
        onChange={(evento) => {
          cambiar(evento.target.value);
        }}
        className="min-h-11 rounded-lg border border-slate-300 bg-white px-3 font-medium dark:border-slate-600 dark:bg-slate-800"
      >
        {sucursales.map((sucursal) => (
          <option key={sucursal.id} value={sucursal.id}>
            {sucursal.nombre}
            {sucursal.esCentral ? ' (central)' : ''}
          </option>
        ))}
      </select>
    </label>
  );
}

export function LayoutPrivado({ sesion }: { sesion: UsuarioSesion }) {
  const navegar = useNavigate();
  const queryClient = useQueryClient();
  // El empleado no ve proveedores (ahí hay precios), así que tampoco tiene
  // sentido mostrarle la pestaña: haría clic y se comería un 403. Esto es
  // comodidad, no seguridad: la defensa real está en la API.
  const veProveedores = usePuede('proveedor:ver');
  const veCompras = usePuede('compra:ver');

  const salir = useMutation({
    mutationFn: cerrarSesion,
    onSuccess: () => {
      // Al salir se borra TODO el caché: si no, el usuario siguiente podría
      // ver por un instante los datos del anterior en la misma computadora.
      queryClient.clear();
      void navegar('/login', { replace: true });
    },
  });

  return (
    <ProveedorSucursalActiva sucursales={sesion.sucursales}>
      <div className="min-h-dvh bg-masa dark:bg-horno">
        <header className="border-b border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900">
          <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-3 p-4">
            <div className="mr-auto">
              <p className="font-bold text-slate-900 dark:text-slate-50">{sesion.empresa.nombre}</p>
              <p className="text-sm text-slate-600 dark:text-slate-400">
                {sesion.nombre} · {ETIQUETA_ROL[sesion.rol]}
              </p>
            </div>

            <SelectorSucursal />
            <SelectorTema />

            <button
              type="button"
              onClick={() => {
                salir.mutate();
              }}
              disabled={salir.isPending}
              className="min-h-11 rounded-lg border border-slate-300 px-4 font-medium text-slate-700 transition hover:bg-slate-50 disabled:opacity-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800"
            >
              {salir.isPending ? 'Saliendo...' : 'Salir'}
            </button>
          </div>
        </header>

        <nav className="border-b border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900">
          {/* overflow-x-auto: con cinco pestañas, en un celular no entran
              todas; se desplazan de costado en lugar de romper la página. */}
          <ul className="mx-auto flex max-w-5xl gap-1 overflow-x-auto px-2">
            {[
              { a: '/', texto: 'Inicio' },
              { a: '/stock', texto: 'Stock' },
              // Sin permiso para VER: el empleado tiene que saber qué le llega.
              { a: '/transferencias', texto: 'Transferencias' },
              { a: '/insumos', texto: 'Insumos' },
              ...(veCompras ? [{ a: '/compras', texto: 'Compras' }] : []),
              ...(veProveedores ? [{ a: '/proveedores', texto: 'Proveedores' }] : []),
            ].map((item) => (
              <li key={item.a}>
                {/* NavLink sabe si su ruta es la activa y nos pasa isActive. */}
                <NavLink
                  to={item.a}
                  end={item.a === '/'}
                  className={({ isActive }) =>
                    `flex min-h-12 items-center border-b-2 px-4 font-medium whitespace-nowrap transition ${
                      isActive
                        ? 'border-corteza dark:border-corteza-claro text-corteza dark:text-corteza-claro'
                        : 'border-transparent text-slate-600 hover:text-slate-900 dark:text-slate-300 dark:hover:text-slate-50'
                    }`
                  }
                >
                  {item.texto}
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>

        <main className="mx-auto max-w-5xl p-4">
          <Outlet />
        </main>

        <footer className="mx-auto max-w-5xl px-4 pb-6 text-xs text-slate-600 dark:text-slate-400">
          Hora del sistema: {formatearFechaArgentina(new Date())} ({sesion.empresa.zonaHoraria})
        </footer>
      </div>
    </ProveedorSucursalActiva>
  );
}
