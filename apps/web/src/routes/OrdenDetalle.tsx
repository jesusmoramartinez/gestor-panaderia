import {
  type AccionOrden,
  aDecimal,
  formatearCantidad,
  formatearDia,
  formatearDinero,
  formatearFechaArgentina,
} from '@panaderia/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useParams } from 'react-router';

import { EtiquetaAtrasada, EtiquetaEstadoOrden, textoCantidad } from '../components/compras';
import { DialogoConfirmacion } from '../components/Dialogo';
import {
  CLASE_BOTON_PELIGRO,
  CLASE_BOTON_PRIMARIO,
  CLASE_BOTON_SECUNDARIO,
  CLASE_CONTROL,
  MensajeError,
  Tarjeta,
} from '../components/formulario';
import { usePuede } from '../hooks/useSesion';
import { obtenerOrden, transicionarOrden } from '../lib/compras';
import { FilaRecepcion } from './Compras';

type Cierre = 'cancelar' | 'cerrar';

const TEXTO_CIERRE: Record<Cierre, { titulo: string; boton: string; explicacion: string }> = {
  cancelar: {
    titulo: 'Cancelar la orden',
    boton: 'Cancelar orden',
    explicacion: 'No llegó nada y ya no se va a comprar. La orden queda en el historial.',
  },
  cerrar: {
    titulo: 'Dar por terminada',
    boton: 'Cerrar con faltante',
    explicacion:
      'Lo que falta NO va a llegar. La orden deja de figurar como pendiente, y queda registrado cuánto faltó.',
  },
};

/**
 * El detalle de una orden: qué se pidió, qué llegó y qué falta.
 *
 * Los botones salen de `orden.acciones`, que calcula el SERVIDOR con la
 * máquina de estados. La pantalla no repite la regla ("¿se puede cancelar
 * una orden parcial?"): muestra lo que viene en la lista, y además filtra por
 * los permisos de quien mira.
 */
export function OrdenDetalle() {
  const { id = '' } = useParams();
  const queryClient = useQueryClient();
  const puedePedir = usePuede('compra:pedir');
  const puedeRecibir = usePuede('compra:recibir');

  const [cierre, setCierre] = useState<Cierre | null>(null);
  const [nota, setNota] = useState('');

  const orden = useQuery({ queryKey: ['orden', id], queryFn: () => obtenerOrden(id) });

  const transicion = useMutation({
    mutationFn: (accion: 'pedir' | Cierre) =>
      transicionarOrden(id, accion, { nota: nota.trim() === '' ? null : nota.trim() }),
    onSuccess: async (actualizada) => {
      queryClient.setQueryData(['orden', id], actualizada);
      await queryClient.invalidateQueries({ queryKey: ['ordenes'] });
      setCierre(null);
      setNota('');
    },
  });

  if (orden.isError) return <MensajeError>{orden.error.message}</MensajeError>;
  if (orden.isPending) {
    return <p className="text-sm text-slate-600 dark:text-slate-400">Cargando la orden...</p>;
  }

  const datos = orden.data;
  const permitida = (accion: AccionOrden) =>
    datos.acciones.includes(accion) && (accion === 'recibir' ? puedeRecibir : puedePedir);

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
            OC {datos.numero} · {datos.proveedor.nombre}
          </h1>
          <EtiquetaEstadoOrden estado={datos.estado} />
          {datos.atrasada && <EtiquetaAtrasada fecha={datos.fechaEntregaEstimada} />}
        </div>
        <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
          Para {datos.sucursal.nombre} · la hizo {datos.usuario.nombre}
          {datos.pedidaAt !== null &&
            ` · pedida ${formatearFechaArgentina(new Date(datos.pedidaAt))}`}
          {datos.fechaEntregaEstimada !== null &&
            ` · entrega estimada ${formatearDia(datos.fechaEntregaEstimada)}`}
        </p>
        {datos.notas !== null && (
          <p className="mt-1 text-sm text-slate-600 italic dark:text-slate-300">«{datos.notas}»</p>
        )}
        {datos.notaCierre !== null && (
          <p className="mt-2 rounded-lg bg-slate-100 p-2 text-sm dark:bg-slate-800">
            Cierre: {datos.notaCierre}
          </p>
        )}
      </div>

      <div className="flex flex-wrap gap-2">
        {permitida('recibir') && (
          <Link
            to={`/compras/${datos.id}/recibir`}
            className={`${CLASE_BOTON_PRIMARIO} grid place-items-center`}
          >
            Recibir mercadería
          </Link>
        )}
        {permitida('pedir') && (
          <button
            type="button"
            disabled={transicion.isPending}
            onClick={() => {
              transicion.mutate('pedir');
            }}
            className={CLASE_BOTON_PRIMARIO}
          >
            Marcar como pedida
          </button>
        )}
        {permitida('editar') && (
          <Link
            to={`/compras/${datos.id}/editar`}
            className={`${CLASE_BOTON_SECUNDARIO} grid place-items-center`}
          >
            Editar
          </Link>
        )}
        {permitida('cerrar') && (
          <button
            type="button"
            onClick={() => {
              setCierre('cerrar');
            }}
            className={CLASE_BOTON_SECUNDARIO}
          >
            Dar por terminada
          </button>
        )}
        {permitida('cancelar') && (
          <button
            type="button"
            onClick={() => {
              setCierre('cancelar');
            }}
            className={CLASE_BOTON_PELIGRO}
          >
            Cancelar
          </button>
        )}
      </div>

      {transicion.isError && cierre === null && (
        <MensajeError>{transicion.error.message}</MensajeError>
      )}

      <Tarjeta titulo="Pedido, recibido y pendiente">
        <ul className="divide-y divide-slate-100 dark:divide-slate-800">
          {datos.lineas.map((linea) => {
            const falta = linea.pendienteBase !== '0';
            const unidad = linea.insumo.unidadBaseCodigo;
            return (
              <li key={linea.id} className="flex flex-wrap items-baseline gap-x-4 gap-y-1 py-3">
                <span className="min-w-40 font-medium">{linea.insumo.nombre}</span>
                <span className="text-sm text-slate-600 dark:text-slate-400">
                  pidió{' '}
                  {textoCantidad(linea.cantidad, linea.presentacion, unidad, formatearCantidad)}
                  {linea.precioUnitario !== null && ` a ${formatearDinero(linea.precioUnitario)}`}
                </span>
                <span className="ml-auto text-right text-sm">
                  <span className="block">
                    {/* En la misma unidad en que se pidió: "llegaron 4 × Bolsa"
                        se compara de un vistazo con "faltan 6 × Bolsa". */}
                    llegaron{' '}
                    {textoCantidad(
                      aDecimal(linea.recibidoBase).dividedBy(linea.factorConversion).toString(),
                      linea.presentacion,
                      unidad,
                      formatearCantidad,
                    )}
                  </span>
                  <span
                    className={`block font-semibold ${
                      falta
                        ? 'text-amber-800 dark:text-amber-300'
                        : 'text-emerald-800 dark:text-emerald-300'
                    }`}
                  >
                    {falta
                      ? `faltan ${textoCantidad(linea.pendiente, linea.presentacion, unidad, formatearCantidad)}`
                      : 'completo'}
                  </span>
                </span>
              </li>
            );
          })}
        </ul>
        {datos.totalEstimado !== null && (
          <p className="mt-3 text-right">
            <span className="text-sm text-slate-600 dark:text-slate-400">Total estimado </span>
            <span className="text-lg font-bold tabular-nums">
              {formatearDinero(datos.totalEstimado)}
            </span>
          </p>
        )}
      </Tarjeta>

      <Tarjeta titulo="Recepciones de esta orden">
        {datos.recepciones.length === 0 ? (
          <p className="text-sm text-slate-600 dark:text-slate-400">Todavía no llegó nada.</p>
        ) : (
          <ul className="space-y-2">
            {datos.recepciones.map((recepcion) => (
              <FilaRecepcion key={recepcion.id} recepcion={recepcion} />
            ))}
          </ul>
        )}
      </Tarjeta>

      <DialogoConfirmacion
        abierto={cierre !== null}
        titulo={cierre === null ? '' : TEXTO_CIERRE[cierre].titulo}
        textoConfirmar={cierre === null ? '' : TEXTO_CIERRE[cierre].boton}
        trabajando={transicion.isPending}
        onConfirmar={() => {
          if (cierre !== null) transicion.mutate(cierre);
        }}
        onCancelar={() => {
          setCierre(null);
          transicion.reset();
        }}
      >
        <p className="text-sm text-slate-600 dark:text-slate-400">
          {cierre === null ? '' : TEXTO_CIERRE[cierre].explicacion}
        </p>
        <label className="mt-3 block">
          <span className="mb-1 block text-sm font-medium">Por qué (opcional)</span>
          <input
            type="text"
            value={nota}
            onChange={(evento) => {
              setNota(evento.target.value);
            }}
            placeholder="El molino no tiene más"
            className={CLASE_CONTROL}
          />
        </label>
        {transicion.isError && (
          <div className="mt-3">
            <MensajeError>{transicion.error.message}</MensajeError>
          </div>
        )}
      </DialogoConfirmacion>
    </div>
  );
}
