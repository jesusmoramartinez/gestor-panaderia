import { formatearFechaArgentina, type TransferenciaResumen } from '@panaderia/shared';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router';

import { CLASE_BOTON_PRIMARIO, MensajeError } from '../components/formulario';
import { useSucursalActiva } from '../components/SucursalActiva';
import { EtiquetaEstadoTransferencia } from '../components/transferencias';
import { usePuede } from '../hooks/useSesion';
import { listarTransferencias } from '../lib/transferencias';

type Bandeja = 'ENTRANTES' | 'SALIENTES';

/**
 * Las dos bandejas, vistas desde la sucursal activa:
 *
 *   Vienen para acá  — lo que hay que confirmar cuando llegue la camioneta
 *   Salieron de acá  — lo que mandamos y todavía no confirmaron
 *
 * Arriba siempre lo que está EN TRÁNSITO, que es lo que pide acción; abajo,
 * lo último que ya se cerró.
 */
export function Transferencias() {
  const { activa } = useSucursalActiva();
  const puedeEnviar = usePuede('transferencia:enviar');
  const [bandeja, setBandeja] = useState<Bandeja>('ENTRANTES');

  if (activa === null) return <MensajeError>No tenés ninguna sucursal asignada.</MensajeError>;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="mr-auto">
          <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-50">Transferencias</h1>
          <p className="text-sm text-slate-600 dark:text-slate-400">
            Insumos que van y vienen entre sucursales. Vista desde <strong>{activa.nombre}</strong>.
          </p>
        </div>
        {puedeEnviar && (
          <Link
            to="/transferencias/nueva"
            className={`${CLASE_BOTON_PRIMARIO} grid place-items-center`}
          >
            Enviar a otra sucursal
          </Link>
        )}
      </div>

      <div role="tablist" className="flex gap-1 border-b border-slate-200 dark:border-slate-700">
        {(
          [
            ['ENTRANTES', 'Vienen para acá'],
            ['SALIENTES', 'Salieron de acá'],
          ] as const
        ).map(([valor, texto]) => (
          <button
            key={valor}
            type="button"
            role="tab"
            aria-selected={bandeja === valor}
            onClick={() => {
              setBandeja(valor);
            }}
            className={`min-h-12 border-b-2 px-4 font-medium ${
              bandeja === valor
                ? 'border-corteza text-corteza dark:border-corteza-claro dark:text-corteza-claro'
                : 'border-transparent text-slate-600 dark:text-slate-300'
            }`}
          >
            {texto}
          </button>
        ))}
      </div>

      {/* La key fuerza a rearmar las consultas al cambiar de sucursal o de bandeja. */}
      <BandejaDe key={`${activa.id}-${bandeja}`} sucursalId={activa.id} bandeja={bandeja} />
    </div>
  );
}

function BandejaDe({ sucursalId, bandeja }: { sucursalId: string; bandeja: Bandeja }) {
  const enTransito = useQuery({
    queryKey: ['transferencias', sucursalId, bandeja, 'ENVIADA'],
    queryFn: () => listarTransferencias({ sucursalId, direccion: bandeja, estado: 'ENVIADA' }),
  });
  const ultimas = useQuery({
    queryKey: ['transferencias', sucursalId, bandeja, 'todas'],
    queryFn: () => listarTransferencias({ sucursalId, direccion: bandeja, limite: 20 }),
  });

  const cerradas = (ultimas.data?.items ?? []).filter((t) => t.estado !== 'ENVIADA');

  return (
    <div className="space-y-6">
      <section className="space-y-2">
        <h2 className="text-sm font-semibold tracking-wide text-slate-600 uppercase dark:text-slate-400">
          En tránsito
        </h2>
        {enTransito.isError && <MensajeError>{enTransito.error.message}</MensajeError>}
        {enTransito.data?.items.length === 0 && (
          <p className="rounded-2xl bg-white p-6 text-center text-slate-600 shadow-sm dark:bg-slate-900 dark:text-slate-400">
            {bandeja === 'ENTRANTES'
              ? 'No hay nada en camino para acá.'
              : 'Todo lo que salió de acá ya fue confirmado.'}
          </p>
        )}
        <ul className="space-y-2">
          {(enTransito.data?.items ?? []).map((t) => (
            <Fila key={t.id} transferencia={t} bandeja={bandeja} />
          ))}
        </ul>
      </section>

      {cerradas.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold tracking-wide text-slate-600 uppercase dark:text-slate-400">
            Últimas
          </h2>
          <ul className="space-y-2">
            {cerradas.map((t) => (
              <Fila key={t.id} transferencia={t} bandeja={bandeja} />
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function Fila({
  transferencia,
  bandeja,
}: {
  transferencia: TransferenciaResumen;
  bandeja: Bandeja;
}) {
  const otra = bandeja === 'ENTRANTES' ? transferencia.origen : transferencia.destino;
  return (
    <li>
      <Link
        to={`/transferencias/${transferencia.id}`}
        className={`block rounded-2xl bg-white p-4 shadow-sm transition hover:bg-slate-50 dark:bg-slate-900 dark:hover:bg-slate-800/60 ${
          transferencia.estado === 'ANULADA' ? 'opacity-60' : ''
        }`}
      >
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span className="font-semibold">Transferencia {transferencia.numero}</span>
          <span className="font-medium">
            {bandeja === 'ENTRANTES' ? `desde ${otra.nombre}` : `a ${otra.nombre}`}
          </span>
          <EtiquetaEstadoTransferencia estado={transferencia.estado} />
          {transferencia.conDiferencia && (
            <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-900 dark:bg-amber-950/60 dark:text-amber-300">
              llegó con diferencia
            </span>
          )}
        </div>
        <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
          Salió {formatearFechaArgentina(new Date(transferencia.fechaEnvio))} ·{' '}
          {transferencia.usuarioEnvio.nombre} · {transferencia.cantidadLineas}{' '}
          {transferencia.cantidadLineas === 1 ? 'insumo' : 'insumos'}
          {transferencia.fechaRecepcion !== null &&
            ` · llegó ${formatearFechaArgentina(new Date(transferencia.fechaRecepcion))}`}
        </p>
      </Link>
    </li>
  );
}
