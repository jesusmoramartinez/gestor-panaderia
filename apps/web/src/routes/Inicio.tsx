import { useQuery } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { Link } from 'react-router';

import { useSucursalActiva } from '../components/SucursalActiva';
import { usePuede, useSesion } from '../hooks/useSesion';
import { listarOrdenes } from '../lib/compras';
import { obtenerAlertas } from '../lib/reposicion';
import { obtenerSalud } from '../lib/salud';
import { listarTransferencias } from '../lib/transferencias';

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

      {activa !== null && <Hoy sucursalId={activa.id} sucursalNombre={activa.nombre} />}

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
    </div>
  );
}

/**
 * Lo primero que se ve al entrar: qué pide acción HOY en la sucursal activa.
 *
 * Es el objetivo de la Fase 10 ("que el dueño abra el sistema y vea qué hay
 * que comprar"): tres números, cada uno con el link a la pantalla donde se
 * resuelve. Si está todo bien, lo dice, que también es información.
 */
function Hoy({ sucursalId, sucursalNombre }: { sucursalId: string; sucursalNombre: string }) {
  const veCompras = usePuede('compra:ver');
  const alertas = useQuery({
    queryKey: ['alertas', sucursalId],
    queryFn: () => obtenerAlertas(sucursalId),
  });
  const porRecibir = useQuery({
    queryKey: ['transferencias', sucursalId, 'ENTRANTES', 'ENVIADA'],
    queryFn: () => listarTransferencias({ sucursalId, direccion: 'ENTRANTES', estado: 'ENVIADA' }),
  });
  const pendientes = useQuery({
    queryKey: ['ordenes', { soloPendientes: true, sucursalId }],
    queryFn: () => listarOrdenes({ soloPendientes: true, sucursalId, limite: 200 }),
    enabled: veCompras,
  });

  const enAlerta = (alertas.data?.critico ?? 0) + (alertas.data?.bajo ?? 0);
  const transferencias = porRecibir.data?.total ?? 0;
  const atrasadas = (pendientes.data?.items ?? []).filter((orden) => orden.atrasada).length;

  const filas: { texto: string; a: string; urgente: boolean }[] = [];
  if (enAlerta > 0) {
    filas.push({
      texto: `${String(enAlerta)} ${enAlerta === 1 ? 'insumo' : 'insumos'} por debajo del mínimo${
        (alertas.data?.critico ?? 0) > 0 ? ` (${String(alertas.data?.critico)} sin stock)` : ''
      }`,
      a: veCompras ? '/reposicion' : '/stock',
      urgente: (alertas.data?.critico ?? 0) > 0,
    });
  }
  if (transferencias > 0) {
    filas.push({
      texto: `${String(transferencias)} ${transferencias === 1 ? 'transferencia viene' : 'transferencias vienen'} en camino: confirmá cuando llegue`,
      a: '/transferencias',
      urgente: false,
    });
  }
  if (atrasadas > 0) {
    filas.push({
      texto: `${String(atrasadas)} ${atrasadas === 1 ? 'compra atrasada' : 'compras atrasadas'}: ya pasó la fecha de entrega`,
      a: '/compras',
      urgente: true,
    });
  }

  const cargando = alertas.isPending || porRecibir.isPending;

  return (
    <Tarjeta titulo={`Hoy en ${sucursalNombre}`}>
      {cargando && <p className="text-sm text-slate-600 dark:text-slate-400">Mirando...</p>}
      {!cargando && filas.length === 0 && (
        <p className="text-emerald-800 dark:text-emerald-300">
          Todo en orden: nada debajo del mínimo y nada esperando.
        </p>
      )}
      <ul className="space-y-2">
        {filas.map((fila) => (
          <li key={fila.a}>
            <Link
              to={fila.a}
              className={`flex min-h-12 items-center justify-between gap-3 rounded-xl px-3 font-medium ${
                fila.urgente
                  ? 'bg-red-50 text-red-900 dark:bg-red-950/40 dark:text-red-200'
                  : 'bg-amber-50 text-amber-900 dark:bg-amber-950/40 dark:text-amber-200'
              }`}
            >
              {fila.texto}
              <span aria-hidden="true">→</span>
            </Link>
          </li>
        ))}
      </ul>
    </Tarjeta>
  );
}
