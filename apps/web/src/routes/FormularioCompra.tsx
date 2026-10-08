import { zodResolver } from '@hookform/resolvers/zod';
import {
  aDecimal,
  conNombreObligatorio,
  conPrecioObligatorio,
  costoPorUnidadBase,
  esDecimalValido,
  formatearDinero,
  FormularioCompraSchema,
  type InsumoDeProveedor,
  type InsumoResumen,
  normalizarNumero,
  type OrdenDetalle,
  type Plantilla,
  LIMITE_MAXIMO_LISTADO,
} from '@panaderia/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { useFieldArray, useForm, type UseFormReturn } from 'react-hook-form';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import type { z } from 'zod';

import { DialogoConfirmacion } from '../components/Dialogo';
import {
  Campo,
  CLASE_BOTON_PRIMARIO,
  CLASE_BOTON_SECUNDARIO,
  CLASE_CONTROL,
  MensajeError,
  Tarjeta,
} from '../components/formulario';
import { useSucursalActiva } from '../components/SucursalActiva';
import { usePuede } from '../hooks/useSesion';
import { listarInsumos, obtenerInsumo } from '../lib/catalogo';
import {
  crearOrden,
  crearPlantilla,
  editarOrden,
  editarPlantilla,
  obtenerOrden,
  obtenerPlantilla,
  recibirDirecta,
} from '../lib/compras';
import { aplicarErroresDelServidor } from '../lib/erroresFormulario';
import { listarProveedores, obtenerProveedor } from '../lib/proveedores';

/**
 * UNA pantalla de líneas de compra para cinco usos.
 *
 * Orden nueva, orden editada, recepción sin orden, plantilla nueva y plantilla
 * editada son el mismo formulario: a quién, para qué sucursal y una lista de
 * "insumo + presentación + cantidad (+ precio)". Lo que cambia es qué campos
 * se ven, si el precio es obligatorio y a qué endpoint va. Es la misma
 * decisión que la pantalla de cargas de la Fase 6: tres grillas multi-línea
 * separadas son tres lugares donde arreglar el mismo bug.
 */
export type ModoFormulario =
  'orden-nueva' | 'orden-editar' | 'recepcion' | 'plantilla-nueva' | 'plantilla-editar';

type Valores = z.input<typeof FormularioCompraSchema>;
type Salida = z.output<typeof FormularioCompraSchema>;
type Formulario = UseFormReturn<Valores, unknown, Salida>;

const CONFIGURACION: Record<
  ModoFormulario,
  {
    titulo: string;
    ayuda: string;
    volverA: string;
    volverTexto: string;
    conPrecio: boolean;
    permiso: 'compra:pedir' | 'compra:recibir';
  }
> = {
  'orden-nueva': {
    titulo: 'Nueva orden de compra',
    ayuda: 'Lo que le pedís al proveedor. NO suma stock: eso pasa cuando llega.',
    volverA: '/compras',
    volverTexto: 'Volver a compras',
    conPrecio: true,
    permiso: 'compra:pedir',
  },
  'orden-editar': {
    titulo: 'Editar orden de compra',
    ayuda: 'Se puede editar mientras no haya llegado nada.',
    volverA: '/compras',
    volverTexto: 'Volver a compras',
    conPrecio: true,
    permiso: 'compra:pedir',
  },
  recepcion: {
    titulo: 'Recepción sin orden',
    ayuda:
      'Llegó mercadería que no tenía orden (la compra por teléfono). Suma stock apenas la guardás.',
    volverA: '/compras',
    volverTexto: 'Volver a compras',
    conPrecio: true,
    permiso: 'compra:recibir',
  },
  'plantilla-nueva': {
    titulo: 'Nueva plantilla de pedido',
    ayuda: 'Un pedido que se repite. Sin precios: al usarla se sugiere el último que pagaste.',
    volverA: '/compras/plantillas',
    volverTexto: 'Volver a plantillas',
    conPrecio: false,
    permiso: 'compra:pedir',
  },
  'plantilla-editar': {
    titulo: 'Editar plantilla',
    ayuda: 'Los cambios valen para los pedidos que hagas desde ahora.',
    volverA: '/compras/plantillas',
    volverTexto: 'Volver a plantillas',
    conPrecio: false,
    permiso: 'compra:pedir',
  },
};

const LINEA_VACIA = { insumoId: '', presentacionId: '', cantidad: '', precioUnitario: '' };

function valoresVacios(sucursalId: string): Valores {
  return {
    nombre: '',
    proveedorId: '',
    sucursalId,
    fechaEntregaEstimada: '',
    fecha: '',
    numeroRemito: '',
    numeroFactura: '',
    notas: '',
    lineas: [{ ...LINEA_VACIA }],
  };
}

function desdeOrden(orden: OrdenDetalle): Valores {
  return {
    ...valoresVacios(orden.sucursal.id),
    proveedorId: orden.proveedor.id,
    fechaEntregaEstimada: orden.fechaEntregaEstimada ?? '',
    notas: orden.notas ?? '',
    lineas: orden.lineas.map((linea) => ({
      insumoId: linea.insumo.id,
      presentacionId: linea.presentacion?.id ?? '',
      cantidad: linea.cantidad,
      precioUnitario: linea.precioUnitario ?? '',
    })),
  };
}

function desdePlantilla(plantilla: Plantilla, conNombre: boolean): Valores {
  return {
    ...valoresVacios(plantilla.sucursal.id),
    nombre: conNombre ? plantilla.nombre : '',
    proveedorId: plantilla.proveedor.id,
    notas: plantilla.notas ?? '',
    // Sin precio: lo completa cada fila con el último que se le pagó.
    lineas: plantilla.lineas.map((linea) => ({
      insumoId: linea.insumo.id,
      presentacionId: linea.presentacion?.id ?? '',
      cantidad: linea.cantidad,
      precioUnitario: '',
    })),
  };
}

/** Igual que en las cargas de stock: el error de la lista entera (no de una fila). */
function mensajeDeLineas(errores: unknown): string | null {
  if (typeof errores !== 'object' || errores === null) return null;
  const como = errores as { message?: unknown; root?: { message?: unknown } };
  if (typeof como.message === 'string') return como.message;
  if (typeof como.root?.message === 'string') return como.root.message;
  return null;
}

/**
 * El precio en una recepción ya lo exigió el resolver (`conPrecioObligatorio`),
 * pero el TIPO no lo sabe. Mismo criterio que `enviarMerma` en la Fase 6:
 * lanzar es mejor que forzarlo con un cast.
 */
function precioObligatorio(precio: string | null): string {
  if (precio === null) throw new Error('Falta el precio de una línea');
  return precio;
}

function sinPrecio(lineas: Salida['lineas']) {
  return lineas.map(({ insumoId, presentacionId, cantidad }) => ({
    insumoId,
    presentacionId,
    cantidad,
  }));
}

export function FormularioCompra({ modo }: { modo: ModoFormulario }) {
  const config = CONFIGURACION[modo];
  const navegar = useNavigate();
  const queryClient = useQueryClient();
  const { id } = useParams();
  const [parametros] = useSearchParams();
  const { activa, sucursales } = useSucursalActiva();
  const puede = usePuede(config.permiso);
  const puedePedir = usePuede('compra:pedir');

  const [errorGeneral, setErrorGeneral] = useState<string | null>(null);
  // Qué botón se apretó en una orden nueva: "Crear pedido" o "Guardar borrador".
  const pedir = useRef(true);

  // ¿De dónde salen los valores iniciales? De la orden que se edita, de la
  // plantilla que se edita, o de la plantilla elegida para un pedido nuevo.
  const plantillaId =
    modo === 'plantilla-editar'
      ? (id ?? null)
      : modo === 'orden-nueva'
        ? parametros.get('plantilla')
        : null;

  const orden = useQuery({
    queryKey: ['orden', id],
    queryFn: () => obtenerOrden(id ?? ''),
    enabled: modo === 'orden-editar' && id !== undefined,
  });
  const plantilla = useQuery({
    queryKey: ['plantilla', plantillaId],
    queryFn: () => obtenerPlantilla(plantillaId ?? ''),
    enabled: plantillaId !== null,
  });
  const proveedores = useQuery({
    queryKey: ['proveedores', { soloActivos: true }],
    queryFn: () => listarProveedores({}),
  });
  const insumos = useQuery({
    queryKey: ['insumos', { limite: LIMITE_MAXIMO_LISTADO, desplazamiento: 0 }],
    queryFn: () => listarInsumos({ limite: LIMITE_MAXIMO_LISTADO, desplazamiento: 0 }),
  });

  const esquema =
    modo === 'recepcion'
      ? conPrecioObligatorio(FormularioCompraSchema)
      : modo === 'plantilla-nueva' || modo === 'plantilla-editar'
        ? conNombreObligatorio(FormularioCompraSchema)
        : FormularioCompraSchema;

  const form: Formulario = useForm({
    resolver: zodResolver(esquema),
    defaultValues: valoresVacios(activa?.id ?? ''),
  });
  const lineas = useFieldArray({ control: form.control, name: 'lineas' });

  // Cargar los valores iniciales UNA vez, cuando llegan. Sin la bandera, cada
  // vez que TanStack Query refrescara la orden en segundo plano se pisaría lo
  // que la persona está escribiendo.
  const cargado = useRef(false);
  useEffect(() => {
    if (cargado.current) return;
    if (modo === 'orden-editar' && orden.data) {
      form.reset(desdeOrden(orden.data));
      cargado.current = true;
    } else if (plantilla.data) {
      form.reset(desdePlantilla(plantilla.data, modo === 'plantilla-editar'));
      cargado.current = true;
    }
  }, [modo, orden.data, plantilla.data, form]);

  // El proveedor elegido trae, por cada insumo que vende, su presentación y el
  // último precio: es lo que precarga cada fila (C-13: el camino corto).
  const proveedorId = form.watch('proveedorId');
  const proveedor = useQuery({
    queryKey: ['proveedor', proveedorId],
    queryFn: () => obtenerProveedor(proveedorId),
    enabled: proveedorId !== '',
  });
  const asociaciones = new Map(
    (proveedor.data?.insumos ?? [])
      .filter((fila) => fila.activo)
      .map((fila) => [fila.insumo.id, fila]),
  );

  const alTerminar = async (destino: string, claves: string[][]) => {
    for (const clave of claves) await queryClient.invalidateQueries({ queryKey: clave });
    await navegar(destino, { replace: true });
  };

  const guardar = useMutation({
    mutationFn: async (valores: Salida): Promise<string> => {
      const cabecera = {
        proveedorId: valores.proveedorId,
        sucursalId: valores.sucursalId,
        notas: valores.notas,
      };
      switch (modo) {
        case 'orden-nueva':
          return (
            await crearOrden({
              ...cabecera,
              fechaEntregaEstimada: valores.fechaEntregaEstimada,
              pedir: pedir.current,
              lineas: valores.lineas,
            })
          ).id;
        case 'orden-editar':
          return (
            await editarOrden(id ?? '', {
              ...cabecera,
              fechaEntregaEstimada: valores.fechaEntregaEstimada,
              lineas: valores.lineas,
            })
          ).id;
        case 'recepcion':
          return (
            await recibirDirecta({
              ...cabecera,
              fecha: valores.fecha,
              numeroRemito: valores.numeroRemito,
              numeroFactura: valores.numeroFactura,
              lineas: valores.lineas.map((linea) => ({
                ...linea,
                precioUnitario: precioObligatorio(linea.precioUnitario),
              })),
            })
          ).id;
        case 'plantilla-nueva':
          return (
            await crearPlantilla({
              ...cabecera,
              nombre: valores.nombre,
              lineas: sinPrecio(valores.lineas),
            })
          ).id;
        case 'plantilla-editar':
          return (
            await editarPlantilla(id ?? '', {
              ...cabecera,
              nombre: valores.nombre,
              lineas: sinPrecio(valores.lineas),
            })
          ).id;
      }
    },
    onSuccess: async (idGuardado) => {
      if (modo === 'recepcion') {
        // Entró stock, cambió el costo y el último precio del proveedor.
        await alTerminar(`/recepciones/${idGuardado}`, [
          ['recepciones'],
          ['stock'],
          ['historial'],
          ['proveedor'],
          ['proveedoresDeInsumo'],
          ['costo'],
        ]);
      } else if (modo === 'orden-nueva' || modo === 'orden-editar') {
        await alTerminar(`/compras/${idGuardado}`, [['ordenes'], ['orden', idGuardado]]);
      } else {
        await alTerminar('/compras/plantillas', [['plantillas'], ['plantilla', idGuardado]]);
      }
    },
    onError: (error) => {
      setErrorGeneral(aplicarErroresDelServidor(error, form.setError));
    },
  });

  // --- "Guardar también como plantilla" (solo en una orden nueva). ---------
  const [paraPlantilla, setParaPlantilla] = useState<Salida | null>(null);
  const [nombrePlantilla, setNombrePlantilla] = useState('');
  const comoPlantilla = useMutation({
    mutationFn: (valores: Salida) =>
      crearPlantilla({
        nombre: nombrePlantilla,
        proveedorId: valores.proveedorId,
        sucursalId: valores.sucursalId,
        notas: valores.notas,
        lineas: sinPrecio(valores.lineas),
      }),
    onSuccess: async () => {
      setParaPlantilla(null);
      setNombrePlantilla('');
      await queryClient.invalidateQueries({ queryKey: ['plantillas'] });
    },
  });

  if (!puede) return <MensajeError>No tenés permiso para esta operación.</MensajeError>;
  if (activa === null) return <MensajeError>No tenés ninguna sucursal asignada.</MensajeError>;
  if (orden.isError) return <MensajeError>{orden.error.message}</MensajeError>;
  if (plantilla.isError) return <MensajeError>{plantilla.error.message}</MensajeError>;

  const esPlantilla = modo === 'plantilla-nueva' || modo === 'plantilla-editar';
  const esOrden = modo === 'orden-nueva' || modo === 'orden-editar';

  const valoresLineas = form.watch('lineas');
  const yaElegidos = new Set(valoresLineas.map((linea) => linea.insumoId).filter((v) => v !== ''));

  // El total, mientras se escribe: lo primero que quiere ver el dueño.
  const total = valoresLineas.reduce((suma, linea) => {
    const cantidad = normalizarNumero(linea.cantidad);
    const precio = normalizarNumero(linea.precioUnitario ?? '');
    if (!esDecimalValido(cantidad) || !esDecimalValido(precio)) return suma;
    return suma.plus(aDecimal(cantidad).times(aDecimal(precio)));
  }, aDecimal('0'));

  function enviar(conPedido: boolean): void {
    pedir.current = conPedido;
    setErrorGeneral(null);
    void form.handleSubmit((valores) => {
      guardar.mutate(valores);
    })();
  }

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <div>
        <Link
          to={config.volverA}
          className="text-sm text-corteza hover:underline dark:text-corteza-claro"
        >
          ← {config.volverTexto}
        </Link>
        <h1 className="mt-1 text-2xl font-bold text-slate-900 dark:text-slate-50">
          {config.titulo}
          {modo === 'orden-editar' && orden.data && ` ${String(orden.data.numero)}`}
        </h1>
        <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">{config.ayuda}</p>
        {modo === 'orden-nueva' && plantilla.data && (
          <p className="mt-2 rounded-lg bg-sky-50 p-2 text-sm text-sky-900 dark:bg-sky-950/40 dark:text-sky-200">
            Precargada desde la plantilla <strong>{plantilla.data.nombre}</strong>. Revisá las
            cantidades y los precios antes de confirmar.
          </p>
        )}
      </div>

      <form
        onSubmit={(evento) => {
          evento.preventDefault();
          enviar(true);
        }}
        noValidate
        className="space-y-4"
      >
        <Tarjeta titulo={esPlantilla ? 'Plantilla' : 'Proveedor y destino'}>
          <div className="grid gap-4 sm:grid-cols-2">
            {esPlantilla && (
              <div className="sm:col-span-2">
                <Campo etiqueta="Nombre" error={form.formState.errors.nombre?.message}>
                  <input
                    type="text"
                    placeholder="Pedido semanal Molino"
                    className={CLASE_CONTROL}
                    {...form.register('nombre')}
                  />
                </Campo>
              </div>
            )}

            <Campo etiqueta="Proveedor" error={form.formState.errors.proveedorId?.message}>
              <select className={CLASE_CONTROL} {...form.register('proveedorId')}>
                <option value="">Elegí un proveedor</option>
                {(proveedores.data ?? []).map((fila) => (
                  <option key={fila.id} value={fila.id}>
                    {fila.nombre}
                  </option>
                ))}
              </select>
            </Campo>

            <Campo etiqueta="Sucursal que recibe" error={form.formState.errors.sucursalId?.message}>
              <select className={CLASE_CONTROL} {...form.register('sucursalId')}>
                {sucursales.map((sucursal) => (
                  <option key={sucursal.id} value={sucursal.id}>
                    {sucursal.nombre}
                  </option>
                ))}
              </select>
            </Campo>

            {esOrden && (
              <Campo
                etiqueta="Entrega estimada (opcional)"
                ayuda="Si pasa la fecha y no llegó, la orden aparece atrasada."
                error={form.formState.errors.fechaEntregaEstimada?.message}
              >
                {/* type="date" manda 'AAAA-MM-DD', justo lo que guarda la
                    columna: un día, sin hora ni zona. */}
                <input
                  type="date"
                  className={CLASE_CONTROL}
                  {...form.register('fechaEntregaEstimada')}
                />
              </Campo>
            )}

            {modo === 'recepcion' && (
              <>
                <Campo
                  etiqueta="Número de remito (opcional)"
                  error={form.formState.errors.numeroRemito?.message}
                >
                  <input
                    type="text"
                    placeholder="0001-00004567"
                    className={CLASE_CONTROL}
                    {...form.register('numeroRemito')}
                  />
                </Campo>
                <Campo
                  etiqueta="Número de factura (opcional)"
                  error={form.formState.errors.numeroFactura?.message}
                >
                  <input
                    type="text"
                    className={CLASE_CONTROL}
                    {...form.register('numeroFactura')}
                  />
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
              </>
            )}
          </div>
        </Tarjeta>

        <Tarjeta titulo="Qué">
          <div className="space-y-3">
            {insumos.isError && (
              <MensajeError>
                No se pudo cargar la lista de insumos: {insumos.error.message}
              </MensajeError>
            )}
            {lineas.fields.map((campo, indice) => (
              <FilaLinea
                key={campo.id}
                form={form}
                indice={indice}
                insumos={insumos.data?.items ?? []}
                asociaciones={asociaciones}
                yaElegidos={yaElegidos}
                conPrecio={config.conPrecio}
                puedeQuitar={lineas.fields.length > 1}
                onQuitar={() => {
                  lineas.remove(indice);
                }}
              />
            ))}

            {mensajeDeLineas(form.formState.errors.lineas) !== null && (
              <MensajeError>{mensajeDeLineas(form.formState.errors.lineas)}</MensajeError>
            )}

            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={() => {
                  lineas.append({ ...LINEA_VACIA });
                }}
                className={CLASE_BOTON_SECUNDARIO}
              >
                + Agregar otro insumo
              </button>
              {config.conPrecio && total.greaterThan(0) && (
                <p className="ml-auto text-right">
                  <span className="block text-xs text-slate-600 uppercase dark:text-slate-400">
                    Total {modo === 'recepcion' ? '' : 'estimado'}
                  </span>
                  <span className="text-xl font-bold tabular-nums">{formatearDinero(total)}</span>
                </p>
              )}
            </div>
          </div>
        </Tarjeta>

        <Tarjeta titulo="Notas">
          <Campo etiqueta="Notas (opcional)" error={form.formState.errors.notas?.message}>
            <input type="text" className={CLASE_CONTROL} {...form.register('notas')} />
          </Campo>
        </Tarjeta>

        {errorGeneral !== null && <MensajeError>{errorGeneral}</MensajeError>}

        <div className="flex flex-wrap justify-end gap-2">
          <Link to={config.volverA} className={`${CLASE_BOTON_SECUNDARIO} grid place-items-center`}>
            Cancelar
          </Link>

          {modo === 'orden-nueva' && puedePedir && (
            <button
              type="button"
              onClick={() => {
                void form.handleSubmit((valores) => {
                  comoPlantilla.reset();
                  setParaPlantilla(valores);
                })();
              }}
              className={CLASE_BOTON_SECUNDARIO}
            >
              Guardar como plantilla
            </button>
          )}

          {modo === 'orden-nueva' && (
            <button
              type="button"
              disabled={guardar.isPending}
              onClick={() => {
                enviar(false);
              }}
              className={CLASE_BOTON_SECUNDARIO}
            >
              Guardar borrador
            </button>
          )}

          <button type="submit" disabled={guardar.isPending} className={CLASE_BOTON_PRIMARIO}>
            {guardar.isPending
              ? 'Guardando...'
              : modo === 'orden-nueva'
                ? 'Crear pedido'
                : modo === 'recepcion'
                  ? 'Registrar recepción'
                  : esPlantilla
                    ? 'Guardar plantilla'
                    : 'Guardar cambios'}
          </button>
        </div>
      </form>

      <DialogoConfirmacion
        abierto={paraPlantilla !== null}
        titulo="Guardar como plantilla"
        textoConfirmar="Guardar plantilla"
        trabajando={comoPlantilla.isPending}
        onConfirmar={() => {
          if (paraPlantilla !== null) comoPlantilla.mutate(paraPlantilla);
        }}
        onCancelar={() => {
          setParaPlantilla(null);
        }}
      >
        <p className="text-sm text-slate-600 dark:text-slate-400">
          Se guardan el proveedor, la sucursal y los insumos con sus cantidades. Los precios no: al
          usarla se sugiere el último que pagaste.
        </p>
        <label className="mt-3 block">
          <span className="mb-1 block text-sm font-medium">Nombre</span>
          <input
            type="text"
            value={nombrePlantilla}
            placeholder="Pedido semanal Molino"
            onChange={(evento) => {
              setNombrePlantilla(evento.target.value);
            }}
            className={CLASE_CONTROL}
          />
        </label>
        {comoPlantilla.isError && (
          <div className="mt-3">
            <MensajeError>{comoPlantilla.error.message}</MensajeError>
          </div>
        )}
      </DialogoConfirmacion>

      {comoPlantilla.isSuccess && (
        <p className="rounded-xl bg-emerald-50 p-3 text-sm text-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200">
          Plantilla guardada. La orden todavía no se creó: terminá de completarla.
        </p>
      )}
    </div>
  );
}

/**
 * Una fila: insumo, presentación, cantidad y (si corresponde) precio.
 *
 * Es un componente aparte por una razón concreta: cada fila necesita SU propia
 * consulta (las presentaciones del insumo elegido), y los hooks no se pueden
 * llamar adentro de un .map(). Un componente por fila es la forma de darle a
 * cada una su propio useQuery.
 */
function FilaLinea({
  form,
  indice,
  insumos,
  asociaciones,
  yaElegidos,
  conPrecio,
  puedeQuitar,
  onQuitar,
}: {
  form: Formulario;
  indice: number;
  insumos: readonly InsumoResumen[];
  asociaciones: ReadonlyMap<string, InsumoDeProveedor>;
  yaElegidos: ReadonlySet<string>;
  conPrecio: boolean;
  puedeQuitar: boolean;
  onQuitar: () => void;
}) {
  const ruta = `lineas.${String(indice)}` as 'lineas.0';
  const errores = form.formState.errors.lineas?.[indice];

  const insumoId = form.watch(`${ruta}.insumoId`);
  const presentacionId = form.watch(`${ruta}.presentacionId`) ?? '';
  const cantidad = form.watch(`${ruta}.cantidad`);
  const precio = form.watch(`${ruta}.precioUnitario`) ?? '';

  // Las presentaciones del insumo elegido. La clave ['insumo', id] es la misma
  // que usa la ficha del insumo: si ya se abrió, viene del caché.
  const detalle = useQuery({
    queryKey: ['insumo', insumoId],
    queryFn: () => obtenerInsumo(insumoId),
    enabled: insumoId !== '',
  });
  const unidad = insumos.find((insumo) => insumo.id === insumoId)?.unidadBase.codigo ?? '';
  const presentaciones = (detalle.data?.presentaciones ?? []).filter(
    (p) => p.activa || p.id === presentacionId,
  );
  const presentacion = presentaciones.find((p) => p.id === presentacionId) ?? null;
  const factor = presentacion?.cantidadBase ?? '1';
  const asociacion = asociaciones.get(insumoId);

  // Si la fila llegó con insumo pero sin precio (una plantilla), se completa
  // con el último precio del proveedor, siempre que sea de la MISMA
  // presentación: el precio de la bolsa de 50 no sirve para la de 25.
  const { setValue } = form;
  useEffect(() => {
    if (!conPrecio || precio !== '' || asociacion?.ultimoPrecio == null) return;
    if ((asociacion.presentacion?.id ?? '') !== presentacionId) return;
    setValue(`${ruta}.precioUnitario`, asociacion.ultimoPrecio);
  }, [conPrecio, precio, asociacion, presentacionId, ruta, setValue]);

  /**
   * Al ELEGIR un insumo, se precarga lo que el proveedor tiene registrado:
   * en qué presentación lo vende y cuánto se le pagó la última vez. Es el
   * camino corto para el dueño (C-13): elige "harina" y ya está "10 × bolsa
   * 25 kg a $18.500"; solo cambia lo que cambió.
   *
   * Va en el onChange y no en un efecto: así solo pasa cuando la PERSONA
   * cambia el insumo, y no pisa lo que venía cargado al editar una orden.
   */
  function alElegirInsumo(nuevo: string): void {
    const fila = asociaciones.get(nuevo);
    setValue(`${ruta}.presentacionId`, fila?.presentacion?.id ?? '');
    setValue(`${ruta}.precioUnitario`, conPrecio ? (fila?.ultimoPrecio ?? '') : '');
  }

  // "= $740 por kg": para comparar contra otros proveedores sin calculadora.
  let costoBase: string | null = null;
  const precioNormalizado = normalizarNumero(precio);
  if (conPrecio && esDecimalValido(precioNormalizado) && precio !== '') {
    costoBase = formatearDinero(costoPorUnidadBase(precioNormalizado, factor));
  }

  const registroInsumo = form.register(`${ruta}.insumoId`);

  return (
    <div
      className={`grid gap-3 rounded-xl border border-slate-200 p-3 dark:border-slate-700 ${
        conPrecio ? 'sm:grid-cols-[2fr_1.4fr_1fr_1.2fr_auto]' : 'sm:grid-cols-[2fr_1.4fr_1fr_auto]'
      }`}
    >
      <Campo etiqueta="Insumo" error={errores?.insumoId?.message}>
        <select
          className={CLASE_CONTROL}
          {...registroInsumo}
          onChange={(evento) => {
            void registroInsumo.onChange(evento);
            alElegirInsumo(evento.target.value);
          }}
        >
          <option value="">Elegí un insumo</option>
          {insumos
            .filter(
              (insumo) => insumo.activo && (!yaElegidos.has(insumo.id) || insumo.id === insumoId),
            )
            .map((insumo) => (
              <option key={insumo.id} value={insumo.id}>
                {insumo.nombre}
                {asociaciones.has(insumo.id) ? ' ★' : ''}
              </option>
            ))}
        </select>
      </Campo>

      <Campo etiqueta="Presentación" error={errores?.presentacionId?.message}>
        {/* CONTROLADO (con `value`) a propósito. Al elegir el insumo, la
            presentación se precarga ANTES de que lleguen sus opciones (vienen
            de otro pedido). Un <select> no controlado se queda mostrando la
            primera opción aunque el formulario tenga otra: la pantalla decía
            "Suelto, en kg" y la orden se guardaba en bolsas. Con `value`,
            React lo vuelve a pintar cuando aparecen las opciones. Lo encontró
            la prueba en el navegador, no los tests de la API. */}
        <select
          className={CLASE_CONTROL}
          disabled={insumoId === ''}
          {...form.register(`${ruta}.presentacionId`)}
          value={presentacionId}
        >
          <option value="">{unidad === '' ? 'Unidad base' : `Suelto, en ${unidad}`}</option>
          {presentaciones.map((p) => (
            <option key={p.id} value={p.id}>
              {p.nombre}
            </option>
          ))}
        </select>
      </Campo>

      <Campo
        etiqueta={
          presentacion === null ? `Cantidad${unidad === '' ? '' : ` (${unidad})`}` : 'Cuántas'
        }
        error={errores?.cantidad?.message}
        ayuda={
          presentacion !== null && esDecimalValido(normalizarNumero(cantidad)) && cantidad !== ''
            ? `= ${aDecimal(normalizarNumero(cantidad)).times(factor).toString()} ${unidad}`
            : undefined
        }
      >
        <input
          type="text"
          inputMode="decimal"
          placeholder="0"
          className={CLASE_CONTROL}
          {...form.register(`${ruta}.cantidad`)}
        />
      </Campo>

      {conPrecio && (
        <Campo
          etiqueta={presentacion === null ? `Precio por ${unidad || 'unidad'}` : 'Precio c/u'}
          error={errores?.precioUnitario?.message}
          ayuda={
            costoBase !== null && presentacion !== null ? `= ${costoBase} por ${unidad}` : undefined
          }
        >
          <input
            type="text"
            inputMode="decimal"
            placeholder="$"
            className={CLASE_CONTROL}
            {...form.register(`${ruta}.precioUnitario`)}
          />
        </Campo>
      )}

      <div className="flex items-end">
        <button
          type="button"
          aria-label={`Quitar la línea ${String(indice + 1)}`}
          disabled={!puedeQuitar}
          onClick={onQuitar}
          className="min-h-12 rounded-xl px-4 text-slate-600 hover:bg-slate-100 disabled:opacity-30 dark:text-slate-400 dark:hover:bg-slate-800"
        >
          Quitar
        </button>
      </div>
    </div>
  );
}
