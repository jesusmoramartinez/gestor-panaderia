import {
  aDecimal,
  formatearCantidad,
  formatearDinero,
  formatearFechaArgentina,
  type ItemReposicion,
  type Reposicion as DatosReposicion,
} from '@panaderia/shared';
import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router';

import {
  CLASE_BOTON_PRIMARIO,
  CLASE_BOTON_SECUNDARIO,
  MensajeError,
  Tarjeta,
} from '../components/formulario';
import { Semaforo } from '../components/stock';
import { useSucursalActiva } from '../components/SucursalActiva';
import { usePuede } from '../hooks/useSesion';
import {
  obtenerReposicion,
  type PrecargaOrden,
  type PrecargaTransferencia,
} from '../lib/reposicion';

/** Cuántos días tiene un precio. Con inflación, uno de hace dos meses no sirve. */
function diasDesde(fecha: string | null): number | null {
  if (fecha === null) return null;
  return Math.floor((Date.now() - new Date(fecha).getTime()) / 86_400_000);
}

/**
 * QUÉ HAY QUE REPONER. La pantalla que el dueño abre a la mañana.
 *
 * Se lee de arriba hacia abajo en el orden en que se actúa:
 *
 *   1. Lo que la Central puede mandar (es gratis y es hoy).
 *   2. Lo que hay que comprar, por proveedor: cada bloque es UNA orden de
 *      compra, con su total y un botón que la arma.
 *   3. El detalle por sucursal, para entender de dónde salen los números.
 *
 * Las cuentas las hace la API (`planificarReposicion`, con sus tests); acá
 * solo se muestran.
 */
export function Reposicion() {
  const puedeVer = usePuede('compra:ver');
  const consulta = useQuery({
    queryKey: ['reposicion'],
    queryFn: () => obtenerReposicion(),
    enabled: puedeVer,
  });

  if (!puedeVer) return <MensajeError>No tenés permiso para ver la reposición.</MensajeError>;
  if (consulta.isError) return <MensajeError>{consulta.error.message}</MensajeError>;
  if (consulta.isPending) {
    return <p className="text-sm text-slate-600 dark:text-slate-400">Calculando...</p>;
  }

  const datos = consulta.data;
  const sinNada = datos.items.length === 0;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-50">Reposición</h1>
        <p className="text-sm text-slate-600 dark:text-slate-400">
          Lo que está por debajo del mínimo, ya descontado lo pedido y lo que viene en camino.
          {datos.central !== null &&
            ` ${datos.central.nombre} abastece a las demás con lo que le sobra por encima de su mínimo.`}
        </p>
      </div>

      {sinNada && (
        <p className="rounded-2xl bg-emerald-50 p-6 text-center text-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200">
          No hay nada para reponer: todo lo que tiene mínimo está por encima. Los insumos sin mínimo
          configurado no se controlan (se configura en la ficha de cada insumo).
        </p>
      )}

      {datos.transferencias.length > 0 && datos.central !== null && (
        <Transferencias datos={datos} />
      )}
      {datos.compras.length > 0 && <Compras datos={datos} />}
      {!sinNada && <PorSucursal items={datos.items} />}
    </div>
  );
}

function Transferencias({ datos }: { datos: DatosReposicion }) {
  const navegar = useNavigate();
  const { sucursales, cambiar } = useSucursalActiva();
  const central = datos.central;
  const puedeEnviar = usePuede('transferencia:enviar');
  const operaEnCentral = central !== null && sucursales.some((s) => s.id === central.id);

  return (
    <section className="space-y-3">
      <h2 className="text-lg font-semibold">1. Que lo mande {central?.nombre}</h2>
      {datos.transferencias.map((grupo) => (
        <Tarjeta key={grupo.destino.id} titulo={`Para ${grupo.destino.nombre}`}>
          <ul className="space-y-1">
            {grupo.lineas.map((linea) => (
              <li key={linea.insumo.id} className="flex justify-between gap-3">
                <span>{linea.insumo.nombre}</span>
                <span className="font-semibold tabular-nums">
                  {formatearCantidad(linea.cantidadBase)} {linea.insumo.unidadBaseCodigo}
                </span>
              </li>
            ))}
          </ul>
          {puedeEnviar && operaEnCentral && central !== null && (
            <button
              type="button"
              className={`${CLASE_BOTON_SECUNDARIO} mt-4`}
              onClick={() => {
                // El envío sale de la sucursal ACTIVA: para mandar desde la
                // Central, primero hay que estar parado en la Central.
                cambiar(central.id);
                const precarga: PrecargaTransferencia = {
                  tipo: 'transferencia',
                  destinoId: grupo.destino.id,
                  lineas: grupo.lineas.map((l) => ({
                    insumoId: l.insumo.id,
                    cantidad: l.cantidadBase,
                  })),
                };
                void navegar('/transferencias/nueva', { state: { precarga } });
              }}
            >
              Armar la transferencia
            </button>
          )}
        </Tarjeta>
      ))}
    </section>
  );
}

function Compras({ datos }: { datos: DatosReposicion }) {
  const navegar = useNavigate();
  const puedePedir = usePuede('compra:pedir');
  // Con Decimal, como todo el dinero del sistema, aunque sea solo para mostrar.
  const total = datos.compras.reduce(
    (suma, grupo) => (grupo.totalEstimado === null ? suma : suma.plus(grupo.totalEstimado)),
    aDecimal('0'),
  );

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-baseline gap-3">
        <h2 className="mr-auto text-lg font-semibold">
          {datos.transferencias.length > 0 ? '2. ' : ''}Comprar
        </h2>
        {total.greaterThan(0) && (
          <p className="text-sm text-slate-600 dark:text-slate-400">
            Total estimado{' '}
            <strong className="text-base text-slate-900 tabular-nums dark:text-slate-50">
              {formatearDinero(total)}
            </strong>
          </p>
        )}
      </div>

      {datos.compras.map((grupo) => {
        const clave = `${grupo.proveedor?.id ?? 'sin'}-${grupo.sucursal.id}`;
        return (
          <Tarjeta
            key={clave}
            titulo={`${grupo.proveedor?.nombre ?? 'Sin proveedor preferido'} → ${grupo.sucursal.nombre}`}
          >
            {grupo.proveedor === null && (
              <p className="mb-3 rounded-lg bg-amber-50 p-2 text-sm text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
                Estos insumos no tienen proveedor preferido. Marcá uno en la ficha del insumo para
                que la reposición sepa a quién pedírselos.
              </p>
            )}
            {grupo.proveedor?.diasEntrega != null && (
              <p className="mb-2 text-sm text-slate-600 dark:text-slate-400">
                {grupo.proveedor.diasEntrega === 0
                  ? 'Entrega en el día.'
                  : `Tarda ${String(grupo.proveedor.diasEntrega)} días en entregar.`}
              </p>
            )}
            <ul className="divide-y divide-slate-100 dark:divide-slate-800">
              {grupo.lineas.map((linea) => {
                const dias = diasDesde(linea.precioAt);
                return (
                  <li
                    key={linea.insumo.id}
                    className="flex flex-wrap items-baseline gap-x-3 gap-y-1 py-2"
                  >
                    <span className="font-medium">{linea.insumo.nombre}</span>
                    <span className="text-sm text-slate-600 dark:text-slate-400">
                      {linea.presentacion === null
                        ? `${formatearCantidad(linea.bultos)} ${linea.insumo.unidadBaseCodigo}`
                        : `${formatearCantidad(linea.bultos)} × ${linea.presentacion.nombre} (${formatearCantidad(linea.cantidadBase)} ${linea.insumo.unidadBaseCodigo})`}
                    </span>
                    <span className="ml-auto text-right">
                      {linea.subtotal === null ? (
                        <span className="text-sm text-slate-600 dark:text-slate-400">
                          sin precio
                        </span>
                      ) : (
                        <>
                          <span className="font-semibold tabular-nums">
                            {formatearDinero(linea.subtotal)}
                          </span>
                          {dias !== null && dias > 30 && linea.precioAt !== null && (
                            <span className="block text-xs text-amber-800 dark:text-amber-300">
                              precio del{' '}
                              {formatearFechaArgentina(new Date(linea.precioAt)).slice(0, 10)}
                            </span>
                          )}
                        </>
                      )}
                    </span>
                  </li>
                );
              })}
            </ul>
            {grupo.totalEstimado !== null && (
              <p className="mt-2 text-right">
                <span className="text-sm text-slate-600 dark:text-slate-400">Total </span>
                <span className="font-bold tabular-nums">
                  {formatearDinero(grupo.totalEstimado)}
                </span>
              </p>
            )}
            {puedePedir && grupo.proveedor !== null && (
              <button
                type="button"
                className={`${CLASE_BOTON_PRIMARIO} mt-3`}
                onClick={() => {
                  const precarga: PrecargaOrden = {
                    tipo: 'orden',
                    proveedorId: grupo.proveedor?.id ?? '',
                    sucursalId: grupo.sucursal.id,
                    lineas: grupo.lineas.map((l) => ({
                      insumoId: l.insumo.id,
                      presentacionId: l.presentacion?.id ?? '',
                      cantidad: l.bultos,
                      precioUnitario: l.precioUnitario ?? '',
                    })),
                  };
                  void navegar('/compras/nueva', { state: { precarga } });
                }}
              >
                Crear orden con esto
              </button>
            )}
          </Tarjeta>
        );
      })}
    </section>
  );
}

function PorSucursal({ items }: { items: readonly ItemReposicion[] }) {
  const porSucursal = new Map<string, ItemReposicion[]>();
  for (const item of items) {
    const lista = porSucursal.get(item.sucursal.id) ?? [];
    lista.push(item);
    porSucursal.set(item.sucursal.id, lista);
  }

  return (
    // <details> NATIVO, cerrado: el detalle explica de dónde salen los números,
    // pero lo que se ACTÚA está arriba. El primer día, con todo en cero, son
    // decenas de filas por sucursal y taparían los botones (lo mostró la
    // captura de Playwright: la pantalla medía 10.000 px de alto).
    <details className="group space-y-3">
      <summary className="flex min-h-12 cursor-pointer items-center text-lg font-semibold">
        Detalle por sucursal ({items.length} {items.length === 1 ? 'insumo' : 'insumos'} en alerta)
      </summary>
      {[...porSucursal.values()].map((lista) => (
        <Tarjeta key={lista[0]?.sucursal.id} titulo={lista[0]?.sucursal.nombre ?? ''}>
          <ul className="divide-y divide-slate-100 dark:divide-slate-800">
            {lista.map((item) => {
              const u = item.insumo.unidadBaseCodigo;
              const resuelto = item.faltante === '0';
              return (
                <li key={item.insumo.id} className="py-3">
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    <Semaforo estado={item.estado} negativo={item.saldo.startsWith('-')} />
                    <Link to={`/insumos/${item.insumo.id}`} className="font-medium hover:underline">
                      {item.insumo.nombre}
                    </Link>
                    <span className="ml-auto text-sm tabular-nums">
                      hay {formatearCantidad(item.saldo)} {u} · mínimo{' '}
                      {formatearCantidad(item.stockMinimo)} {u}
                    </span>
                  </div>
                  <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
                    {item.yaPedido !== '0' &&
                      `ya pedido ${formatearCantidad(item.yaPedido)} ${u} · `}
                    {item.enCamino !== '0' &&
                      `en camino ${formatearCantidad(item.enCamino)} ${u} · `}
                    {resuelto
                      ? 'cubierto con lo que ya viene'
                      : [
                          `faltan ${formatearCantidad(item.faltante)} ${u} para llegar a ${formatearCantidad(item.objetivo)}`,
                          item.desdeCentral !== '0' &&
                            `${formatearCantidad(item.desdeCentral)} desde la Central`,
                          item.aComprar !== '0' && `${formatearCantidad(item.aComprar)} a comprar`,
                        ]
                          .filter(Boolean)
                          .join(' · ')}
                  </p>
                </li>
              );
            })}
          </ul>
        </Tarjeta>
      ))}
    </details>
  );
}
