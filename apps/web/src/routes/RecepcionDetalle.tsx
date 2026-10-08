import { formatearCantidad, formatearDinero, formatearFechaArgentina } from '@panaderia/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useParams } from 'react-router';

import { EtiquetaAnulada, textoCantidad } from '../components/compras';
import { DialogoConfirmacion } from '../components/Dialogo';
import {
  CLASE_BOTON_PELIGRO,
  CLASE_CONTROL,
  MensajeError,
  Tarjeta,
} from '../components/formulario';
import { usePuede } from '../hooks/useSesion';
import { ErrorDeApi } from '../lib/api';
import { anularRecepcion, obtenerRecepcion } from '../lib/compras';

/**
 * Una recepción: qué llegó, a qué precio, y cuánto quedó costando cada
 * insumo.
 *
 * Es la pantalla a la que se llega después de recibir, y por eso muestra el
 * costo promedio: "la harina quedó en $1.100/kg" es la confirmación de que
 * la compra tuvo el efecto que se esperaba.
 */
export function RecepcionDetalle() {
  const { id = '' } = useParams();
  const queryClient = useQueryClient();
  const puedeAnular = usePuede('compra:anular');
  const puedeForzar = usePuede('stock:forzar');

  const [anulando, setAnulando] = useState(false);
  const [motivo, setMotivo] = useState('');
  const [necesitaForzar, setNecesitaForzar] = useState<string | null>(null);

  const recepcion = useQuery({ queryKey: ['recepcion', id], queryFn: () => obtenerRecepcion(id) });

  const anular = useMutation({
    mutationFn: (forzar: boolean) => anularRecepcion(id, { motivo, forzar }),
    onSuccess: async (actualizada) => {
      queryClient.setQueryData(['recepcion', id], actualizada);
      for (const clave of [
        ['recepciones'],
        ['ordenes'],
        ['orden'],
        ['stock'],
        ['historial'],
        ['proveedor'],
        ['proveedoresDeInsumo'],
      ]) {
        await queryClient.invalidateQueries({ queryKey: clave });
      }
      setAnulando(false);
      setNecesitaForzar(null);
      setMotivo('');
    },
    onError: (error) => {
      // Si la mercadería ya se usó, sacarla deja el stock en negativo: se
      // muestra el número y, si tiene permiso, la opción de hacerlo igual.
      if (error instanceof ErrorDeApi && error.codigo === 'STOCK_INSUFICIENTE') {
        setNecesitaForzar(error.mensaje);
      }
    },
  });

  if (recepcion.isError) return <MensajeError>{recepcion.error.message}</MensajeError>;
  if (recepcion.isPending) {
    return <p className="text-sm text-slate-600 dark:text-slate-400">Cargando la recepción...</p>;
  }

  const datos = recepcion.data;
  const anulada = datos.estado === 'ANULADA';

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <div>
        <Link
          to="/compras"
          className="text-sm text-corteza hover:underline dark:text-corteza-claro"
        >
          ← Volver a compras
        </Link>
        <div className="mt-1 flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-50">
            Recepción {datos.numero} · {datos.proveedor.nombre}
          </h1>
          {anulada && <EtiquetaAnulada />}
        </div>
        <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
          {formatearFechaArgentina(new Date(datos.fecha))} · {datos.sucursal.nombre} · cargó{' '}
          {datos.usuario.nombre}
          {datos.orden !== null && (
            <>
              {' · '}
              <Link to={`/compras/${datos.orden.id}`} className="underline">
                OC {datos.orden.numero}
              </Link>
            </>
          )}
          {datos.orden === null && ' · sin orden'}
          {datos.numeroRemito !== null && ` · remito ${datos.numeroRemito}`}
          {datos.numeroFactura !== null && ` · factura ${datos.numeroFactura}`}
        </p>
        {datos.notas !== null && (
          <p className="mt-1 text-sm text-slate-600 italic dark:text-slate-300">«{datos.notas}»</p>
        )}
        {anulada && (
          <p className="mt-2 rounded-lg bg-red-50 p-3 text-sm text-red-900 dark:bg-red-950/40 dark:text-red-200">
            Anulada{' '}
            {datos.anuladaAt === null ? '' : formatearFechaArgentina(new Date(datos.anuladaAt))} por{' '}
            {datos.anuladaPor?.nombre ?? '—'}: «{datos.motivoAnulacion}». El stock que había entrado
            se sacó con una anulación en el historial de cada insumo.
          </p>
        )}
      </div>

      <Tarjeta titulo="Qué llegó">
        <ul className="divide-y divide-slate-100 dark:divide-slate-800">
          {datos.lineas.map((linea) => {
            const unidad = linea.insumo.unidadBaseCodigo;
            return (
              <li key={linea.id} className="flex flex-wrap items-baseline gap-x-4 gap-y-1 py-3">
                <Link
                  to={`/stock/${linea.insumo.id}`}
                  className="min-w-40 font-medium hover:underline"
                >
                  {linea.insumo.nombre}
                </Link>
                <span className="text-sm text-slate-600 dark:text-slate-400">
                  {textoCantidad(linea.cantidad, linea.presentacion, unidad, formatearCantidad)}
                  {linea.presentacion !== null &&
                    ` = ${formatearCantidad(linea.cantidadBase)} ${unidad}`}{' '}
                  a {formatearDinero(linea.precioUnitario)}
                  {linea.presentacion !== null &&
                    ` (${formatearDinero(linea.costoUnitarioBase)} por ${unidad})`}
                </span>
                <span className="ml-auto font-semibold tabular-nums">
                  {formatearDinero(linea.subtotal)}
                </span>
              </li>
            );
          })}
        </ul>
        <p className="mt-3 text-right">
          <span className="text-sm text-slate-600 dark:text-slate-400">Total </span>
          <span className="text-lg font-bold tabular-nums">{formatearDinero(datos.total)}</span>
        </p>
      </Tarjeta>

      <Tarjeta titulo="Costo promedio actual">
        <p className="mb-3 text-sm text-slate-600 dark:text-slate-400">
          Cada compra mueve el promedio según cuánto había y a qué precio entró. Las salidas se
          valorizan a este número.
        </p>
        <ul className="space-y-1">
          {datos.costos.map((costo) => (
            <li key={costo.insumoId} className="flex justify-between gap-3">
              <span>{costo.insumoNombre}</span>
              <span className="font-semibold tabular-nums">
                {costo.costoPromedio === null
                  ? 'sin costo'
                  : `${formatearDinero(costo.costoPromedio)} por ${costo.unidadBaseCodigo}`}
              </span>
            </li>
          ))}
        </ul>
      </Tarjeta>

      {puedeAnular && !anulada && (
        <button
          type="button"
          onClick={() => {
            anular.reset();
            setNecesitaForzar(null);
            setAnulando(true);
          }}
          className={CLASE_BOTON_PELIGRO}
        >
          Anular recepción
        </button>
      )}

      <DialogoConfirmacion
        abierto={anulando}
        titulo={`Anular la recepción ${String(datos.numero)}`}
        textoConfirmar={necesitaForzar === null ? 'Anular' : 'Anular igual (queda en negativo)'}
        trabajando={anular.isPending}
        onConfirmar={() => {
          anular.mutate(necesitaForzar !== null);
        }}
        onCancelar={() => {
          setAnulando(false);
        }}
      >
        <p className="text-sm text-slate-600 dark:text-slate-400">
          Se saca del stock lo que entró, se recalcula el costo promedio y, si tenía orden, vuelve a
          quedar pendiente. No se borra nada: queda en el historial.
        </p>
        <label className="mt-3 block">
          <span className="mb-1 block text-sm font-medium">Por qué se anula</span>
          <input
            type="text"
            value={motivo}
            onChange={(evento) => {
              setMotivo(evento.target.value);
            }}
            placeholder="Se cargó dos veces, el precio estaba mal..."
            className={CLASE_CONTROL}
          />
        </label>
        {necesitaForzar !== null && (
          <div className="mt-3 rounded-xl bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
            <p>{necesitaForzar}</p>
            <p className="mt-1">
              {puedeForzar
                ? 'La mercadería ya se usó. Si la anulás igual, el stock queda en negativo y queda registrado con tu nombre.'
                : 'La mercadería ya se usó y no tenés permiso para dejar el stock en negativo.'}
            </p>
          </div>
        )}
        {anular.isError && necesitaForzar === null && (
          <div className="mt-3">
            <MensajeError>{anular.error.message}</MensajeError>
          </div>
        )}
      </DialogoConfirmacion>
    </div>
  );
}
