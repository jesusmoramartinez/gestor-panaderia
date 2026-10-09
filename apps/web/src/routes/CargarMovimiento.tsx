import { zodResolver } from '@hookform/resolvers/zod';
import {
  type CargarMovimientoFormInput,
  CargarMovimientoFormSchema,
  conMotivoObligatorio,
  formatearCantidad,
  type ResultadoCarga,
  LIMITE_MAXIMO_LISTADO,
} from '@panaderia/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useFieldArray, useForm } from 'react-hook-form';
import { Link } from 'react-router';

import {
  Campo,
  CLASE_BOTON_PELIGRO,
  CLASE_BOTON_PRIMARIO,
  CLASE_BOTON_SECUNDARIO,
  CLASE_CONTROL,
  MensajeError,
  Tarjeta,
} from '../components/formulario';
import { Saldo } from '../components/stock';
import { useSucursalActiva } from '../components/SucursalActiva';
import { usePuede } from '../hooks/useSesion';
import { ErrorDeApi } from '../lib/api';
import { listarInsumos, listarUnidades } from '../lib/catalogo';
import { aplicarErroresDelServidor } from '../lib/erroresFormulario';
import { cargarConsumo, cargarMerma, cargarSaldoInicial, listarMotivos } from '../lib/stock';

/**
 * Las tres cargas en una sola pantalla.
 *
 * Son el mismo formulario: dónde, cuándo, y una lista de líneas. Lo que cambia
 * es el título, si el motivo es obligatorio y a qué endpoint va. Tenerlas
 * separadas significaría mantener tres veces la misma grilla multi-línea, y la
 * tercera siempre queda atrasada.
 */
type Clase = 'CONSUMO' | 'MERMA' | 'SALDO_INICIAL';

/**
 * Lo que la pantalla le manda a la API.
 *
 * El formulario permite `motivoId: null` (porque el consumo y el saldo inicial
 * no lo necesitan), pero el endpoint de merma lo exige. Acá se cierra esa
 * diferencia UNA vez, en el único lugar donde se sabe de qué carga se trata.
 */
type Enviar = (valores: CargarMovimientoFormInput) => Promise<ResultadoCarga>;

const enviarMerma: Enviar = (valores) => {
  if (valores.motivoId === null) {
    // No puede pasar: el resolver de esta pantalla ya exige el motivo cuando
    // la carga es una merma. Pero el tipo no lo sabe, y lanzar es mejor que
    // forzarlo con un cast: si algún día se cambia el resolver y se olvida
    // esto, el error aparece acá y no en un INSERT sin motivo.
    throw new Error('Falta el motivo de la merma');
  }
  return cargarMerma({ ...valores, motivoId: valores.motivoId });
};

const CONFIGURACION = {
  CONSUMO: {
    titulo: 'Cargar consumo',
    ayuda: 'Lo que se usó para producir. Se descuenta del stock de la sucursal.',
    enviar: cargarConsumo satisfies Enviar,
    tipoMotivo: 'CONSUMO' as const,
    motivoObligatorio: false,
    permiso: 'consumo:crear' as const,
    textoBoton: 'Registrar consumo',
  },
  MERMA: {
    titulo: 'Cargar merma',
    ayuda: 'Lo que se perdió sin usarse: vencido, roto, mojado. Siempre con motivo.',
    enviar: enviarMerma,
    tipoMotivo: 'MERMA' as const,
    motivoObligatorio: true,
    permiso: 'merma:crear' as const,
    textoBoton: 'Registrar merma',
  },
  SALDO_INICIAL: {
    titulo: 'Cargar saldo inicial',
    ayuda:
      'El punto de partida: lo que hay hoy en el depósito. Se carga UNA sola vez por insumo y sucursal.',
    enviar: cargarSaldoInicial satisfies Enviar,
    tipoMotivo: null,
    motivoObligatorio: false,
    permiso: 'stock:cargar-inicial' as const,
    textoBoton: 'Registrar saldo inicial',
  },
};

/** Los valores vacíos: para el estado inicial y para limpiar después de cargar. */
function valoresVacios(sucursalId: string) {
  return {
    sucursalId,
    fecha: '',
    notas: '',
    motivoId: '',
    forzar: false,
    lineas: [{ insumoId: '', cantidad: '', unidadId: '', notas: '' }],
  };
}

/**
 * El error que vale para TODA la lista de líneas (por ejemplo, "hay un insumo
 * repetido"), que no pertenece a ninguna línea en particular.
 *
 * React Hook Form lo guarda en `.root` cuando viene de un refine sobre el
 * array, y en `.message` en otros casos. Se miran los dos.
 */
function mensajeDeLineas(errores: unknown): string | null {
  if (typeof errores !== 'object' || errores === null) return null;
  const como = errores as { message?: unknown; root?: { message?: unknown } };
  if (typeof como.message === 'string') return como.message;
  if (typeof como.root?.message === 'string') return como.root.message;
  return null;
}

export function CargarMovimiento({ clase }: { clase: Clase }) {
  const config = CONFIGURACION[clase];
  const queryClient = useQueryClient();
  const { activa } = useSucursalActiva();
  const puede = usePuede(config.permiso);
  const puedeForzar = usePuede('stock:forzar');

  const [errorGeneral, setErrorGeneral] = useState<string | null>(null);
  const [faltaStock, setFaltaStock] = useState<string | null>(null);
  const [resultado, setResultado] = useState<ResultadoCarga | null>(null);

  const insumos = useQuery({
    queryKey: ['insumos', { limite: LIMITE_MAXIMO_LISTADO, desplazamiento: 0 }],
    queryFn: () => listarInsumos({ limite: LIMITE_MAXIMO_LISTADO, desplazamiento: 0 }),
  });
  const unidades = useQuery({ queryKey: ['unidades'], queryFn: listarUnidades });
  const motivos = useQuery({
    queryKey: ['motivos', config.tipoMotivo],
    queryFn: () => listarMotivos(config.tipoMotivo ?? undefined),
    enabled: config.tipoMotivo !== null,
  });

  // El esquema es el del FORMULARIO (motivo opcional) y, si es una merma, con
  // la exigencia del motivo encadenada. Los dos producen el mismo tipo de
  // valores, así que el formulario no cambia de forma según la pantalla.
  const esquema = config.motivoObligatorio
    ? conMotivoObligatorio(CargarMovimientoFormSchema)
    : CargarMovimientoFormSchema;

  const form = useForm({
    resolver: zodResolver(esquema),
    defaultValues: valoresVacios(activa?.id ?? ''),
  });

  /**
   * useFieldArray maneja una LISTA de campos del formulario.
   *
   * Sin esto habría que llevar a mano un array en useState y sincronizarlo con
   * los inputs, los errores y la validación. `fields` trae un `id` propio por
   * fila (distinto del insumoId), y ese es el que va en el `key` de React: si
   * se usara el índice, borrar la línea 2 haría que React reutilizara los
   * inputs equivocados y el usuario vería valores saltar de fila.
   */
  const lineas = useFieldArray({ control: form.control, name: 'lineas' });

  const enviar = useMutation({
    mutationFn: config.enviar,
    onSuccess: async (datos) => {
      setResultado(datos);
      // Cambió el stock: todo lo que lo muestra quedó viejo.
      await queryClient.invalidateQueries({ queryKey: ['stock'] });
      await queryClient.invalidateQueries({ queryKey: ['alertas'] });
      await queryClient.invalidateQueries({ queryKey: ['reposicion'] });
      await queryClient.invalidateQueries({ queryKey: ['historial'] });
      form.reset(valoresVacios(activa?.id ?? ''));
    },
    onError: (error) => {
      // El 409 de stock insuficiente tiene su propio tratamiento: no es un
      // campo inválido, es un choque con la realidad, y la persona necesita
      // ver el número y poder decidir si fuerza.
      if (error instanceof ErrorDeApi && error.codigo === 'STOCK_INSUFICIENTE') {
        setFaltaStock(error.mensaje);
        return;
      }
      setErrorGeneral(aplicarErroresDelServidor(error, form.setError));
    },
  });

  if (!puede) {
    return <MensajeError>No tenés permiso para esta operación.</MensajeError>;
  }
  if (activa === null) {
    return <MensajeError>No tenés ninguna sucursal asignada.</MensajeError>;
  }

  // Se copia a una constante para que TypeScript sepa que no es null adentro de
  // las funciones de abajo: un valor que viene de un hook podría cambiar entre
  // el chequeo y el uso, así que el compilador no lo estrecha solo.
  const sucursalId = activa.id;

  /** Los insumos que ya están en alguna línea: no se ofrecen de nuevo. */
  const yaElegidos = new Set(
    form
      .watch('lineas')
      .map((linea) => linea.insumoId)
      .filter((id) => id !== ''),
  );

  function enviarCon(forzar: boolean): void {
    setErrorGeneral(null);
    setFaltaStock(null);
    setResultado(null);
    void form.handleSubmit((valores) => {
      // El sucursalId se vuelve a poner desde la sucursal activa: es el único
      // valor del formulario que no se edita, y no queremos que un estado
      // viejo mande la carga a otra sucursal.
      enviar.mutate({ ...valores, sucursalId, forzar });
    })();
  }

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div>
        <Link to="/stock" className="text-sm text-corteza dark:text-corteza-claro hover:underline">
          ← Volver al stock
        </Link>
        <h1 className="mt-1 text-2xl font-bold text-slate-900 dark:text-slate-50">
          {config.titulo}
        </h1>
        <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
          {config.ayuda} Sucursal: <strong>{activa.nombre}</strong>.
        </p>
      </div>

      {resultado !== null && <Confirmacion resultado={resultado} />}

      <form
        // Acá no hace falta `alEnviar`: `enviarCon` ya descarta la promesa de
        // handleSubmit con `void`, así que este manejador no devuelve nada.
        onSubmit={(evento) => {
          evento.preventDefault();
          enviarCon(false);
        }}
        noValidate
        className="space-y-4"
      >
        <Tarjeta titulo="Qué y cuánto">
          <div className="space-y-3">
            {/* Si la lista no carga, decirlo: un desplegable vacío sin
                explicación fue exactamente el bug del límite de 200. */}
            {insumos.isError && (
              <MensajeError>
                No se pudo cargar la lista de insumos: {insumos.error.message}
              </MensajeError>
            )}
            {lineas.fields.map((campo, indice) => (
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
                    {(insumos.data?.items ?? [])
                      .filter(
                        (insumo) =>
                          insumo.activo &&
                          (!yaElegidos.has(insumo.id) ||
                            form.watch(
                              `lineas.${String(indice)}.insumoId` as 'lineas.0.insumoId',
                            ) === insumo.id),
                      )
                      .map((insumo) => (
                        <option key={insumo.id} value={insumo.id}>
                          {insumo.nombre} ({insumo.unidadBase.codigo})
                        </option>
                      ))}
                  </select>
                </Campo>

                <Campo
                  etiqueta={indice === 0 ? 'Cantidad' : ''}
                  error={form.formState.errors.lineas?.[indice]?.cantidad?.message}
                >
                  {/* inputMode="decimal" levanta el teclado numérico en la
                      tablet. Es texto y no type="number" porque aceptamos la
                      coma decimal, como se escribe acá. */}
                  <input
                    type="text"
                    inputMode="decimal"
                    placeholder="0,000"
                    className={CLASE_CONTROL}
                    {...form.register(`lineas.${String(indice)}.cantidad` as 'lineas.0.cantidad')}
                  />
                </Campo>

                <Campo
                  etiqueta={indice === 0 ? 'Unidad' : ''}
                  error={form.formState.errors.lineas?.[indice]?.unidadId?.message}
                >
                  <select
                    className={CLASE_CONTROL}
                    {...form.register(`lineas.${String(indice)}.unidadId` as 'lineas.0.unidadId')}
                  >
                    <option value="">La del insumo</option>
                    {(unidades.data ?? []).map((unidad) => (
                      <option key={unidad.id} value={unidad.id}>
                        {unidad.codigo}
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
                    className="min-h-12 rounded-xl px-4 text-slate-600 dark:text-slate-400 hover:bg-slate-100 disabled:opacity-30 dark:hover:bg-slate-800"
                  >
                    Quitar
                  </button>
                </div>
              </div>
            ))}

            {mensajeDeLineas(form.formState.errors.lineas) !== null && (
              <MensajeError>{mensajeDeLineas(form.formState.errors.lineas)}</MensajeError>
            )}

            <button
              type="button"
              onClick={() => {
                lineas.append({ insumoId: '', cantidad: '', unidadId: '', notas: '' });
              }}
              className={CLASE_BOTON_SECUNDARIO}
            >
              + Agregar otra línea
            </button>
          </div>
        </Tarjeta>

        <Tarjeta titulo="Detalles">
          <div className="grid gap-4 sm:grid-cols-2">
            {config.tipoMotivo !== null && (
              <Campo
                etiqueta={config.motivoObligatorio ? 'Motivo' : 'Motivo (opcional)'}
                error={form.formState.errors.motivoId?.message}
              >
                <select className={CLASE_CONTROL} {...form.register('motivoId')}>
                  <option value="">
                    {config.motivoObligatorio ? 'Elegí un motivo' : 'Sin motivo'}
                  </option>
                  {(motivos.data ?? []).map((motivo) => (
                    <option key={motivo.id} value={motivo.id}>
                      {motivo.nombre}
                    </option>
                  ))}
                </select>
              </Campo>
            )}

            <Campo
              etiqueta="Fecha y hora (opcional)"
              ayuda="Si el hecho fue antes, ponelo. Vacío = ahora."
              error={form.formState.errors.fecha?.message}
            >
              {/* datetime-local da el selector nativo del sistema. Manda la
                  hora LOCAL sin zona, así que se convierte a UTC al enviar. */}
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
              <Campo etiqueta="Notas (opcional)" error={form.formState.errors.notas?.message}>
                <input
                  type="text"
                  placeholder="Turno mañana, pedido especial..."
                  className={CLASE_CONTROL}
                  {...form.register('notas')}
                />
              </Campo>
            </div>
          </div>
        </Tarjeta>

        {errorGeneral !== null && <MensajeError>{errorGeneral}</MensajeError>}

        {faltaStock !== null && (
          <div className="rounded-xl bg-amber-50 p-4 dark:bg-amber-950/40">
            <p className="font-semibold text-amber-900 dark:text-amber-200">No hay stock</p>
            <p className="mt-1 text-sm text-amber-900 dark:text-amber-200">{faltaStock}</p>
            {puedeForzar ? (
              <>
                <p className="mt-3 text-sm text-amber-900 dark:text-amber-200">
                  Si en el depósito sí está (por ejemplo, falta cargar una compra), podés
                  registrarlo igual. El stock va a quedar en negativo y la operación queda
                  registrada con tu nombre.
                </p>
                <button
                  type="button"
                  onClick={() => {
                    enviarCon(true);
                  }}
                  disabled={enviar.isPending}
                  className={`${CLASE_BOTON_PELIGRO} mt-3`}
                >
                  Registrar igual (queda en negativo)
                </button>
              </>
            ) : (
              <p className="mt-3 text-sm text-amber-900 dark:text-amber-200">
                Avisale al encargado: solo él puede registrarlo con el stock en negativo.
              </p>
            )}
          </div>
        )}

        <div className="flex flex-wrap justify-end gap-2">
          <Link to="/stock" className={`${CLASE_BOTON_SECUNDARIO} grid place-items-center`}>
            Cancelar
          </Link>
          <button type="submit" disabled={enviar.isPending} className={CLASE_BOTON_PRIMARIO}>
            {enviar.isPending ? 'Guardando...' : config.textoBoton}
          </button>
        </div>
      </form>
    </div>
  );
}

/**
 * Lo que quedó después de la carga.
 *
 * Mostrar el saldo nuevo es la confirmación de que lo que cargó tuvo el efecto
 * que esperaba. Es el dato que viene en la respuesta de la API, sin otro pedido.
 */
function Confirmacion({ resultado }: { resultado: ResultadoCarga }) {
  return (
    <div className="rounded-2xl bg-emerald-50 p-4 dark:bg-emerald-950/40">
      <p className="font-semibold text-emerald-900 dark:text-emerald-200">
        Registrado: {String(resultado.movimientos.length)}{' '}
        {resultado.movimientos.length === 1 ? 'línea' : 'líneas'}.
      </p>
      <ul className="mt-2 space-y-1 text-sm">
        {resultado.saldos.map((saldo) => (
          <li key={saldo.insumoId} className="flex items-baseline justify-between gap-3">
            <span className="text-emerald-900 dark:text-emerald-200">{saldo.insumoNombre}</span>
            <span className="text-emerald-900 dark:text-emerald-200">
              queda <Saldo valor={saldo.saldo} unidad={saldo.unidadBaseCodigo} />
            </span>
          </li>
        ))}
      </ul>
      <p className="mt-2 text-xs text-emerald-800 dark:text-emerald-300">
        Movimientos de esta carga:{' '}
        {resultado.movimientos
          .map((m) => `${m.insumo.nombre} ${formatearCantidad(m.cantidadBase)}`)
          .join(' · ')}
      </p>
    </div>
  );
}
