import { zodResolver } from '@hookform/resolvers/zod';
import { EnviarTransferenciaSchema, formatearCantidad } from '@panaderia/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useFieldArray, useForm } from 'react-hook-form';
import { Link, useNavigate } from 'react-router';

import {
  Campo,
  CLASE_BOTON_PELIGRO,
  CLASE_BOTON_PRIMARIO,
  CLASE_BOTON_SECUNDARIO,
  CLASE_CONTROL,
  MensajeError,
  Tarjeta,
} from '../components/formulario';
import { useSucursalActiva } from '../components/SucursalActiva';
import { usePuede } from '../hooks/useSesion';
import { ErrorDeApi } from '../lib/api';
import { listarUnidades } from '../lib/catalogo';
import { aplicarErroresDelServidor } from '../lib/erroresFormulario';
import { obtenerStock } from '../lib/stock';
import { enviarTransferencia, listarSucursales } from '../lib/transferencias';

const LINEA_VACIA = { insumoId: '', cantidad: '', unidadId: '', notas: '' };

/**
 * Mandar insumos de la sucursal activa a otra.
 *
 * El origen es SIEMPRE la sucursal en la que se está trabajando: se manda lo
 * que hay acá. El desplegable de insumos muestra cuánto hay de cada uno,
 * porque para el origen esto es una salida más y la primera pregunta es
 * "¿me alcanza?".
 */
export function EnviarTransferencia() {
  const navegar = useNavigate();
  const queryClient = useQueryClient();
  const { activa } = useSucursalActiva();
  const puede = usePuede('transferencia:enviar');
  const puedeForzar = usePuede('stock:forzar');
  const [errorGeneral, setErrorGeneral] = useState<string | null>(null);
  const [faltaStock, setFaltaStock] = useState<string | null>(null);

  const origenId = activa?.id ?? '';
  const sucursales = useQuery({ queryKey: ['sucursales'], queryFn: listarSucursales });
  const unidades = useQuery({ queryKey: ['unidades'], queryFn: listarUnidades });
  // El stock del origen: es la lista de insumos y, a la vez, "cuánto hay".
  const stock = useQuery({
    queryKey: ['stock', { sucursalId: origenId }],
    queryFn: () => obtenerStock({ sucursalId: origenId, soloAlertas: false }),
    enabled: origenId !== '',
  });

  const form = useForm({
    resolver: zodResolver(EnviarTransferenciaSchema),
    defaultValues: {
      sucursalOrigenId: origenId,
      sucursalDestinoId: '',
      fecha: '',
      notas: '',
      forzar: false,
      lineas: [{ ...LINEA_VACIA }],
    },
  });
  const lineas = useFieldArray({ control: form.control, name: 'lineas' });

  const enviar = useMutation({
    mutationFn: enviarTransferencia,
    onSuccess: async (transferencia) => {
      await queryClient.invalidateQueries({ queryKey: ['transferencias'] });
      await queryClient.invalidateQueries({ queryKey: ['stock'] });
      await queryClient.invalidateQueries({ queryKey: ['historial'] });
      await navegar(`/transferencias/${transferencia.id}`, { replace: true });
    },
    onError: (error) => {
      if (error instanceof ErrorDeApi && error.codigo === 'STOCK_INSUFICIENTE') {
        setFaltaStock(error.mensaje);
        return;
      }
      setErrorGeneral(aplicarErroresDelServidor(error, form.setError));
    },
  });

  if (!puede) return <MensajeError>No tenés permiso para enviar transferencias.</MensajeError>;
  if (activa === null) return <MensajeError>No tenés ninguna sucursal asignada.</MensajeError>;

  const destinos = (sucursales.data ?? []).filter((s) => s.id !== origenId);
  const filas = stock.data?.items ?? [];
  const valores = form.watch('lineas');
  const yaElegidos = new Set(valores.map((l) => l.insumoId).filter((id) => id !== ''));

  function enviarCon(forzar: boolean): void {
    setErrorGeneral(null);
    setFaltaStock(null);
    void form.handleSubmit((datos) => {
      // El origen se vuelve a poner desde la sucursal activa: un estado viejo
      // no puede mandar la salida a otro depósito.
      enviar.mutate({ ...datos, sucursalOrigenId: origenId, forzar });
    })();
  }

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div>
        <Link
          to="/transferencias"
          className="text-sm text-corteza hover:underline dark:text-corteza-claro"
        >
          ← Volver a transferencias
        </Link>
        <h1 className="mt-1 text-2xl font-bold text-slate-900 dark:text-slate-50">
          Enviar desde {activa.nombre}
        </h1>
        <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
          Sale del stock de {activa.nombre} ahora. Entra al otro lado cuando lo confirmen al
          recibir: mientras tanto, queda en tránsito.
        </p>
      </div>

      <form
        onSubmit={(evento) => {
          evento.preventDefault();
          enviarCon(false);
        }}
        noValidate
        className="space-y-4"
      >
        <Tarjeta titulo="A dónde">
          <Campo
            etiqueta="Sucursal de destino"
            error={form.formState.errors.sucursalDestinoId?.message}
          >
            <select className={CLASE_CONTROL} {...form.register('sucursalDestinoId')}>
              <option value="">Elegí a dónde va</option>
              {destinos.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.nombre}
                </option>
              ))}
            </select>
          </Campo>
        </Tarjeta>

        <Tarjeta titulo="Qué">
          <div className="space-y-3">
            {stock.isError && (
              <MensajeError>No se pudo cargar el stock: {stock.error.message}</MensajeError>
            )}
            {lineas.fields.map((campo, indice) => {
              const ruta = `lineas.${String(indice)}` as 'lineas.0';
              const errores = form.formState.errors.lineas?.[indice];
              const elegido = filas.find((f) => f.insumoId === valores[indice]?.insumoId);
              return (
                <div
                  key={campo.id}
                  className="grid gap-3 rounded-xl border border-slate-200 p-3 sm:grid-cols-[2fr_1fr_1fr_auto] dark:border-slate-700"
                >
                  <Campo
                    etiqueta="Insumo"
                    error={errores?.insumoId?.message}
                    ayuda={
                      elegido === undefined
                        ? undefined
                        : `Hay ${formatearCantidad(elegido.saldo)} ${elegido.unidadBaseCodigo} en ${activa.nombre}`
                    }
                  >
                    <select className={CLASE_CONTROL} {...form.register(`${ruta}.insumoId`)}>
                      <option value="">Elegí un insumo</option>
                      {filas
                        .filter(
                          (f) =>
                            !yaElegidos.has(f.insumoId) || f.insumoId === valores[indice]?.insumoId,
                        )
                        .map((f) => (
                          <option key={f.insumoId} value={f.insumoId}>
                            {f.nombre} (hay {formatearCantidad(f.saldo)} {f.unidadBaseCodigo})
                          </option>
                        ))}
                    </select>
                  </Campo>
                  <Campo etiqueta="Cantidad" error={errores?.cantidad?.message}>
                    <input
                      type="text"
                      inputMode="decimal"
                      placeholder="0"
                      className={CLASE_CONTROL}
                      {...form.register(`${ruta}.cantidad`)}
                    />
                  </Campo>
                  <Campo etiqueta="Unidad" error={errores?.unidadId?.message}>
                    <select className={CLASE_CONTROL} {...form.register(`${ruta}.unidadId`)}>
                      <option value="">{elegido?.unidadBaseCodigo ?? 'La del insumo'}</option>
                      {(unidades.data ?? []).map((u) => (
                        <option key={u.id} value={u.id}>
                          {u.codigo}
                        </option>
                      ))}
                    </select>
                  </Campo>
                  <div className="flex items-end">
                    <button
                      type="button"
                      aria-label={`Quitar la línea ${String(indice + 1)}`}
                      disabled={lineas.fields.length === 1}
                      onClick={() => {
                        lineas.remove(indice);
                      }}
                      className="min-h-12 rounded-xl px-4 text-slate-600 hover:bg-slate-100 disabled:opacity-30 dark:text-slate-400 dark:hover:bg-slate-800"
                    >
                      Quitar
                    </button>
                  </div>
                </div>
              );
            })}
            {typeof form.formState.errors.lineas?.root?.message === 'string' && (
              <MensajeError>{form.formState.errors.lineas.root.message}</MensajeError>
            )}
            <button
              type="button"
              onClick={() => {
                lineas.append({ ...LINEA_VACIA });
              }}
              className={CLASE_BOTON_SECUNDARIO}
            >
              + Agregar otro insumo
            </button>
          </div>
        </Tarjeta>

        <Tarjeta titulo="Notas">
          <Campo etiqueta="Notas (opcional)" error={form.formState.errors.notas?.message}>
            <input
              type="text"
              placeholder="Para el fin de semana largo..."
              className={CLASE_CONTROL}
              {...form.register('notas')}
            />
          </Campo>
        </Tarjeta>

        {errorGeneral !== null && <MensajeError>{errorGeneral}</MensajeError>}
        {faltaStock !== null && (
          <div className="rounded-xl bg-amber-50 p-4 dark:bg-amber-950/40">
            <p className="font-semibold text-amber-900 dark:text-amber-200">No hay stock</p>
            <p className="mt-1 text-sm text-amber-900 dark:text-amber-200">{faltaStock}</p>
            {puedeForzar && (
              <button
                type="button"
                onClick={() => {
                  enviarCon(true);
                }}
                disabled={enviar.isPending}
                className={`${CLASE_BOTON_PELIGRO} mt-3`}
              >
                Enviar igual (queda en negativo)
              </button>
            )}
          </div>
        )}

        <div className="flex flex-wrap justify-end gap-2">
          <Link
            to="/transferencias"
            className={`${CLASE_BOTON_SECUNDARIO} grid place-items-center`}
          >
            Cancelar
          </Link>
          <button type="submit" disabled={enviar.isPending} className={CLASE_BOTON_PRIMARIO}>
            {enviar.isPending ? 'Enviando...' : 'Enviar'}
          </button>
        </div>
      </form>
    </div>
  );
}
