import {
  aDecimal,
  type CompraAbierta,
  type DeudaProveedor,
  formatearCantidad,
  formatearDinero,
} from '@panaderia/shared';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';

import { textoCantidad } from '../components/compras';
import { CLASE_BOTON_PRIMARIO, MensajeError } from '../components/formulario';
import { usePuede } from '../hooks/useSesion';
import { obtenerLoQueMeDeben } from '../lib/acopio';

/**
 * ACOPIO, "lo que me deben" (Fase 12a): la pantalla de inicio del MVP.
 *
 * Responde, de arriba hacia abajo y en el orden en que se lee en el celular:
 *   1. ¿Cuánto me deben en total? (dos números grandes)
 *   2. ¿Quién me debe qué? (una tarjeta por proveedor, el que más debe primero)
 *   3. ¿Qué compras siguen abiertas, y desde cuándo? (la más vieja primero)
 */
/** `enInicio`: va en una columna del inicio (sin ancho propio, título más chico). */
export function LoQueMeDeben({ enInicio = false }: { enInicio?: boolean }) {
  const puedePedir = usePuede('compra:pedir');
  const deudas = useQuery({ queryKey: ['me-deben'], queryFn: obtenerLoQueMeDeben });

  if (deudas.isError) return <MensajeError>{deudas.error.message}</MensajeError>;
  if (deudas.isPending) {
    return <p className="text-sm text-slate-600 dark:text-slate-400">Cargando...</p>;
  }
  const datos = deudas.data;
  const nadaPendiente = datos.proveedores.length === 0 && datos.aFavor.length === 0;

  return (
    <div className={enInicio ? 'space-y-5' : 'mx-auto max-w-3xl space-y-5'}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          {/* En el inicio es una sección (h2), no el título de la página. */}
          {enInicio ? (
            <h2 className="text-2xl font-bold text-slate-900 dark:text-slate-50">Acopio</h2>
          ) : (
            <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-50">Acopio</h1>
          )}
          <p className="text-sm text-slate-600 dark:text-slate-400">
            Lo que ya compraste y todavía no te entregaron.
          </p>
        </div>
        {puedePedir && (
          <Link to="/compras/nueva" className={`${CLASE_BOTON_PRIMARIO} grid place-items-center`}>
            Nueva compra
          </Link>
        )}
      </div>

      {nadaPendiente ? (
        <section className="rounded-2xl bg-white p-6 text-center shadow-sm dark:bg-slate-900">
          <p className="text-lg font-semibold text-emerald-800 dark:text-emerald-300">
            No hay mercadería pendiente de entrega.
          </p>
          <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">
            Cuando cargues una compra, acá vas a ver lo que falta que te entreguen y cuánto vale.
          </p>
        </section>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2">
            <Numero
              chico={enInicio}
              titulo="Te deben en mercadería"
              valor={formatearDinero(datos.valorPendiente)}
              detalle="Lo que falta entregar, al precio de cada compra"
            />
            <Numero
              chico={enInicio}
              titulo="Plata tuya en los proveedores"
              valor={formatearDinero(datos.adelantadoSinEntregar)}
              detalle="Lo que pagaste y todavía no te entregaron"
            />
          </div>

          <section aria-labelledby="titulo-proveedores" className="space-y-3">
            <h2
              id="titulo-proveedores"
              className="text-sm font-semibold tracking-wide text-slate-600 uppercase dark:text-slate-400"
            >
              Quién te debe
            </h2>
            {datos.proveedores.map((deuda) => (
              <TarjetaProveedor key={deuda.proveedor.id} deuda={deuda} />
            ))}
          </section>
        </>
      )}

      {datos.aFavor.length > 0 && (
        <section aria-labelledby="titulo-a-favor" className="space-y-3">
          <h2
            id="titulo-a-favor"
            className="text-sm font-semibold tracking-wide text-slate-600 uppercase dark:text-slate-400"
          >
            Te tienen que devolver
          </h2>
          <ul className="space-y-2">
            {datos.aFavor.map((item) => (
              <li key={item.id}>
                <Link
                  to={`/compras/${item.id}`}
                  className="flex flex-wrap items-baseline justify-between gap-2 rounded-2xl bg-white p-4 shadow-sm hover:bg-slate-50 dark:bg-slate-900 dark:hover:bg-slate-800/60"
                >
                  <span>
                    <span className="block font-semibold text-slate-900 dark:text-slate-50">
                      {item.proveedor.nombre}
                    </span>
                    <span className="block text-sm text-slate-600 dark:text-slate-400">
                      Compra {item.numero} ·{' '}
                      {item.estado === 'CANCELADA' ? 'cancelada' : 'cerrada con faltante'}: la
                      pagaste y no va a llegar
                    </span>
                  </span>
                  <span className="font-bold text-red-700 tabular-nums dark:text-red-400">
                    {formatearDinero(item.monto)}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {datos.comprasAbiertas.length > 0 && (
        <section aria-labelledby="titulo-abiertas" className="space-y-3">
          <h2
            id="titulo-abiertas"
            className="text-sm font-semibold tracking-wide text-slate-600 uppercase dark:text-slate-400"
          >
            Compras abiertas, de la más vieja a la más nueva
          </h2>
          <ul className="space-y-2">
            {datos.comprasAbiertas.map((compra) => (
              <FilaCompraAbierta key={compra.id} compra={compra} />
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

/** `chico`: en la columna del inicio hay la mitad de ancho; $ 5.279.483,00 no entraba. */
function Numero({
  titulo,
  valor,
  detalle,
  chico = false,
}: {
  titulo: string;
  valor: string;
  detalle: string;
  chico?: boolean;
}) {
  return (
    <section className="rounded-2xl bg-white p-5 shadow-sm dark:bg-slate-900">
      <h2 className="text-sm font-medium text-slate-600 dark:text-slate-400">{titulo}</h2>
      <p
        className={`mt-1 font-bold break-words text-slate-900 tabular-nums dark:text-slate-50 ${
          chico ? 'text-2xl' : 'text-3xl'
        }`}
      >
        {valor}
      </p>
      <p className="mt-1 text-xs text-slate-600 dark:text-slate-400">{detalle}</p>
    </section>
  );
}

function TarjetaProveedor({ deuda }: { deuda: DeudaProveedor }) {
  return (
    <article className="rounded-2xl bg-white shadow-sm dark:bg-slate-900">
      <header className="flex flex-wrap items-baseline justify-between gap-2 border-b border-slate-100 p-4 dark:border-slate-800">
        <h3 className="text-lg font-bold text-slate-900 dark:text-slate-50">
          {deuda.proveedor.nombre}
        </h3>
        <p className="text-lg font-bold text-corteza tabular-nums dark:text-corteza-claro">
          {formatearDinero(deuda.valorPendiente)}
        </p>
      </header>
      <ul className="divide-y divide-slate-100 dark:divide-slate-800">
        {deuda.renglones.map((renglon) => (
          <li key={`${renglon.ordenId}-${renglon.insumo.id}`}>
            <Link
              to={`/compras/${renglon.ordenId}`}
              className="flex min-h-12 flex-wrap items-center gap-x-3 gap-y-1 p-4 hover:bg-slate-50 dark:hover:bg-slate-800/60"
            >
              <span className="min-w-0 flex-1">
                <span className="block font-semibold text-slate-900 dark:text-slate-50">
                  {renglon.insumo.nombre}
                </span>
                <span className="block text-sm text-slate-600 dark:text-slate-400">
                  Compra {renglon.ordenNumero}
                  {renglon.precioUnitario !== null &&
                    ` · a ${formatearDinero(renglon.precioUnitario)} c/u`}
                </span>
              </span>
              <span className="text-right">
                <span className="block font-semibold text-amber-800 dark:text-amber-300">
                  faltan{' '}
                  {textoCantidad(
                    renglon.pendiente,
                    renglon.presentacion,
                    renglon.insumo.unidadBaseCodigo,
                    formatearCantidad,
                  )}
                </span>
                <span className="block text-sm text-slate-600 tabular-nums dark:text-slate-400">
                  {renglon.valorPendiente === null
                    ? 'sin precio cargado'
                    : formatearDinero(renglon.valorPendiente)}
                </span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
      {deuda.renglonesSinPrecio > 0 && (
        <p className="border-t border-slate-100 p-4 text-sm text-amber-800 dark:border-slate-800 dark:text-amber-300">
          {deuda.renglonesSinPrecio === 1
            ? 'Un renglón no tiene precio: el total de este proveedor no lo incluye.'
            : `${String(deuda.renglonesSinPrecio)} renglones no tienen precio: el total no los incluye.`}
        </p>
      )}
    </article>
  );
}

function FilaCompraAbierta({ compra }: { compra: CompraAbierta }) {
  // El avance en plata: cuánto de lo que vale la compra ya llegó.
  const avance =
    compra.total === null || aDecimal(compra.total).isZero()
      ? null
      : Math.round(aDecimal(compra.valorRecibido).dividedBy(compra.total).times(100).toNumber());

  return (
    <li>
      <Link
        to={`/compras/${compra.id}`}
        className="block rounded-2xl bg-white p-4 shadow-sm hover:bg-slate-50 dark:bg-slate-900 dark:hover:bg-slate-800/60"
      >
        <span className="flex flex-wrap items-baseline justify-between gap-2">
          <span className="font-semibold text-slate-900 dark:text-slate-50">
            Compra {compra.numero} · {compra.proveedor.nombre}
          </span>
          <span
            className={`text-sm font-medium ${
              compra.diasAbierta > 30
                ? 'text-red-700 dark:text-red-400'
                : 'text-slate-600 dark:text-slate-400'
            }`}
          >
            {compra.diasAbierta === 0
              ? 'pedida hoy'
              : compra.diasAbierta === 1
                ? 'hace 1 día'
                : `hace ${String(compra.diasAbierta)} días`}
          </span>
        </span>
        {avance !== null && compra.total !== null && (
          <>
            {/* Una barra simple, sin librería: el ancho es el porcentaje. */}
            <span
              className="mt-3 block h-2 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800"
              aria-hidden="true"
            >
              <span
                className="block h-full rounded-full bg-emerald-600 dark:bg-emerald-500"
                style={{ width: `${String(avance)}%` }}
              />
            </span>
            <span className="mt-2 block text-sm text-slate-600 dark:text-slate-400">
              Llegó {formatearDinero(compra.valorRecibido)} de {formatearDinero(compra.total)} (
              {avance}%)
            </span>
          </>
        )}
      </Link>
    </li>
  );
}
