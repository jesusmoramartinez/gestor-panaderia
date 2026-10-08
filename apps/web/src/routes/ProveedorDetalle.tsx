import { zodResolver } from '@hookform/resolvers/zod';
import {
  ActualizarProveedorInsumoSchema,
  ActualizarProveedorSchema,
  CrearProveedorInsumoSchema,
  formatearCantidad,
  formatearDinero,
  formatearFechaArgentina,
  type InsumoDeProveedor,
  type ProveedorDetalle as Proveedor,
  LIMITE_MAXIMO_LISTADO,
} from '@panaderia/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link, useParams } from 'react-router';

import { DialogoConfirmacion } from '../components/Dialogo';
import {
  alEnviar,
  Campo,
  CLASE_BOTON_PELIGRO,
  CLASE_BOTON_PRIMARIO,
  CLASE_BOTON_SECUNDARIO,
  CLASE_CONTROL,
  MensajeError,
  Tarjeta,
} from '../components/formulario';
import { usePuede } from '../hooks/useSesion';
import { listarInsumos, obtenerInsumo } from '../lib/catalogo';
import { aplicarErroresDelServidor } from '../lib/erroresFormulario';
import {
  actualizarAsociacion,
  actualizarProveedor,
  asociarInsumo,
  cambiarEstadoProveedor,
  obtenerProveedor,
} from '../lib/proveedores';

/**
 * Cuando una mutación devuelve el proveedor actualizado, lo guardamos en el
 * caché e invalidamos lo que quedó viejo: el listado de proveedores y la vista
 * espejo (los proveedores de cada insumo), que acaba de cambiar también.
 */
function useGuardarProveedor() {
  const queryClient = useQueryClient();
  return async (proveedor: Proveedor) => {
    queryClient.setQueryData(['proveedor', proveedor.id], proveedor);
    await queryClient.invalidateQueries({ queryKey: ['proveedores'] });
    await queryClient.invalidateQueries({ queryKey: ['proveedoresDeInsumo'] });
  };
}

export function ProveedorDetalle() {
  const { id = '' } = useParams();
  const puedeEditar = usePuede('proveedor:editar');
  const guardar = useGuardarProveedor();
  const [confirmando, setConfirmando] = useState(false);

  const consulta = useQuery({ queryKey: ['proveedor', id], queryFn: () => obtenerProveedor(id) });

  const cambiarEstado = useMutation({
    mutationFn: (activo: boolean) => cambiarEstadoProveedor(id, activo),
    onSuccess: async (proveedor) => {
      await guardar(proveedor);
      setConfirmando(false);
    },
  });

  if (consulta.isPending) {
    return <p className="text-slate-600 dark:text-slate-400">Cargando proveedor...</p>;
  }
  if (consulta.isError || !consulta.data) {
    return (
      <div className="space-y-3">
        <MensajeError>{consulta.error?.message ?? 'No se encontró el proveedor.'}</MensajeError>
        <Link
          to="/proveedores"
          className="text-sm text-corteza dark:text-corteza-claro hover:underline"
        >
          ← Volver a proveedores
        </Link>
      </div>
    );
  }

  const proveedor = consulta.data;

  return (
    <div className="space-y-4">
      <div>
        <Link
          to="/proveedores"
          className="text-sm text-corteza dark:text-corteza-claro hover:underline"
        >
          ← Volver a proveedores
        </Link>
        <div className="mt-1 flex flex-wrap items-center gap-3">
          <h1 className="mr-auto text-2xl font-bold text-slate-900 dark:text-slate-50">
            {proveedor.nombre}
          </h1>
          {!proveedor.activo && (
            <span className="rounded-full bg-slate-200 px-3 py-1 text-sm font-semibold text-slate-600 dark:bg-slate-700 dark:text-slate-300">
              inactivo
            </span>
          )}
          {puedeEditar &&
            (proveedor.activo ? (
              <button
                type="button"
                onClick={() => {
                  setConfirmando(true);
                }}
                className={CLASE_BOTON_PELIGRO}
              >
                Desactivar
              </button>
            ) : (
              <button
                type="button"
                onClick={() => {
                  cambiarEstado.mutate(true);
                }}
                disabled={cambiarEstado.isPending}
                className={CLASE_BOTON_SECUNDARIO}
              >
                Reactivar
              </button>
            ))}
        </div>
        {proveedor.razonSocial !== null && (
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
            {proveedor.razonSocial}
            {proveedor.cuit !== null && ` · CUIT ${proveedor.cuit}`}
          </p>
        )}
      </div>

      <DatosProveedor proveedor={proveedor} puedeEditar={puedeEditar} />
      <InsumosDelProveedor proveedor={proveedor} puedeEditar={puedeEditar} />

      <DialogoConfirmacion
        abierto={confirmando}
        titulo={`¿Desactivar "${proveedor.nombre}"?`}
        textoConfirmar="Desactivar"
        trabajando={cambiarEstado.isPending}
        onConfirmar={() => {
          cambiarEstado.mutate(false);
        }}
        onCancelar={() => {
          setConfirmando(false);
        }}
      >
        <p>
          No se borra: deja de aparecer en las listas y sus insumos dejan de estar marcados como
          &quot;preferido&quot;, pero el historial de precios queda y se puede reactivar.
        </p>
      </DialogoConfirmacion>
    </div>
  );
}

// ===========================================================================

function DatosProveedor({
  proveedor,
  puedeEditar,
}: {
  proveedor: Proveedor;
  puedeEditar: boolean;
}) {
  const guardar = useGuardarProveedor();
  const [errorGeneral, setErrorGeneral] = useState<string | null>(null);
  const [guardado, setGuardado] = useState(false);

  /** Los valores del formulario a partir del proveedor: null → '' para los inputs. */
  function valoresDe(fila: Proveedor) {
    return {
      nombre: fila.nombre,
      razonSocial: fila.razonSocial ?? '',
      cuit: fila.cuit ?? '',
      email: fila.email ?? '',
      telefono: fila.telefono ?? '',
      direccion: fila.direccion ?? '',
      contactoNombre: fila.contactoNombre ?? '',
      diasEntrega: fila.diasEntrega === null ? '' : String(fila.diasEntrega),
      notas: fila.notas ?? '',
    };
  }

  const form = useForm({
    resolver: zodResolver(ActualizarProveedorSchema),
    defaultValues: valoresDe(proveedor),
  });

  const actualizar = useMutation({
    mutationFn: (valores: Parameters<typeof actualizarProveedor>[1]) =>
      actualizarProveedor(proveedor.id, valores),
    onSuccess: async (actualizado) => {
      await guardar(actualizado);
      setGuardado(true);
      form.reset(valoresDe(actualizado));
    },
    onError: (error) => {
      setErrorGeneral(aplicarErroresDelServidor(error, form.setError));
    },
  });

  return (
    <Tarjeta titulo="Datos del proveedor">
      <form
        onSubmit={alEnviar(
          form.handleSubmit((valores) => {
            setErrorGeneral(null);
            setGuardado(false);
            actualizar.mutate(valores);
          }),
        )}
        noValidate
        className="space-y-4"
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Campo etiqueta="Nombre" error={form.formState.errors.nombre?.message}>
            <input
              type="text"
              disabled={!puedeEditar}
              className={CLASE_CONTROL}
              {...form.register('nombre')}
            />
          </Campo>

          <Campo etiqueta="Razón social" error={form.formState.errors.razonSocial?.message}>
            <input
              type="text"
              disabled={!puedeEditar}
              className={CLASE_CONTROL}
              {...form.register('razonSocial')}
            />
          </Campo>

          <Campo etiqueta="CUIT" error={form.formState.errors.cuit?.message}>
            <input
              type="text"
              inputMode="numeric"
              disabled={!puedeEditar}
              className={CLASE_CONTROL}
              {...form.register('cuit')}
            />
          </Campo>

          <Campo
            etiqueta="Días de entrega"
            ayuda="0 = en el día. Vacío = sin dato."
            error={form.formState.errors.diasEntrega?.message}
          >
            <input
              type="text"
              inputMode="numeric"
              disabled={!puedeEditar}
              className={CLASE_CONTROL}
              {...form.register('diasEntrega')}
            />
          </Campo>

          <Campo etiqueta="Contacto" error={form.formState.errors.contactoNombre?.message}>
            <input
              type="text"
              disabled={!puedeEditar}
              className={CLASE_CONTROL}
              {...form.register('contactoNombre')}
            />
          </Campo>

          <Campo etiqueta="Teléfono" error={form.formState.errors.telefono?.message}>
            <input
              type="tel"
              inputMode="tel"
              disabled={!puedeEditar}
              className={CLASE_CONTROL}
              {...form.register('telefono')}
            />
          </Campo>

          <Campo etiqueta="Email" error={form.formState.errors.email?.message}>
            <input
              type="email"
              inputMode="email"
              disabled={!puedeEditar}
              className={CLASE_CONTROL}
              {...form.register('email')}
            />
          </Campo>

          <Campo etiqueta="Dirección" error={form.formState.errors.direccion?.message}>
            <input
              type="text"
              disabled={!puedeEditar}
              className={CLASE_CONTROL}
              {...form.register('direccion')}
            />
          </Campo>

          <div className="sm:col-span-2">
            <Campo etiqueta="Notas" error={form.formState.errors.notas?.message}>
              <textarea
                rows={2}
                disabled={!puedeEditar}
                className={`${CLASE_CONTROL} py-2`}
                {...form.register('notas')}
              />
            </Campo>
          </div>
        </div>

        {errorGeneral !== null && <MensajeError>{errorGeneral}</MensajeError>}

        {puedeEditar && (
          <div className="flex items-center justify-end gap-3">
            {guardado && !form.formState.isDirty && (
              <span className="text-sm text-emerald-700 dark:text-emerald-400">Guardado</span>
            )}
            <button
              type="submit"
              disabled={actualizar.isPending || !form.formState.isDirty}
              className={CLASE_BOTON_PRIMARIO}
            >
              {actualizar.isPending ? 'Guardando...' : 'Guardar cambios'}
            </button>
          </div>
        )}
      </form>
    </Tarjeta>
  );
}

// ===========================================================================

function InsumosDelProveedor({
  proveedor,
  puedeEditar,
}: {
  proveedor: Proveedor;
  puedeEditar: boolean;
}) {
  const guardar = useGuardarProveedor();
  const [errorGeneral, setErrorGeneral] = useState<string | null>(null);

  const form = useForm({
    resolver: zodResolver(CrearProveedorInsumoSchema),
    defaultValues: {
      insumoId: '',
      presentacionId: '',
      codigoProveedor: '',
      ultimoPrecio: '',
      esPreferido: false,
    },
  });

  // El catálogo para el selector. Solo los activos: no tiene sentido asociar
  // un insumo dado de baja (la API además lo rechaza).
  const insumos = useQuery({
    queryKey: ['insumos', { limite: LIMITE_MAXIMO_LISTADO, desplazamiento: 0 }],
    queryFn: () => listarInsumos({ limite: LIMITE_MAXIMO_LISTADO, desplazamiento: 0 }),
  });

  // SELECT DEPENDIENTE: las presentaciones son las del insumo elegido, así que
  // hay que esperar a que elija uno y recién entonces pedir su ficha. `watch`
  // vuelve a dibujar el componente cuando ese campo cambia, y `enabled` evita
  // el pedido mientras no haya nada elegido.
  const insumoElegido = form.watch('insumoId');
  const detalleInsumo = useQuery({
    queryKey: ['insumo', insumoElegido],
    queryFn: () => obtenerInsumo(insumoElegido),
    enabled: insumoElegido !== '',
  });

  const agregar = useMutation({
    mutationFn: (valores: Parameters<typeof asociarInsumo>[1]) =>
      asociarInsumo(proveedor.id, valores),
    onSuccess: async (actualizado) => {
      await guardar(actualizado);
      form.reset();
    },
    onError: (error) => {
      setErrorGeneral(aplicarErroresDelServidor(error, form.setError));
    },
  });

  const yaAsociados = new Set(proveedor.insumos.map((fila) => fila.insumo.id));
  const presentaciones = (detalleInsumo.data?.presentaciones ?? []).filter((p) => p.activa);

  return (
    <Tarjeta titulo="Insumos que le compro">
      <p className="mb-4 text-sm text-slate-600 dark:text-slate-400">
        En qué presentación lo vende, a qué precio y con qué código lo pide. El precio sirve para
        comparar proveedores y para sugerir el importe al cargar una compra.
      </p>

      {proveedor.insumos.length === 0 ? (
        <p className="rounded-xl bg-slate-50 p-4 text-sm text-slate-500 dark:bg-slate-800/60 dark:text-slate-400">
          Todavía no le compramos nada.
        </p>
      ) : (
        <ul className="divide-y divide-slate-100 dark:divide-slate-800">
          {proveedor.insumos.map((fila) => (
            <FilaInsumo
              key={fila.id}
              proveedorId={proveedor.id}
              fila={fila}
              puedeEditar={puedeEditar}
            />
          ))}
        </ul>
      )}

      {puedeEditar && proveedor.activo && (
        <form
          onSubmit={alEnviar(
            form.handleSubmit((valores) => {
              setErrorGeneral(null);
              agregar.mutate(valores);
            }),
          )}
          noValidate
          className="mt-5 space-y-3 border-t border-slate-100 pt-5 dark:border-slate-800"
        >
          {insumos.isError && (
            <MensajeError>
              No se pudo cargar la lista de insumos: {insumos.error.message}
            </MensajeError>
          )}
          <div className="grid gap-3 sm:grid-cols-2">
            <Campo etiqueta="Insumo" error={form.formState.errors.insumoId?.message}>
              <select className={CLASE_CONTROL} {...form.register('insumoId')}>
                <option value="">Elegí un insumo</option>
                {(insumos.data?.items ?? [])
                  .filter((insumo) => insumo.activo && !yaAsociados.has(insumo.id))
                  .map((insumo) => (
                    <option key={insumo.id} value={insumo.id}>
                      {insumo.nombre} ({insumo.unidadBase.codigo})
                    </option>
                  ))}
              </select>
            </Campo>

            <Campo
              etiqueta="Presentación"
              ayuda="Vacío = lo vende en la unidad base."
              error={form.formState.errors.presentacionId?.message}
            >
              <select
                disabled={insumoElegido === '' || detalleInsumo.isPending}
                className={CLASE_CONTROL}
                {...form.register('presentacionId')}
              >
                <option value="">
                  {insumoElegido === '' ? 'Elegí primero el insumo' : 'En la unidad base'}
                </option>
                {presentaciones.map((presentacion) => (
                  <option key={presentacion.id} value={presentacion.id}>
                    {presentacion.nombre} ({formatearCantidad(presentacion.cantidadBase)}{' '}
                    {detalleInsumo.data?.unidadBase.codigo})
                  </option>
                ))}
              </select>
            </Campo>

            <Campo
              etiqueta="Código del proveedor"
              ayuda="El código del artículo en SU catálogo."
              error={form.formState.errors.codigoProveedor?.message}
            >
              <input
                type="text"
                placeholder="4412"
                className={CLASE_CONTROL}
                {...form.register('codigoProveedor')}
              />
            </Campo>

            <Campo
              etiqueta="Último precio"
              ayuda="De la presentación elegida. Vacío si no se sabe."
              error={form.formState.errors.ultimoPrecio?.message}
            >
              {/* inputMode="decimal" levanta el teclado numérico en la tablet.
                  Es texto y no type="number" porque aceptamos la coma. */}
              <input
                type="text"
                inputMode="decimal"
                placeholder="18500,00"
                className={CLASE_CONTROL}
                {...form.register('ultimoPrecio')}
              />
            </Campo>
          </div>

          <label className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-200">
            <input type="checkbox" className="size-5" {...form.register('esPreferido')} />
            Es el proveedor preferido para este insumo
          </label>

          {errorGeneral !== null && <MensajeError>{errorGeneral}</MensajeError>}

          <div className="flex justify-end">
            <button type="submit" disabled={agregar.isPending} className={CLASE_BOTON_PRIMARIO}>
              {agregar.isPending ? 'Agregando...' : 'Agregar insumo'}
            </button>
          </div>
        </form>
      )}
    </Tarjeta>
  );
}

// ===========================================================================

function FilaInsumo({
  proveedorId,
  fila,
  puedeEditar,
}: {
  proveedorId: string;
  fila: InsumoDeProveedor;
  puedeEditar: boolean;
}) {
  const guardar = useGuardarProveedor();
  const [editando, setEditando] = useState(false);
  const [errorGeneral, setErrorGeneral] = useState<string | null>(null);

  const form = useForm({
    resolver: zodResolver(ActualizarProveedorInsumoSchema),
    defaultValues: {
      presentacionId: fila.presentacion?.id ?? '',
      codigoProveedor: fila.codigoProveedor ?? '',
      ultimoPrecio: fila.ultimoPrecio ?? '',
    },
  });

  // Las presentaciones del insumo de ESTA fila, solo si se está editando.
  const detalleInsumo = useQuery({
    queryKey: ['insumo', fila.insumo.id],
    queryFn: () => obtenerInsumo(fila.insumo.id),
    enabled: editando,
  });

  const modificar = useMutation({
    mutationFn: (cambios: Parameters<typeof actualizarAsociacion>[2]) =>
      actualizarAsociacion(proveedorId, fila.id, cambios),
    onSuccess: async (actualizado) => {
      await guardar(actualizado);
      setEditando(false);
    },
    onError: (error) => {
      setErrorGeneral(aplicarErroresDelServidor(error, form.setError));
    },
  });

  return (
    <li className="py-3">
      <div className="flex min-h-12 flex-wrap items-center gap-x-3 gap-y-1">
        <Link
          to={`/insumos/${fila.insumo.id}`}
          className={
            fila.activo
              ? 'font-medium hover:underline'
              : 'text-slate-600 dark:text-slate-400 line-through hover:underline'
          }
        >
          {fila.insumo.nombre}
        </Link>

        <span className="text-sm text-slate-600 dark:text-slate-400">
          {fila.presentacion === null
            ? `por ${fila.insumo.unidadBaseCodigo}`
            : `${fila.presentacion.nombre} (${formatearCantidad(fila.presentacion.cantidadBase)} ${fila.insumo.unidadBaseCodigo})`}
        </span>

        {fila.codigoProveedor !== null && (
          <span className="font-mono text-xs text-slate-600 dark:text-slate-400">
            cód. {fila.codigoProveedor}
          </span>
        )}

        {fila.esPreferido && (
          <span className="rounded-full bg-corteza/15 px-2 py-0.5 text-xs font-semibold text-corteza dark:text-corteza-claro">
            preferido
          </span>
        )}

        <span className="ml-auto text-right">
          {fila.ultimoPrecio === null ? (
            <span className="text-sm text-slate-600 dark:text-slate-400">sin precio</span>
          ) : (
            <>
              <span className="font-semibold tabular-nums">
                {formatearDinero(fila.ultimoPrecio)}
              </span>
              {fila.ultimoPrecioAt !== null && (
                <span className="block text-xs text-slate-600 dark:text-slate-400">
                  {formatearFechaArgentina(new Date(fila.ultimoPrecioAt))}
                </span>
              )}
            </>
          )}
        </span>
      </div>

      {puedeEditar && !editando && (
        <div className="mt-1 flex flex-wrap gap-2">
          {fila.activo && !fila.esPreferido && (
            <button
              type="button"
              disabled={modificar.isPending}
              onClick={() => {
                modificar.mutate({ esPreferido: true });
              }}
              className="min-h-10 rounded-lg px-3 text-sm text-corteza dark:text-corteza-claro hover:underline disabled:opacity-50"
            >
              Marcar preferido
            </button>
          )}
          <button
            type="button"
            onClick={() => {
              setEditando(true);
            }}
            className="min-h-10 rounded-lg px-3 text-sm text-slate-600 hover:underline dark:text-slate-300"
          >
            Editar precio
          </button>
          <button
            type="button"
            disabled={modificar.isPending}
            onClick={() => {
              modificar.mutate({ activo: !fila.activo });
            }}
            className="min-h-10 rounded-lg px-3 text-sm text-slate-600 dark:text-slate-400 hover:underline disabled:opacity-50"
          >
            {fila.activo ? 'Ya no se lo compro' : 'Volver a comprarle'}
          </button>
        </div>
      )}

      {editando && (
        <form
          onSubmit={alEnviar(
            form.handleSubmit((valores) => {
              setErrorGeneral(null);
              modificar.mutate(valores);
            }),
          )}
          noValidate
          className="mt-3 rounded-xl border border-slate-200 p-3 dark:border-slate-700"
        >
          <div className="grid gap-3 sm:grid-cols-3">
            <Campo etiqueta="Presentación" error={form.formState.errors.presentacionId?.message}>
              <select
                disabled={detalleInsumo.isPending}
                className={CLASE_CONTROL}
                {...form.register('presentacionId')}
              >
                <option value="">En la unidad base</option>
                {(detalleInsumo.data?.presentaciones ?? [])
                  .filter((p) => p.activa || p.id === fila.presentacion?.id)
                  .map((presentacion) => (
                    <option key={presentacion.id} value={presentacion.id}>
                      {presentacion.nombre}
                    </option>
                  ))}
              </select>
            </Campo>

            <Campo etiqueta="Código" error={form.formState.errors.codigoProveedor?.message}>
              <input type="text" className={CLASE_CONTROL} {...form.register('codigoProveedor')} />
            </Campo>

            <Campo
              etiqueta="Último precio"
              ayuda="La fecha la pone el sistema."
              error={form.formState.errors.ultimoPrecio?.message}
            >
              <input
                type="text"
                inputMode="decimal"
                className={CLASE_CONTROL}
                {...form.register('ultimoPrecio')}
              />
            </Campo>
          </div>

          {errorGeneral !== null && (
            <div className="mt-3">{<MensajeError>{errorGeneral}</MensajeError>}</div>
          )}

          <div className="mt-3 flex flex-wrap justify-end gap-2">
            <button
              type="button"
              onClick={() => {
                setErrorGeneral(null);
                form.reset();
                setEditando(false);
              }}
              className={CLASE_BOTON_SECUNDARIO}
            >
              Cancelar
            </button>
            <button type="submit" disabled={modificar.isPending} className={CLASE_BOTON_PRIMARIO}>
              {modificar.isPending ? 'Guardando...' : 'Guardar'}
            </button>
          </div>
        </form>
      )}
    </li>
  );
}
