import { useQuery } from '@tanstack/react-query';
import type { ReactNode } from 'react';

import { useSucursalActiva } from '../components/SucursalActiva';
import { useSesion } from '../hooks/useSesion';
import { obtenerSalud } from '../lib/salud';

function Tarjeta({ titulo, children }: { titulo: string; children: ReactNode }) {
  return (
    <section className="rounded-2xl bg-white p-5 shadow-sm dark:bg-slate-900">
      <h2 className="text-sm font-semibold tracking-wide text-slate-600 dark:text-slate-400 uppercase">
        {titulo}
      </h2>
      <div className="mt-3 space-y-2 text-slate-900 dark:text-slate-100">{children}</div>
    </section>
  );
}

function Dato({ etiqueta, valor }: { etiqueta: string; valor: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-slate-100 py-1.5 last:border-0 dark:border-slate-800">
      <span className="text-sm text-slate-600 dark:text-slate-400">{etiqueta}</span>
      <span className="text-right font-medium">{valor}</span>
    </div>
  );
}

export function Inicio() {
  const sesion = useSesion();
  const { activa } = useSucursalActiva();
  const salud = useQuery({ queryKey: ['salud'], queryFn: obtenerSalud });

  const usuario = sesion.data;
  if (!usuario) return null;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-50">
          Hola, {usuario.nombre}
        </h1>
        <p className="mt-1 text-slate-600 dark:text-slate-400">
          Estás trabajando en <strong>{activa?.nombre ?? 'ninguna sucursal'}</strong>.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Tarjeta titulo="Tu sesión">
          <Dato etiqueta="Email" valor={usuario.email} />
          <Dato etiqueta="Rol" valor={usuario.rol} />
          <Dato
            etiqueta="Sucursales habilitadas"
            valor={usuario.sucursales.map((s) => s.codigo).join(', ') || 'ninguna'}
          />
          <Dato
            etiqueta="Permisos"
            valor={usuario.permisos.length > 0 ? usuario.permisos.join(', ') : 'ninguno'}
          />
        </Tarjeta>

        <Tarjeta titulo="Estado del sistema">
          <Dato etiqueta="API" valor={salud.isPending ? '...' : salud.data ? 'ok' : 'error'} />
          <Dato
            etiqueta="Base de datos"
            valor={salud.isPending ? '...' : (salud.data?.db ?? 'error')}
          />
          <Dato etiqueta="Hora del servidor" valor={salud.data?.ahoraArgentina ?? '...'} />
          <Dato etiqueta="Contrato compartido" valor={`v${salud.data?.version ?? '?'}`} />
        </Tarjeta>
      </div>

      <p className="px-1 text-sm text-slate-600 dark:text-slate-400">
        Próxima fase: unidades de medida y conversiones. Después llega el catálogo de insumos y esta
        pantalla pasa a mostrar el stock de la sucursal.
      </p>
    </div>
  );
}
