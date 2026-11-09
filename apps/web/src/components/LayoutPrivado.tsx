import { formatearFechaArgentina, type UsuarioSesion } from '@panaderia/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { Link, NavLink, Outlet, useNavigate } from 'react-router';

import { usePuede } from '../hooks/useSesion';
import {
  IconoAcopio,
  IconoCompras,
  IconoCuenta,
  IconoInicio,
  IconoInsumos,
  IconoProveedores,
  IconoReportes,
  IconoSalir,
  LogoPan,
} from './Iconos';
import { cerrarSesion } from '../lib/sesion';
import { ProveedorSucursalActiva } from './SucursalActiva';
import { SelectorTema } from './Tema';

const ETIQUETA_ROL: Record<UsuarioSesion['rol'], string> = {
  DUENO: 'Dueño',
  ENCARGADO: 'Encargado',
  EMPLEADO: 'Empleado',
};

type ItemMenu = { a: string; texto: string; icono: ReactNode };

/**
 * Qué pestañas ve cada uno.
 *
 * Stock, Transferencias y Reposición quedan OCULTOS, no borrados: sus
 * pantallas siguen andando por URL. Un usuario que no ve compras (sin
 * precios) sigue viendo el menú de stock, que no muestra plata.
 *
 * Esconder pestañas es comodidad, no seguridad: la defensa está en la API.
 */
function useItemsMenu(): ItemMenu[] {
  const veProveedores = usePuede('proveedor:ver');
  const veCompras = usePuede('compra:ver');

  return veCompras
    ? [
        { a: '/', texto: 'Acopio', icono: <IconoAcopio /> },
        { a: '/compras', texto: 'Compras', icono: <IconoCompras /> },
        ...(veProveedores
          ? [{ a: '/proveedores', texto: 'Proveedores', icono: <IconoProveedores /> }]
          : []),
        { a: '/insumos', texto: 'Insumos', icono: <IconoInsumos /> },
        { a: '/reportes', texto: 'Reportes', icono: <IconoReportes /> },
      ]
    : [
        { a: '/', texto: 'Inicio', icono: <IconoInicio /> },
        { a: '/stock', texto: 'Stock', icono: <IconoInsumos /> },
        { a: '/insumos', texto: 'Insumos', icono: <IconoInsumos /> },
      ];
}

const CLASE_ACTIVO = 'bg-corteza/10 text-corteza dark:bg-corteza-claro/15 dark:text-corteza-claro';
const CLASE_INACTIVO =
  'text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-slate-50';

/**
 * En la PC: una barra fija a la IZQUIERDA. Deja todo el ancho de la pantalla
 * para el contenido (las pantallas anchas tienen lugar de sobra a los costados
 * y poco hacia abajo).
 */
function BarraLateral({
  sesion,
  items,
  salir,
  saliendo,
}: {
  sesion: UsuarioSesion;
  items: ItemMenu[];
  salir: () => void;
  saliendo: boolean;
}) {
  return (
    <aside className="fixed inset-y-0 left-0 z-20 hidden w-60 flex-col border-r border-slate-200 bg-white sm:flex print:hidden dark:border-slate-700 dark:bg-slate-900">
      {/* El logo (provisorio) lleva al inicio. El nombre de la empresa queda
          para los lectores de pantalla y como cartelito al pasar el mouse. */}
      <Link
        to="/"
        title={sesion.empresa.nombre}
        aria-label={`${sesion.empresa.nombre}: inicio`}
        className="flex items-center gap-3 px-5 pt-5 pb-4"
      >
        <LogoPan className="size-14" />
      </Link>

      <nav aria-label="Menú principal" className="flex-1 overflow-y-auto px-3">
        <ul className="flex flex-col gap-1">
          {items.map((item) => (
            <li key={item.a}>
              {/* NavLink sabe si su ruta es la activa y nos pasa isActive. */}
              <NavLink
                to={item.a}
                end={item.a === '/'}
                className={({ isActive }) =>
                  `flex min-h-12 items-center gap-3 rounded-lg px-3 font-medium transition ${
                    isActive ? CLASE_ACTIVO : CLASE_INACTIVO
                  }`
                }
              >
                {item.icono}
                {item.texto}
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>

      {/* Abajo, lo de la persona: su cuenta, el tema y salir. */}
      <div className="flex flex-col gap-2 border-t border-slate-200 p-3 dark:border-slate-700">
        <NavLink
          to="/mi-cuenta"
          className={({ isActive }) =>
            `flex min-h-12 items-center gap-3 rounded-lg px-3 transition ${
              isActive ? CLASE_ACTIVO : CLASE_INACTIVO
            }`
          }
        >
          <IconoCuenta />
          <span className="min-w-0">
            <span className="block truncate font-medium">{sesion.nombre}</span>
            <span className="block text-xs text-slate-500 dark:text-slate-400">
              {ETIQUETA_ROL[sesion.rol]}
            </span>
          </span>
        </NavLink>
        <SelectorTema ancho />
        <button
          type="button"
          onClick={salir}
          disabled={saliendo}
          className={`flex min-h-12 items-center gap-3 rounded-lg px-3 font-medium transition disabled:opacity-50 ${CLASE_INACTIVO}`}
        >
          <IconoSalir />
          {saliendo ? 'Saliendo...' : 'Salir'}
        </button>
      </div>
    </aside>
  );
}

/**
 * En el celular: arriba el logo y "Salir"; abajo una barra fija con las
 * pestañas, como en las aplicaciones de celular (donde llega el pulgar). El
 * padding de abajo respeta la barra de gestos del teléfono (safe-area).
 */
function MenuCelular({
  sesion,
  items,
  salir,
  saliendo,
}: {
  sesion: UsuarioSesion;
  items: ItemMenu[];
  salir: () => void;
  saliendo: boolean;
}) {
  return (
    <>
      <header className="flex items-center gap-3 border-b border-slate-200 bg-white px-4 py-2 sm:hidden print:hidden dark:border-slate-700 dark:bg-slate-900">
        <Link to="/" aria-label={`${sesion.empresa.nombre}: inicio`} className="mr-auto">
          <LogoPan className="size-10" />
        </Link>
        <Link
          to="/mi-cuenta"
          aria-label={`Mi cuenta (${sesion.nombre})`}
          className="flex min-h-11 min-w-11 items-center justify-center rounded-lg text-slate-600 dark:text-slate-300"
        >
          <IconoCuenta />
        </Link>
        <button
          type="button"
          onClick={salir}
          disabled={saliendo}
          className="min-h-11 rounded-lg border border-slate-300 px-4 font-medium text-slate-700 transition hover:bg-slate-50 disabled:opacity-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800"
        >
          {saliendo ? 'Saliendo...' : 'Salir'}
        </button>
      </header>

      <nav
        aria-label="Menú principal"
        className="fixed inset-x-0 bottom-0 z-20 border-t border-slate-200 bg-white pb-[env(safe-area-inset-bottom)] sm:hidden print:hidden dark:border-slate-700 dark:bg-slate-900"
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
                  `flex min-h-14 flex-col items-center justify-center gap-0.5 px-1 text-center text-xs leading-tight font-medium ${
                    isActive
                      ? 'text-corteza dark:text-corteza-claro'
                      : 'text-slate-600 dark:text-slate-300'
                  }`
                }
              >
                {item.icono}
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
  const items = useItemsMenu();

  const salir = useMutation({
    mutationFn: cerrarSesion,
    onSuccess: () => {
      // Al salir se borra TODO el caché: si no, el usuario siguiente podría
      // ver por un instante los datos del anterior en la misma computadora.
      queryClient.clear();
      void navegar('/login', { replace: true });
    },
  });
  const propsMenu = {
    sesion,
    items,
    salir: () => {
      salir.mutate();
    },
    saliendo: salir.isPending,
  };

  return (
    <ProveedorSucursalActiva sucursales={sesion.sucursales}>
      <div className="min-h-dvh bg-masa dark:bg-horno">
        <BarraLateral {...propsMenu} />
        <MenuCelular {...propsMenu} />

        {/* sm:pl-60: el contenido empieza donde termina la barra lateral. */}
        <div className="sm:pl-60 print:pl-0">
          <main className="mx-auto max-w-7xl p-4 sm:p-6">
            <Outlet />
          </main>

          {/* pb-24 en el celular: que la barra de abajo no tape lo último. */}
          <footer className="mx-auto max-w-7xl px-4 pb-24 text-xs text-slate-600 sm:px-6 sm:pb-6 print:hidden dark:text-slate-400">
            Hora del sistema: {formatearFechaArgentina(new Date())} ({sesion.empresa.zonaHoraria})
          </footer>
        </div>
      </div>
    </ProveedorSucursalActiva>
  );
}
