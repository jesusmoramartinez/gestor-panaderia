import { zodResolver } from '@hookform/resolvers/zod';
import {
  aDecimal,
  AjustarStockSchema,
  esDecimalValido,
  formatearCantidad,
  normalizarNumero,
  type ResultadoAjuste,
} from '@panaderia/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useFieldArray, useForm } from 'react-hook-form';
import { Link } from 'react-router';

import {
  Campo,
  CLASE_BOTON_PRIMARIO,
  CLASE_BOTON_SECUNDARIO,
  CLASE_CONTROL,
  MensajeError,
  Tarjeta,
} from '../components/formulario';
import { Saldo } from '../components/stock';
import { useSucursalActiva } from '../components/SucursalActiva';
import { usePuede } from '../hooks/useSesion';
import { aplicarErroresDelServidor } from '../lib/erroresFormulario';
import { ajustarStock, listarMotivos, obtenerStock } from '../lib/stock';

/**
 * Ajustar el stock a lo contado.
 *
 * La diferencia con las otras cargas es toda la pantalla: acá la persona
 * escribe CUÁNTO HAY, y el sistema calcula la diferencia. Nunca se tipea un
 * número con signo.
 *
 * Por eso la fila muestra tres cosas juntas —lo que dice el sistema, lo que se
 * contó y la diferencia— calculadas en vivo. Es información, no validación: la
 * cuenta que vale es la que hace el servidor con el candado tomado, porque
 * entre que se abre la pantalla y se envía el formulario alguien pudo cargar
 * un consumo.
 */
function valoresVacios(sucursalId: string) {
  return {
    sucursalId,
    motivoId: '',
    fecha: '',
    notas: '',
    lineas: [{ insumoId: '', cantidadContada: '', notas: '' }],
  };
}

export function AjustarStock() {
  const { activa } = useSucursalActiva();
  const queryClient = useQueryClient();
  const puede = usePuede('ajuste:crear');

  const [errorGeneral, setErrorGeneral] = useState<string | null>(null);
  const [resultado, setResultado] = useState<ResultadoAjuste | null>(null);

  // El stock de la sucursal sirve para DOS cosas a la vez: la lista de insumos
  // del selector y el saldo que el sistema dice que hay de cada uno.
  const stock = useQuery({
    queryKey: ['stock', { sucursalId: activa?.id ?? '', soloAlertas: false }],
    queryFn: () => obtenerStock({ sucursalId: activa?.id ?? '', soloAlertas: false }),
    enabled: activa !== null,
  });

  const motivos = useQuery({
    queryKey: ['motivos', 'AJUSTE'],
    queryFn: () => listarMotivos('AJUSTE'),
  });

  const form = useForm({
    resolver: zodResolver(AjustarStockSchema),
    defaultValues: valoresVacios(activa?.id ?? ''),
  });

  const lineas = useFieldArray({ control: form.control, name: 'lineas' });

  const enviar = useMutation({
    mutationFn: ajustarStock,
    onSuccess: async (datos) => {
      setResultado(datos);
      await queryClient.invalidateQueries({ queryKey: ['stock'] });
      await queryClient.invalidateQueries({ queryKey: ['historial'] });
      form.reset(valoresVacios(activa?.id ?? ''));
    },
    onError: (error) => {
      setErrorGeneral(aplicarErroresDelServidor(error, form.setError));
    },
  });

  if (!puede) {
    return (
      <MensajeError>
        No tenés permiso para ajustar el stock. Es una de las operaciones delicadas del sistema:
        cambia el saldo sin que haya pasado nada físico.
      </MensajeError>
    );
  }
  if (activa === null) {
    return <MensajeError>No tenés ninguna sucursal asignada.</MensajeError>;
  }

  const sucursalId = activa.id;
  const porInsumo = new Map((stock.data?.items ?? []).map((item) => [item.insumoId, item]));
  const valores = form.watch('lineas');
  const yaElegidos = new Set(valores.map((linea) => linea.insumoId).filter((id) => id !== ''));

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <div>
        <Link to="/stock" className="text-sm text-corteza hover:underline dark:text-corteza-claro">
          ← Volver al stock
        </Link>
        <h1 className="mt-1 text-2xl font-bold text-slate-900 dark:text-slate-50">
          Ajustar el stock
        </h1>
        <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
          Contá lo que hay en el depósito y escribilo acá. El sistema calcula la diferencia y la
          registra. Sucursal: <strong>{activa.nombre}</strong>.
        </p>
      </div>

      {resultado !== null && <Informe resultado={resultado} />}

      <form
        onSubmit={(evento) => {
          evento.preventDefault();
          setErrorGeneral(null);
          setResultado(null);
          void form.handleSubmit((datos) => {
            enviar.mutate({ ...datos, sucursalId });
          })();
        }}
        noValidate
        className="space-y-4"
      >
        <Tarjeta titulo="Qué contaste">
          <div className="space-y-3">
            {lineas.fields.map((campo, indice) => {
              const elegido = valores[indice]?.insumoId ?? '';
              const fila = porInsumo.get(elegido);
              const contado = valores[indice]?.cantidadContada ?? '';

              return (
                <div
                  key={campo.id}
                  className="grid gap-3 rounded-xl border border-slate-200 p-3 sm:grid-cols-[2fr_1fr_1fr_auto] dark:border-slate-700"
                >
                  <Campo
                    etiqueta={indice === 0 ? 'Insumo' : ''}
                    error={form.formState.errors.lineas?.[indice]?.insumoId?.message}
                  >
                    <select
                      className={CLASE_CONTROL}
                      {...form.register(`lineas.${String(indice)}.insumoId` as 'lineas.0.insumoId')}
                    >
                      <option value="">Elegí un insumo</option>
                      {(stock.data?.items ?? [])
                        .filter(
                          (item) => !yaElegidos.has(item.insumoId) || item.insumoId === elegido,
                        )
                        .map((item) => (
                          <option key={item.insumoId} value={item.insumoId}>
                            {item.nombre} ({item.unidadBaseCodigo})
                          </option>
                        ))}
                    </select>
                  </Campo>

                  <Campo
                    etiqueta={
                      indice === 0 ? `Contado${fila ? ` (${fila.unidadBaseCodigo})` : ''}` : ''
                    }
                    error={form.formState.errors.lineas?.[indice]?.cantidadContada?.message}
                  >
                    <input
                      type="text"
                      inputMode="decimal"
                      placeholder="0"
                      className={CLASE_CONTROL}
                      {...form.register(
                        `lineas.${String(indice)}.cantidadContada` as 'lineas.0.cantidadContada',
                      )}
                    />
                  </Campo>

                  <div className="flex flex-col justify-center text-sm">
                    {fila === undefined ? (
                      <span className="text-slate-600 dark:text-slate-400">
                        Elegí el insumo para ver cuánto dice el sistema.
                      </span>
                    ) : (
                      <>
                        <span className="text-slate-600 dark:text-slate-400">
                          Sistema: {formatearCantidad(fila.saldo)} {fila.unidadBaseCodigo}
                        </span>
                        <Diferencia
                          saldo={fila.saldo}
                          contado={contado}
                          unidad={fila.unidadBaseCodigo}
                        />
                      </>
                    )}
                  </div>

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

            <button
              type="button"
              onClick={() => {
                lineas.append({ insumoId: '', cantidadContada: '', notas: '' });
              }}
              className={CLASE_BOTON_SECUNDARIO}
            >
              + Contar otro insumo
            </button>
          </div>
        </Tarjeta>

        <Tarjeta titulo="Por qué">
          <div className="grid gap-4 sm:grid-cols-2">
            <Campo
              etiqueta="Motivo"
              ayuda="Obligatorio: un ajuste sin motivo es cambiar el número sin explicación."
              error={form.formState.errors.motivoId?.message}
            >
              <select className={CLASE_CONTROL} {...form.register('motivoId')}>
                <option value="">Elegí un motivo</option>
                {(motivos.data ?? []).map((motivo) => (
                  <option key={motivo.id} value={motivo.id}>
                    {motivo.nombre}
                  </option>
                ))}
              </select>
            </Campo>

            <Campo
              etiqueta="Fecha y hora (opcional)"
              ayuda="Si contaste ayer, ponelo. Vacío = ahora."
              error={form.formState.errors.fecha?.message}
            >
              <input
                type="datetime-local"
                className={CLASE_CONTROL}
                onChange={(evento) => {
                  const valor = evento.target.value;
                  form.setValue('fecha', valor === '' ? '' : new Date(valor).toISOString());
                }}
              />
            </Campo>

            <div className="sm:col-span-2">
              <Campo etiqueta="Nota (opcional)" error={form.formState.errors.notas?.message}>
                <input
                  type="text"
                  placeholder="Revisé el depósito B el lunes a la mañana"
                  className={CLASE_CONTROL}
                  {...form.register('notas')}
                />
              </Campo>
            </div>
          </div>
        </Tarjeta>

        {errorGeneral !== null && <MensajeError>{errorGeneral}</MensajeError>}

        <div className="flex flex-wrap justify-end gap-2">
          <Link to="/stock" className={`${CLASE_BOTON_SECUNDARIO} grid place-items-center`}>
            Cancelar
          </Link>
          <button type="submit" disabled={enviar.isPending} className={CLASE_BOTON_PRIMARIO}>
            {enviar.isPending ? 'Guardando...' : 'Registrar el ajuste'}
          </button>
        </div>
      </form>
    </div>
  );
}

/**
 * La diferencia, calculada en vivo mientras se escribe.
 *
 * Es solo informativa: la cuenta que vale es la del servidor, que la hace con
 * el candado tomado. Acá sirve para que la persona vea el número antes de
 * enviar y se dé cuenta si tipeó 620 en lugar de 62.
 */
function Diferencia({
  saldo,
  contado,
  unidad,
}: {
  saldo: string;
  contado: string;
  unidad: string;
}) {
  const normalizado = normalizarNumero(contado.trim());
  if (normalizado === '' || !esDecimalValido(normalizado)) return null;

  const diferencia = aDecimal(normalizado).minus(aDecimal(saldo));
  if (diferencia.isZero()) {
    return <span className="font-medium text-slate-600 dark:text-slate-400">sin cambio</span>;
  }

  const sobra = diferencia.greaterThan(0);
  return (
    <span
      className={`font-semibold tabular-nums ${
        sobra ? 'text-emerald-700 dark:text-emerald-400' : 'text-red-700 dark:text-red-400'
      }`}
    >
      {sobra ? 'sobran +' : 'faltan −'}
      {formatearCantidad(diferencia.abs())} {unidad}
    </span>
  );
}

/** El informe que devuelve la API: qué había, qué se contó, qué se corrigió. */
function Informe({ resultado }: { resultado: ResultadoAjuste }) {
  const ajustadas = resultado.lineas.filter((linea) => linea.ajustado);

  return (
    <div className="rounded-2xl bg-emerald-50 p-4 dark:bg-emerald-950/40">
      <p className="font-semibold text-emerald-900 dark:text-emerald-200">
        {ajustadas.length === 0
          ? `Contaste ${String(resultado.lineas.length)} ${resultado.lineas.length === 1 ? 'insumo' : 'insumos'} y el stock ya estaba bien. No se registró nada.`
          : `Se ajustaron ${String(ajustadas.length)} de ${String(resultado.lineas.length)} ${resultado.lineas.length === 1 ? 'insumo' : 'insumos'}.`}
      </p>

      <ul className="mt-2 space-y-1 text-sm">
        {resultado.lineas.map((linea) => (
          <li
            key={linea.insumoId}
            className="flex flex-wrap items-baseline justify-between gap-x-3 text-emerald-900 dark:text-emerald-200"
          >
            <span>{linea.insumoNombre}</span>
            <span className="tabular-nums">
              decía {formatearCantidad(linea.saldoAnterior)} · contaste{' '}
              {formatearCantidad(linea.contado)} ·{' '}
              {linea.ajustado ? (
                <>
                  ajuste de {linea.diferencia.startsWith('-') ? '−' : '+'}
                  {formatearCantidad(linea.diferencia.replace('-', ''))} → queda{' '}
                  <Saldo valor={linea.contado} unidad={linea.unidadBaseCodigo} />
                </>
              ) : (
                'coincidía'
              )}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
