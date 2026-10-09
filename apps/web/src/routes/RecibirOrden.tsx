import { zodResolver } from '@hookform/resolvers/zod';
import {
  aRecepcionDeOrden,
  costoPorUnidadBase,
  esDecimalValido,
  formatearCantidad,
  formatearDinero,
  normalizarNumero,
  type OrdenDetalle,
  RecibirOrdenFormSchema,
} from '@panaderia/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link, useNavigate, useParams } from 'react-router';

import { textoCantidad } from '../components/compras';
import {
  Campo,
  CLASE_BOTON_PRIMARIO,
  CLASE_BOTON_SECUNDARIO,
  CLASE_CONTROL,
  MensajeError,
  Tarjeta,
} from '../components/formulario';
import { usePuede } from '../hooks/useSesion';
import { obtenerOrden, recibirOrden } from '../lib/compras';
import { aplicarErroresDelServidor } from '../lib/erroresFormulario';

/** Lo pendiente de cada línea, con el precio de la orden: "recibir todo". */
function todoLoPendiente(orden: OrdenDetalle) {
  return {
    fecha: '',
    numeroRemito: '',
    numeroFactura: '',
    notas: '',
    lineas: orden.lineas
      .filter((linea) => linea.pendienteBase !== '0')
      .map((linea) => ({
        lineaOrdenId: linea.id,
        cantidad: linea.pendiente,
        precioUnitario: linea.precioUnitario ?? '',
      })),
  };
}

/**
 * Recibir (todo o una parte de) una orden.
 *
 * La pantalla arranca con TODO lo pendiente cargado y el precio de la orden:
 * el caso más común es que llegó todo y al precio acordado, y ahí alcanza con
 * un solo botón. Si llegó menos, se corrige la cantidad; si no llegó un
 * insumo, se deja en cero. Si cambió el precio, se corrige (C-9): manda lo
 * que se pagó, no lo que se había pedido.
 */
export function RecibirOrden() {
  const { id = '' } = useParams();
  const navegar = useNavigate();
  const queryClient = useQueryClient();
  const puede = usePuede('compra:recibir');
  const [errorGeneral, setErrorGeneral] = useState<string | null>(null);

  const orden = useQuery({ queryKey: ['orden', id], queryFn: () => obtenerOrden(id) });

  const form = useForm({
    resolver: zodResolver(RecibirOrdenFormSchema),
    defaultValues: { fecha: '', numeroRemito: '', numeroFactura: '', notas: '', lineas: [] },
  });

  // Se precarga UNA vez, cuando llega la orden (mismo criterio que al editar).
  const cargado = useRef(false);
  useEffect(() => {
    if (cargado.current || !orden.data) return;
    form.reset(todoLoPendiente(orden.data));
    cargado.current = true;
  }, [orden.data, form]);

  const recibir = useMutation({
    mutationFn: (valores: Parameters<typeof aRecepcionDeOrden>[0]) =>
      recibirOrden(id, aRecepcionDeOrden(valores)),
    onSuccess: async (recepcion) => {
      for (const clave of [
        ['orden', id],
        ['ordenes'],
        ['recepciones'],
        ['stock'],
        ['alertas'],
        ['reposicion'],
        ['historial'],
        ['proveedor'],
        ['proveedoresDeInsumo'],
      ]) {
        await queryClient.invalidateQueries({ queryKey: clave });
      }
      await navegar(`/recepciones/${recepcion.id}`, { replace: true });
    },
    onError: (error) => {
      setErrorGeneral(aplicarErroresDelServidor(error, form.setError));
    },
  });

  if (!puede) return <MensajeError>No tenés permiso para recibir mercadería.</MensajeError>;
  if (orden.isError) return <MensajeError>{orden.error.message}</MensajeError>;
  if (orden.isPending) {
    return <p className="text-sm text-slate-600 dark:text-slate-400">Cargando la orden...</p>;
  }

  const datos = orden.data;
  if (!datos.acciones.includes('recibir')) {
    return (
      <MensajeError>
        La orden {datos.numero} no se puede recibir (está {datos.estado.toLowerCase()}).
      </MensajeError>
    );
  }

  const porId = new Map(datos.lineas.map((linea) => [linea.id, linea]));
  const valores = form.watch('lineas');
  const erroresLineas = form.formState.errors.lineas;

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <div>
        <Link
          to={`/compras/${datos.id}`}
          className="text-sm text-corteza hover:underline dark:text-corteza-claro"
        >
          ← Volver a la OC {datos.numero}
        </Link>
        <h1 className="mt-1 text-2xl font-bold text-slate-900 dark:text-slate-50">
          Recibir OC {datos.numero} · {datos.proveedor.nombre}
        </h1>
        <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
          Entra al stock de <strong>{datos.sucursal.nombre}</strong>. Lo que no llegó, dejalo en
          cero: queda pendiente para otra entrega.
        </p>
      </div>

      <form
        onSubmit={(evento) => {
          evento.preventDefault();
          setErrorGeneral(null);
          void form.handleSubmit((salida) => {
            recibir.mutate(salida);
          })(evento);
        }}
        noValidate
        className="space-y-4"
      >
        <Tarjeta titulo="Qué llegó">
          <div className="mb-3 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => {
                form.reset({ ...form.getValues(), lineas: todoLoPendiente(datos).lineas });
              }}
              className={CLASE_BOTON_SECUNDARIO}
            >
              Llegó todo
            </button>
            <button
              type="button"
              onClick={() => {
                form.reset({
                  ...form.getValues(),
                  lineas: form.getValues('lineas').map((linea) => ({ ...linea, cantidad: '0' })),
                });
              }}
              className={CLASE_BOTON_SECUNDARIO}
            >
              Poner todo en cero
            </button>
          </div>

          <ul className="space-y-3">
            {valores.map((valor, indice) => {
              const linea = porId.get(valor.lineaOrdenId);
              if (!linea) return null;
              const ruta = `lineas.${String(indice)}` as 'lineas.0';
              const unidad = linea.insumo.unidadBaseCodigo;
              const precio = normalizarNumero(valor.precioUnitario ?? '');
              const costo =
                linea.presentacion !== null && esDecimalValido(precio) && precio !== ''
                  ? formatearDinero(costoPorUnidadBase(precio, linea.factorConversion))
                  : null;

              return (
                <li
                  key={linea.id}
                  className="grid gap-3 rounded-xl border border-slate-200 p-3 sm:grid-cols-[2fr_1fr_1.2fr] dark:border-slate-700"
                >
                  <div>
                    <p className="font-medium">{linea.insumo.nombre}</p>
                    <p className="text-sm text-slate-600 dark:text-slate-400">
                      faltan{' '}
                      {textoCantidad(
                        linea.pendiente,
                        linea.presentacion,
                        unidad,
                        formatearCantidad,
                      )}
                    </p>
                  </div>
                  <Campo
                    etiqueta={linea.presentacion === null ? `Llegaron (${unidad})` : 'Llegaron'}
                    error={erroresLineas?.[indice]?.cantidad?.message}
                  >
                    <input
                      type="text"
                      inputMode="decimal"
                      className={CLASE_CONTROL}
                      {...form.register(`${ruta}.cantidad`)}
                    />
                  </Campo>
                  <Campo
                    etiqueta={linea.presentacion === null ? `Precio por ${unidad}` : 'Precio c/u'}
                    error={erroresLineas?.[indice]?.precioUnitario?.message}
                    ayuda={costo === null ? undefined : `= ${costo} por ${unidad}`}
                  >
                    <input
                      type="text"
                      inputMode="decimal"
                      className={CLASE_CONTROL}
                      {...form.register(`${ruta}.precioUnitario`)}
                    />
                  </Campo>
                </li>
              );
            })}
          </ul>

          {typeof erroresLineas?.root?.message === 'string' && (
            <div className="mt-3">
              <MensajeError>{erroresLineas.root.message}</MensajeError>
            </div>
          )}
          {typeof erroresLineas?.message === 'string' && (
            <div className="mt-3">
              <MensajeError>{erroresLineas.message}</MensajeError>
            </div>
          )}
        </Tarjeta>

        <Tarjeta titulo="Papeles">
          <div className="grid gap-4 sm:grid-cols-3">
            <Campo
              etiqueta="Número de remito (opcional)"
              error={form.formState.errors.numeroRemito?.message}
            >
              <input type="text" className={CLASE_CONTROL} {...form.register('numeroRemito')} />
            </Campo>
            <Campo
              etiqueta="Número de factura (opcional)"
              error={form.formState.errors.numeroFactura?.message}
            >
              <input type="text" className={CLASE_CONTROL} {...form.register('numeroFactura')} />
            </Campo>
            <Campo
              etiqueta="Cuándo llegó (opcional)"
              ayuda="Vacío = ahora."
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
            <div className="sm:col-span-3">
              <Campo etiqueta="Notas (opcional)" error={form.formState.errors.notas?.message}>
                <input type="text" className={CLASE_CONTROL} {...form.register('notas')} />
              </Campo>
            </div>
          </div>
        </Tarjeta>

        {errorGeneral !== null && <MensajeError>{errorGeneral}</MensajeError>}

        <div className="flex flex-wrap justify-end gap-2">
          <Link
            to={`/compras/${datos.id}`}
            className={`${CLASE_BOTON_SECUNDARIO} grid place-items-center`}
          >
            Cancelar
          </Link>
          <button type="submit" disabled={recibir.isPending} className={CLASE_BOTON_PRIMARIO}>
            {recibir.isPending ? 'Guardando...' : 'Registrar recepción'}
          </button>
        </div>
      </form>
    </div>
  );
}
