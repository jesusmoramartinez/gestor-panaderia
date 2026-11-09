import { formatearFechaArgentina, type UsuarioSesion } from '@panaderia/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Link, NavLink, Outlet, useNavigate } from 'react-router';

import { usePuede } from '../hooks/useSesion';
import { cerrarSesion } from '../lib/sesion';
import { ProveedorSucursalActiva } from './SucursalActiva';
import { SelectorTema } from './Tema';

const ETIQUETA_ROL: Record<UsuarioSesion['rol'], string> = {
  DUENO: 'Dueño',
  ENCARGADO: 'Encargado',
  EMPLEADO: 'Empleado',
};

/**
 * El menú del MVP de compras (Etapa 2).
 *
 * Stock, Transferencias y Reposición quedan OCULTOS, no borrados: sus
 * pantallas siguen andando por URL y vuelven al menú cuando llegue
 * producción. Un usuario que no ve compras (sin precios) sigue viendo el
 * menú de stock, que no muestra plata.
 *
 * Esconder pestañas es comodidad, no seguridad: la defensa está en la API.
 */
function Menu() {
  const veProveedores = usePuede('proveedor:ver');
  const veCompras = usePuede('compra:ver');

  const items = veCompras
    ? [
        { a: '/', texto: 'Me deben' },
        { a: '/compras', texto: 'Compras' },
        ...(veProveedores ? [{ a: '/proveedores', texto: 'Proveedores' }] : []),
        { a: '/insumos', texto: 'Insumos' },
        { a: '/reportes', texto: 'Reportes' },
      ]
    : [
        { a: '/', texto: 'Inicio' },
        { a: '/stock', texto: 'Stock' },
        { a: '/insumos', texto: 'Insumos' },
      ];

  const claseActivo = 'text-corteza dark:text-corteza-claro';
  const claseInactivo =
    'text-slate-600 hover:text-slate-900 dark:text-slate-300 dark:hover:text-slate-50';

  return (
    <>
      {/* En la PC y la tablet: pestañas arriba. */}
      <nav
        aria-label="Menú principal"
        className="hidden border-b border-slate-200 bg-white sm:block print:hidden dark:border-slate-700 dark:bg-slate-900"
      >
        <ul className="mx-auto flex max-w-5xl gap-1 px-2">
          {items.map((item) => (
            <li key={item.a}>
              {/* NavLink sabe si su ruta es la activa y nos pasa isActive. */}
              <NavLink
                to={item.a}
                end={item.a === '/'}
                className={({ isActive }) =>
                  `flex min-h-12 items-center border-b-2 px-4 font-medium whitespace-nowrap transition ${
                    isActive
                      ? `border-corteza dark:border-corteza-claro ${claseActivo}`
                      : `border-transparent ${claseInactivo}`
                  }`
                }
              >
                {item.texto}
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>

      {/* En el celular: una barra fija ABAJO, como en las aplicaciones de
          celular. Entran todas las pestañas sin desplazarse, y quedan donde
          llega el pulgar. El padding de abajo respeta la barra de gestos del
          teléfono (safe-area). */}
      <nav
        aria-label="Menú principal"
        className="fixed inset-x-0 bottom-0 z-20 border-t print:hidden border-slate-200 bg-white pb-[env(safe-area-inset-bottom)] sm:hidden dark:border-slate-700 dark:bg-slate-900"
      >
        <ul
          className="grid"
          style={{ gridTemplateColumns: `repeat(${String(items.length)}, minmax(0, 1fr))` }}
        >
          {items.map((item) => (
            <li key={item.a}>
              <NavLink
                to={item.a}
                end={item.a === '/'}
                className={({ isActive }) =>
                  `flex min-h-14 items-center justify-center border-t-2 px-1 text-center text-sm leading-tight font-medium ${
                    isActive
                      ? `border-corteza dark:border-corteza-claro ${claseActivo}`
                      : `border-transparent ${claseInactivo}`
                  }`
                }
              >
                {item.texto}
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>
    </>
  );
}

export function LayoutPrivado({ sesion }: { sesion: UsuarioSesion }) {
  const navegar = useNavigate();
  const queryClient = useQueryClient();

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
        <header className="border-b border-slate-200 bg-white print:hidden dark:border-slate-700 dark:bg-slate-900">
          <div className="mx-auto flex max-w-5xl items-center gap-3 px-4 py-3">
            <div className="mr-auto min-w-0">
              <p className="truncate font-bold text-slate-900 dark:text-slate-50">
                {sesion.empresa.nombre}
              </p>
              {/* El nombre lleva a "Mi cuenta": contraseña y email. */}
              <Link
                to="/mi-cuenta"
                className="text-sm text-slate-600 underline-offset-2 hover:underline dark:text-slate-400"
              >
                {sesion.nombre} · {ETIQUETA_ROL[sesion.rol]}
              </Link>
            </div>

            {/* En el celular el tema se cambia desde "Mi cuenta": acá ocupaba
                media pantalla (lo mostró la captura de Playwright). */}
            <div className="hidden sm:block">
              <SelectorTema />
            </div>

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

        <Menu />

        <main className="mx-auto max-w-5xl p-4">
          <Outlet />
        </main>

        {/* pb-24 en el celular: que la barra de abajo no tape lo último. */}
        <footer className="mx-auto max-w-5xl px-4 pb-24 print:hidden text-xs text-slate-600 sm:pb-6 dark:text-slate-400">
          Hora del sistema: {formatearFechaArgentina(new Date())} ({sesion.empresa.zonaHoraria})
        </footer>
      </div>
    </ProveedorSucursalActiva>
  );
}
