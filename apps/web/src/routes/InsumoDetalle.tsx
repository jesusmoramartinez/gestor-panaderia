import { zodResolver } from '@hookform/resolvers/zod';
import {
  ActualizarInsumoSchema,
  CrearPresentacionSchema,
  formatearCantidad,
  formatearDinero,
  formatearFechaArgentina,
  type InsumoDetalle as Insumo,
  type ParametrosPorSucursal,
  ParametrosSucursalSchema,
  type Presentacion,
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
import {
  actualizarInsumo,
  actualizarPresentacion,
  cambiarEstadoInsumo,
  crearPresentacion,
  definirParametrosSucursal,
  listarCategorias,
  obtenerInsumo,
} from '../lib/catalogo';
import { aplicarErroresDelServidor } from '../lib/erroresFormulario';
import { actualizarAsociacion, listarProveedoresDeInsumo } from '../lib/proveedores';

/**
 * Hook propio para no repetir en cada panel lo mismo: cuando una mutación
 * devuelve el insumo actualizado, se guarda en el caché y se invalida el
 * listado. Así la pantalla se refresca sola, sin recargar la página.
 */
function useGuardarInsumo() {
  const queryClient = useQueryClient();
  return async (insumo: Insumo) => {
    queryClient.setQueryData(['insumo', insumo.id], insumo);
    await queryClient.invalidateQueries({ queryKey: ['insumos'] });
  };
}

export function InsumoDetalle() {
  const { id = '' } = useParams();
  const puedeEditar = usePuede('insumo:editar');
  const guardar = useGuardarInsumo();
  const [confirmando, setConfirmando] = useState(false);

  const consulta = useQuery({ queryKey: ['insumo', id], queryFn: () => obtenerInsumo(id) });

  const cambiarEstado = useMutation({
    mutationFn: (activo: boolean) => cambiarEstadoInsumo(id, activo),
    onSuccess: async (insumo) => {
      await guardar(insumo);
      setConfirmando(false);
    },
  });

  if (consulta.isPending) {
    return <p className="text-slate-500 dark:text-slate-400">Cargando insumo...</p>;
  }
  if (consulta.isError || !consulta.data) {
    return (
      <div className="space-y-3">
        <MensajeError>{consulta.error?.message ?? 'No se encontró el insumo.'}</MensajeError>
        <Link to="/insumos" className="text-sm text-corteza hover:underline">
          ← Volver a insumos
        </Link>
      </div>
    );
  }

  const insumo = consulta.data;

  return (
    <div className="space-y-4">
      <div>
        <Link to="/insumos" className="text-sm text-corteza hover:underline">
          ← Volver a insumos
        </Link>
        <div className="mt-1 flex flex-wrap items-center gap-3">
          <h1 className="mr-auto text-2xl font-bold text-slate-900 dark:text-slate-50">
            {insumo.nombre}
          </h1>
          {!insumo.activo && (
            <span className="rounded-full bg-slate-200 px-3 py-1 text-sm font-semibold text-slate-600 dark:bg-slate-700 dark:text-slate-300">
              inactivo
            </span>
          )}
          {puedeEditar &&
            (insumo.activo ? (
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
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          El stock se lleva en <strong>{insumo.unidadBase.nombre.toLowerCase()}</strong> (
          {insumo.unidadBase.codigo})
        </p>
      </div>

      <DatosBasicos insumo={insumo} puedeEditar={puedeEditar} />
      <Presentaciones insumo={insumo} puedeEditar={puedeEditar} />
      <ProveedoresDelInsumo insumoId={insumo.id} unidad={insumo.unidadBase.codigo} />
      <MinimosPorSucursal insumo={insumo} puedeEditar={puedeEditar} />

      <DialogoConfirmacion
        abierto={confirmando}
        titulo={`¿Desactivar "${insumo.nombre}"?`}
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
          No se borra: deja de aparecer en los formularios pero sigue en el historial y se puede
          reactivar cuando quieras.
        </p>
      </DialogoConfirmacion>
    </div>
  );
}

// ===========================================================================

function DatosBasicos({ insumo, puedeEditar }: { insumo: Insumo; puedeEditar: boolean }) {
  const guardar = useGuardarInsumo();
  const [errorGeneral, setErrorGeneral] = useState<string | null>(null);
  const [guardado, setGuardado] = useState(false);

  const categorias = useQuery({ queryKey: ['categorias'], queryFn: listarCategorias });

  const form = useForm({
    resolver: zodResolver(ActualizarInsumoSchema),
    defaultValues: {
      nombre: insumo.nombre,
      codigo: insumo.codigo ?? '',
      categoriaId: insumo.categoria?.id ?? '',
    },
  });

  const actualizar = useMutation({
    mutationFn: (valores: Parameters<typeof actualizarInsumo>[1]) =>
      actualizarInsumo(insumo.id, valores),
    onSuccess: async (actualizado) => {
      await guardar(actualizado);
      setGuardado(true);
      form.reset({
        nombre: actualizado.nombre,
        codigo: actualizado.codigo ?? '',
        categoriaId: actualizado.categoria?.id ?? '',
      });
    },
    onError: (error) => {
      setErrorGeneral(aplicarErroresDelServidor(error, form.setError));
    },
  });

  return (
    <Tarjeta titulo="Datos del insumo">
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

          <Campo etiqueta="Código" error={form.formState.errors.codigo?.message}>
            <input
              type="text"
              disabled={!puedeEditar}
              className={CLASE_CONTROL}
              {...form.register('codigo')}
            />
          </Campo>

          <Campo etiqueta="Categoría" error={form.formState.errors.categoriaId?.message}>
            <select
              disabled={!puedeEditar}
              className={CLASE_CONTROL}
              {...form.register('categoriaId')}
            >
              <option value="">Sin categoría</option>
              {(categorias.data ?? []).map((categoria) => (
                <option key={categoria.id} value={categoria.id}>
                  {categoria.nombre}
                </option>
              ))}
            </select>
          </Campo>

          <Campo
            etiqueta="Unidad base"
            ayuda="No se puede cambiar: todos los movimientos están guardados en esta unidad."
          >
            <input
              type="text"
              readOnly
              disabled
              value={`${insumo.unidadBase.nombre} (${insumo.unidadBase.codigo})`}
              className={CLASE_CONTROL}
            />
          </Campo>
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

function Presentaciones({ insumo, puedeEditar }: { insumo: Insumo; puedeEditar: boolean }) {
  const guardar = useGuardarInsumo();
  const [errorGeneral, setErrorGeneral] = useState<string | null>(null);

  const form = useForm({
    resolver: zodResolver(CrearPresentacionSchema),
    defaultValues: { nombre: '', cantidadBase: '', esDefault: false },
  });

  const agregar = useMutation({
    mutationFn: (valores: Parameters<typeof crearPresentacion>[1]) =>
      crearPresentacion(insumo.id, valores),
    onSuccess: async (actualizado) => {
      await guardar(actualizado);
      form.reset();
    },
    onError: (error) => {
      setErrorGeneral(aplicarErroresDelServidor(error, form.setError));
    },
  });

  const modificar = useMutation({
    mutationFn: ({
      presentacionId,
      cambios,
    }: {
      presentacionId: string;
      cambios: Parameters<typeof actualizarPresentacion>[2];
    }) => actualizarPresentacion(insumo.id, presentacionId, cambios),
    onSuccess: guardar,
  });

  return (
    <Tarjeta titulo="Presentaciones de compra">
      <p className="mb-4 text-sm text-slate-500 dark:text-slate-400">
        Cómo se compra este insumo. Al recibir una compra vas a cargar la cantidad en estas
        unidades, y el sistema la convierte a {insumo.unidadBase.codigo} para el stock.
      </p>

      {insumo.presentaciones.length === 0 ? (
        <p className="rounded-xl bg-slate-50 p-4 text-sm text-slate-500 dark:bg-slate-800/60 dark:text-slate-400">
          Todavía no tiene presentaciones.
        </p>
      ) : (
        <ul className="divide-y divide-slate-100 dark:divide-slate-800">
          {insumo.presentaciones.map((presentacion) => (
            <FilaPresentacion
              key={presentacion.id}
              presentacion={presentacion}
              unidad={insumo.unidadBase.codigo}
              puedeEditar={puedeEditar}
              trabajando={modificar.isPending}
              onCambiar={(cambios) => {
                modificar.mutate({ presentacionId: presentacion.id, cambios });
              }}
            />
          ))}
        </ul>
      )}

      {puedeEditar && (
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
          <div className="grid gap-3 sm:grid-cols-[2fr_1fr_auto]">
            <Campo etiqueta="Nombre" error={form.formState.errors.nombre?.message}>
              <input
                type="text"
                placeholder="Bolsa 25 kg"
                className={CLASE_CONTROL}
                {...form.register('nombre')}
              />
            </Campo>

            <Campo
              etiqueta={`Cuánto trae (${insumo.unidadBase.codigo})`}
              error={form.formState.errors.cantidadBase?.message}
            >
              {/* inputMode="decimal" levanta el teclado numérico en la tablet.
                  Es un campo de texto y no type="number" porque aceptamos la
                  coma decimal, como se escribe acá. */}
              <input
                type="text"
                inputMode="decimal"
                placeholder="25"
                className={CLASE_CONTROL}
                {...form.register('cantidadBase')}
              />
            </Campo>

            <div className="flex items-end">
              <button type="submit" disabled={agregar.isPending} className={CLASE_BOTON_PRIMARIO}>
                {agregar.isPending ? 'Agregando...' : 'Agregar'}
              </button>
            </div>
          </div>

          <label className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-200">
            <input type="checkbox" className="size-5" {...form.register('esDefault')} />
            Usar como presentación por defecto al comprar
          </label>

          {errorGeneral !== null && <MensajeError>{errorGeneral}</MensajeError>}
        </form>
      )}
    </Tarjeta>
  );
}

function FilaPresentacion({
  presentacion,
  unidad,
  puedeEditar,
  trabajando,
  onCambiar,
}: {
  presentacion: Presentacion;
  unidad: string;
  puedeEditar: boolean;
  trabajando: boolean;
  onCambiar: (cambios: { esDefault?: boolean; activa?: boolean }) => void;
}) {
  return (
    <li className="flex min-h-14 flex-wrap items-center gap-3 py-2">
      <span className={presentacion.activa ? 'font-medium' : 'text-slate-400 line-through'}>
        {presentacion.nombre}
      </span>
      <span className="text-sm text-slate-500 dark:text-slate-400">
        trae {formatearCantidad(presentacion.cantidadBase)} {unidad}
      </span>
      {presentacion.esDefault && (
        <span className="rounded-full bg-corteza/15 px-2 py-0.5 text-xs font-semibold text-corteza">
          por defecto
        </span>
      )}

      {puedeEditar && (
        <span className="ml-auto flex gap-2">
          {presentacion.activa && !presentacion.esDefault && (
            <button
              type="button"
              disabled={trabajando}
              onClick={() => {
                onCambiar({ esDefault: true });
              }}
              className="min-h-10 rounded-lg px-3 text-sm text-corteza hover:underline disabled:opacity-50"
            >
              Usar por defecto
            </button>
          )}
          <button
            type="button"
            disabled={trabajando}
            onClick={() => {
              onCambiar({ activa: !presentacion.activa });
            }}
            className="min-h-10 rounded-lg px-3 text-sm text-slate-500 hover:underline disabled:opacity-50 dark:text-slate-400"
          >
            {presentacion.activa ? 'Desactivar' : 'Reactivar'}
          </button>
        </span>
      )}
    </li>
  );
}

// ===========================================================================

function MinimosPorSucursal({ insumo, puedeEditar }: { insumo: Insumo; puedeEditar: boolean }) {
  return (
    <Tarjeta titulo="Stock mínimo por sucursal">
      <p className="mb-4 text-sm text-slate-500 dark:text-slate-400">
        Por debajo del mínimo, el insumo va a aparecer en la lista de reposición de esa sucursal. La
        central suele necesitar más que el local.
      </p>
      <div className="space-y-5">
        {insumo.porSucursal.map((parametros) => (
          <FormularioParametros
            key={parametros.sucursalId}
            insumoId={insumo.id}
            unidad={insumo.unidadBase.codigo}
            parametros={parametros}
            puedeEditar={puedeEditar}
          />
        ))}
      </div>
    </Tarjeta>
  );
}

function FormularioParametros({
  insumoId,
  unidad,
  parametros,
  puedeEditar,
}: {
  insumoId: string;
  unidad: string;
  parametros: ParametrosPorSucursal;
  puedeEditar: boolean;
}) {
  const guardar = useGuardarInsumo();
  const [errorGeneral, setErrorGeneral] = useState<string | null>(null);
  const [guardado, setGuardado] = useState(false);

  const form = useForm({
    resolver: zodResolver(ParametrosSucursalSchema),
    defaultValues: {
      stockMinimo: parametros.stockMinimo,
      stockMaximo: parametros.stockMaximo ?? '',
      ubicacion: parametros.ubicacion ?? '',
      activo: parametros.activo,
    },
  });

  const definir = useMutation({
    mutationFn: (valores: Parameters<typeof definirParametrosSucursal>[2]) =>
      definirParametrosSucursal(insumoId, parametros.sucursalId, valores),
    onSuccess: async (actualizado) => {
      await guardar(actualizado);
      setGuardado(true);
      form.reset(form.getValues());
    },
    onError: (error) => {
      setErrorGeneral(aplicarErroresDelServidor(error, form.setError));
    },
  });

  return (
    <form
      onSubmit={alEnviar(
        form.handleSubmit((valores) => {
          setErrorGeneral(null);
          setGuardado(false);
          definir.mutate(valores);
        }),
      )}
      noValidate
      className="rounded-xl border border-slate-200 p-4 dark:border-slate-700"
    >
      <h3 className="mb-3 font-semibold text-slate-900 dark:text-slate-100">
        {parametros.sucursalNombre}
        <span className="ml-2 font-mono text-xs text-slate-400">{parametros.sucursalCodigo}</span>
      </h3>

      <div className="grid gap-3 sm:grid-cols-3">
        <Campo etiqueta={`Mínimo (${unidad})`} error={form.formState.errors.stockMinimo?.message}>
          <input
            type="text"
            inputMode="decimal"
            disabled={!puedeEditar}
            className={CLASE_CONTROL}
            {...form.register('stockMinimo')}
          />
        </Campo>

        <Campo
          etiqueta={`Máximo (${unidad}, opcional)`}
          error={form.formState.errors.stockMaximo?.message}
        >
          <input
            type="text"
            inputMode="decimal"
            disabled={!puedeEditar}
            className={CLASE_CONTROL}
            {...form.register('stockMaximo')}
          />
        </Campo>

        <Campo etiqueta="Ubicación" error={form.formState.errors.ubicacion?.message}>
          <input
            type="text"
            placeholder="Depósito B, estante 3"
            disabled={!puedeEditar}
            className={CLASE_CONTROL}
            {...form.register('ubicacion')}
          />
        </Campo>
      </div>

      {errorGeneral !== null && (
        <div className="mt-3">{<MensajeError>{errorGeneral}</MensajeError>}</div>
      )}

      {puedeEditar && (
        <div className="mt-3 flex items-center justify-end gap-3">
          {guardado && !form.formState.isDirty && (
            <span className="text-sm text-emerald-700 dark:text-emerald-400">Guardado</span>
          )}
          <button
            type="submit"
            disabled={definir.isPending || !form.formState.isDirty}
            className={CLASE_BOTON_SECUNDARIO}
          >
            {definir.isPending ? 'Guardando...' : 'Guardar'}
          </button>
        </div>
      )}
    </form>
  );
}

// ===========================================================================
// LA VISTA ESPEJO.
//
// Es la misma tabla puente que se ve en la ficha del proveedor, leída desde la
// otra punta. Las dos existen a propósito: el encargado que está mirando la
// harina quiere saber a quién se la compra, y el que está mirando al molino
// quiere saber qué le compra. Con una sola pantalla, siempre falta la otra.
// ===========================================================================

function ProveedoresDelInsumo({ insumoId, unidad }: { insumoId: string; unidad: string }) {
  const queryClient = useQueryClient();
  // El permiso de VER es propio de proveedores: estas filas llevan precios.
  const puedeVer = usePuede('proveedor:ver');
  const puedeEditar = usePuede('proveedor:editar');

  const consulta = useQuery({
    queryKey: ['proveedoresDeInsumo', insumoId],
    queryFn: () => listarProveedoresDeInsumo(insumoId),
    enabled: puedeVer,
  });

  const marcarPreferido = useMutation({
    mutationFn: ({ proveedorId, asociacionId }: { proveedorId: string; asociacionId: string }) =>
      actualizarAsociacion(proveedorId, asociacionId, { esPreferido: true }),
    onSuccess: async () => {
      // Cambió la fila puente: se invalidan las dos vistas que la muestran.
      await queryClient.invalidateQueries({ queryKey: ['proveedoresDeInsumo'] });
      await queryClient.invalidateQueries({ queryKey: ['proveedor'] });
    },
  });

  // Sin permiso no se pide el dato ni se dibuja la tarjeta: esconder el panel
  // no sería suficiente, pero no pedirlo sí lo es (la API igual lo rechaza).
  if (!puedeVer) return null;

  const filas = consulta.data ?? [];

  return (
    <Tarjeta titulo="Quién me lo provee">
      <p className="mb-4 text-sm text-slate-500 dark:text-slate-400">
        El <strong>preferido</strong> es el que se va a sugerir cuando este insumo aparezca en la
        lista de reposición.
      </p>

      {consulta.isPending && <p className="text-sm text-slate-500">Cargando proveedores...</p>}
      {consulta.isError && <MensajeError>{consulta.error.message}</MensajeError>}

      {consulta.isSuccess && filas.length === 0 && (
        <p className="rounded-xl bg-slate-50 p-4 text-sm text-slate-500 dark:bg-slate-800/60 dark:text-slate-400">
          Todavía no hay ningún proveedor cargado para este insumo. Se agrega desde la ficha del
          proveedor.
        </p>
      )}

      {filas.length > 0 && (
        <ul className="divide-y divide-slate-100 dark:divide-slate-800">
          {filas.map((fila) => (
            <li key={fila.id} className="flex min-h-14 flex-wrap items-center gap-x-3 gap-y-1 py-2">
              <Link
                to={`/proveedores/${fila.proveedor.id}`}
                className={
                  fila.activo
                    ? 'font-medium hover:underline'
                    : 'text-slate-400 line-through hover:underline'
                }
              >
                {fila.proveedor.nombre}
              </Link>

              <span className="text-sm text-slate-500 dark:text-slate-400">
                {fila.presentacion === null
                  ? `por ${unidad}`
                  : `${fila.presentacion.nombre} (${formatearCantidad(fila.presentacion.cantidadBase)} ${unidad})`}
              </span>

              <span className="text-xs text-slate-400">
                {fila.proveedor.diasEntrega === null
                  ? 'entrega: sin dato'
                  : fila.proveedor.diasEntrega === 0
                    ? 'entrega en el día'
                    : `entrega en ${String(fila.proveedor.diasEntrega)} d`}
              </span>

              {fila.esPreferido && (
                <span className="rounded-full bg-corteza/15 px-2 py-0.5 text-xs font-semibold text-corteza">
                  preferido
                </span>
              )}

              <span className="ml-auto text-right">
                {fila.ultimoPrecio === null ? (
                  <span className="text-sm text-slate-400">sin precio</span>
                ) : (
                  <>
                    <span className="font-semibold tabular-nums">
                      {formatearDinero(fila.ultimoPrecio)}
                    </span>
                    {fila.ultimoPrecioAt !== null && (
                      <span className="block text-xs text-slate-400">
                        {formatearFechaArgentina(new Date(fila.ultimoPrecioAt))}
                      </span>
                    )}
                  </>
                )}
              </span>

              {puedeEditar && fila.activo && !fila.esPreferido && (
                <button
                  type="button"
                  disabled={marcarPreferido.isPending}
                  onClick={() => {
                    marcarPreferido.mutate({
                      proveedorId: fila.proveedor.id,
                      asociacionId: fila.id,
                    });
                  }}
                  className="min-h-10 w-full rounded-lg px-3 text-left text-sm text-corteza hover:underline disabled:opacity-50 sm:w-auto sm:text-right"
                >
                  Marcar preferido
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </Tarjeta>
  );
}
