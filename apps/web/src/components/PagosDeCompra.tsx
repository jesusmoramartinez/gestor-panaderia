import {
  aDecimal,
  type EstadoPago,
  formatearCantidad,
  formatearDinero,
  formatearFechaArgentina,
  type MedioPago,
  MEDIOS_PAGO,
  type OrdenDetalle,
  type PagoSalida,
  RegistrarPagoSchema,
} from '@panaderia/shared';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useForm } from 'react-hook-form';

import { detallesPorCampo } from '../lib/api';
import { aplicarErroresDelServidor } from '../lib/erroresFormulario';
import type { ImagenPreparada } from '../lib/imagenes';
import { agregarComprobantesAPago, anularPago, registrarPago } from '../lib/pagos';
import { usePuede } from '../hooks/useSesion';
import { ElegirImagenes, MiniaturasComprobantes } from './comprobantes';
import { DialogoConfirmacion } from './Dialogo';
import {
  alEnviar,
  Campo,
  CLASE_BOTON_PRIMARIO,
  CLASE_BOTON_SECUNDARIO,
  CLASE_CONTROL,
  MensajeError,
  Tarjeta,
} from './formulario';

export const TEXTO_MEDIO: Record<MedioPago, string> = {
  EFECTIVO: 'Efectivo',
  TRANSFERENCIA: 'Transferencia',
  MERCADO_PAGO: 'Mercado Pago',
};

const TEXTO_ESTADO_PAGO: Record<EstadoPago, string> = {
  SIN_PAGO: 'Sin pagar',
  PAGO_PARCIAL: 'Pagada en parte',
  PAGADA: 'Pagada',
};

const COLOR_ESTADO_PAGO: Record<EstadoPago, string> = {
  SIN_PAGO: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
  PAGO_PARCIAL: 'bg-amber-100 text-amber-900 dark:bg-amber-950/60 dark:text-amber-300',
  PAGADA: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300',
};

export function EtiquetaEstadoPago({ estado }: { estado: EstadoPago }) {
  return (
    <span
      className={`inline-block rounded-full px-2 py-0.5 text-xs font-semibold ${COLOR_ESTADO_PAGO[estado]}`}
    >
      {TEXTO_ESTADO_PAGO[estado]}
    </span>
  );
}

/**
 * LOS PAGOS DE UNA COMPRA (Fase 12b): la cuenta de plata, los pagos con sus
 * comprobantes, y el formulario para cargar uno.
 */
export function PagosDeCompra({ orden }: { orden: OrdenDetalle }) {
  const queryClient = useQueryClient();
  const puedePagar = usePuede('compra:pagar');
  const puedeAnular = usePuede('compra:anular');
  const [cargando, setCargando] = useState(false);
  const [anulando, setAnulando] = useState<PagoSalida | null>(null);
  const [motivo, setMotivo] = useState('');

  const cuenta = orden.cuenta;
  const terminada = orden.estado === 'CERRADA' || orden.estado === 'CANCELADA';
  const adelantado = aDecimal(cuenta.adelantadoSinEntregar);

  async function actualizar(actualizada: OrdenDetalle): Promise<void> {
    queryClient.setQueryData(['orden', orden.id], actualizada);
    await queryClient.invalidateQueries({ queryKey: ['ordenes'] });
    await queryClient.invalidateQueries({ queryKey: ['me-deben'] });
  }

  const anular = useMutation({
    mutationFn: (pago: PagoSalida) => anularPago(pago.id, { motivo }),
    onSuccess: async (actualizada) => {
      await actualizar(actualizada);
      setAnulando(null);
      setMotivo('');
    },
  });

  return (
    <Tarjeta titulo="Pagos">
      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Dato
          titulo="Total"
          valor={cuenta.total === null ? 'sin precio' : formatearDinero(cuenta.total)}
        />
        <Dato titulo="Pagado" valor={formatearDinero(cuenta.pagado)} />
        <Dato
          titulo="Falta pagar"
          valor={cuenta.saldo === null ? '—' : formatearDinero(cuenta.saldo)}
        />
        <div>
          <dt className="text-xs text-slate-600 dark:text-slate-400">Estado</dt>
          <dd className="mt-1">
            <EtiquetaEstadoPago estado={cuenta.estadoPago} />
          </dd>
        </div>
      </dl>

      {adelantado.greaterThan(0) && (
        <p
          className={`mt-4 rounded-lg p-3 text-sm ${
            terminada
              ? 'bg-red-50 text-red-800 dark:bg-red-950/50 dark:text-red-300'
              : 'bg-sky-50 text-sky-900 dark:bg-sky-950/50 dark:text-sky-200'
          }`}
        >
          {terminada
            ? `Te tienen que devolver ${formatearDinero(adelantado)}: lo pagaste y no va a llegar.`
            : `Pagaste ${formatearDinero(adelantado)} que todavía no te entregaron.`}
        </p>
      )}
      {cuenta.renglonesSinPrecio > 0 && (
        <p className="mt-4 rounded-lg bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-950/50 dark:text-amber-200">
          Hay insumos sin precio: para registrar pagos, cargá el precio de todos (editando la
          compra).
        </p>
      )}

      {orden.pagos.length > 0 && (
        <ul className="mt-4 divide-y divide-slate-100 dark:divide-slate-800">
          {orden.pagos.map((pago) => (
            <FilaPago
              key={pago.id}
              pago={pago}
              puedeAgregarFotos={puedePagar}
              puedeAnular={puedeAnular}
              onActualizada={actualizar}
              onAnular={() => {
                anular.reset();
                setAnulando(pago);
              }}
            />
          ))}
        </ul>
      )}

      {orden.puedePagar && puedePagar && (
        <div className="mt-4">
          {cargando ? (
            <FormularioPago
              orden={orden}
              onListo={async (actualizada) => {
                await actualizar(actualizada);
                setCargando(false);
              }}
              onCancelar={() => {
                setCargando(false);
              }}
            />
          ) : (
            <button
              type="button"
              onClick={() => {
                setCargando(true);
              }}
              className={CLASE_BOTON_PRIMARIO}
            >
              Registrar pago
            </button>
          )}
        </div>
      )}

      <DialogoConfirmacion
        abierto={anulando !== null}
        titulo="Anular el pago"
        textoConfirmar="Anular pago"
        trabajando={anular.isPending}
        onConfirmar={() => {
          if (anulando !== null) anular.mutate(anulando);
        }}
        onCancelar={() => {
          setAnulando(null);
        }}
      >
        <p>
          {anulando === null
            ? ''
            : `El pago de ${formatearDinero(anulando.monto)} deja de contar. Queda en la historia, con el motivo.`}
        </p>
        <label className="mt-3 block">
          <span className="mb-1 block text-sm font-medium">Por qué</span>
          <input
            type="text"
            value={motivo}
            onChange={(evento) => {
              setMotivo(evento.target.value);
            }}
            placeholder="Cargué un cero de más / el proveedor devolvió la plata"
            className={CLASE_CONTROL}
          />
        </label>
        {anular.isError && (
          <div className="mt-3">
            <MensajeError>{anular.error.message}</MensajeError>
          </div>
        )}
      </DialogoConfirmacion>
    </Tarjeta>
  );
}

function Dato({ titulo, valor }: { titulo: string; valor: string }) {
  return (
    <div>
      <dt className="text-xs text-slate-600 dark:text-slate-400">{titulo}</dt>
      <dd className="mt-1 font-semibold text-slate-900 tabular-nums dark:text-slate-50">{valor}</dd>
    </div>
  );
}

function FilaPago({
  pago,
  puedeAgregarFotos,
  puedeAnular,
  onActualizada,
  onAnular,
}: {
  pago: PagoSalida;
  puedeAgregarFotos: boolean;
  puedeAnular: boolean;
  onActualizada: (orden: OrdenDetalle) => Promise<void>;
  onAnular: () => void;
}) {
  const anulado = pago.anuladoAt !== null;
  const [fotos, setFotos] = useState<ImagenPreparada[] | null>(null);
  const agregar = useMutation({
    mutationFn: (imagenes: ImagenPreparada[]) =>
      agregarComprobantesAPago(pago.id, {
        comprobantes: imagenes.map((imagen) => ({ datos: imagen.datos })),
      }),
    onSuccess: async (actualizada) => {
      await onActualizada(actualizada);
      setFotos(null);
    },
  });

  return (
    <li className="py-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className={anulado ? 'text-slate-500 line-through' : ''}>
          <span className="font-semibold tabular-nums">{formatearDinero(pago.monto)}</span>{' '}
          <span className="text-sm text-slate-600 dark:text-slate-400">
            · {TEXTO_MEDIO[pago.medio]} · {formatearFechaArgentina(new Date(pago.fecha))}
          </span>
        </p>
        <div className="flex gap-1">
          {!anulado && puedeAgregarFotos && fotos === null && (
            <button
              type="button"
              onClick={() => {
                setFotos([]);
              }}
              className="min-h-11 rounded-lg px-3 text-sm font-medium text-corteza hover:bg-slate-50 dark:text-corteza-claro dark:hover:bg-slate-800"
            >
              Agregar foto
            </button>
          )}
          {!anulado && puedeAnular && (
            <button
              type="button"
              onClick={onAnular}
              className="min-h-11 rounded-lg px-3 text-sm font-medium text-red-700 hover:bg-red-50 dark:text-red-300 dark:hover:bg-red-950/40"
            >
              Anular
            </button>
          )}
        </div>
      </div>
      {pago.nota !== null && (
        <p className="text-sm text-slate-600 italic dark:text-slate-300">«{pago.nota}»</p>
      )}
      {anulado && (
        <p className="text-sm text-red-700 dark:text-red-300">
          Anulado por {pago.anuladoPor?.nombre ?? '—'}: {pago.motivoAnulacion}
        </p>
      )}
      <div className="mt-2">
        <MiniaturasComprobantes comprobantes={pago.comprobantes} titulo="Comprobante de pago" />
      </div>
      {fotos !== null && (
        <div className="mt-3 space-y-2 rounded-xl border border-slate-200 p-3 dark:border-slate-700">
          <ElegirImagenes etiqueta="Fotos del comprobante" imagenes={fotos} onCambiar={setFotos} />
          {agregar.isError && <MensajeError>{agregar.error.message}</MensajeError>}
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={fotos.length === 0 || agregar.isPending}
              onClick={() => {
                agregar.mutate(fotos);
              }}
              className={CLASE_BOTON_PRIMARIO}
            >
              {agregar.isPending ? 'Guardando...' : 'Guardar fotos'}
            </button>
            <button
              type="button"
              onClick={() => {
                setFotos(null);
              }}
              className={CLASE_BOTON_SECUNDARIO}
            >
              Cancelar
            </button>
          </div>
        </div>
      )}
    </li>
  );
}

/** El formulario de un pago. Arranca con lo que falta pagar: el caso común. */
const PagoFormSchema = RegistrarPagoSchema.omit({ comprobantes: true });

function FormularioPago({
  orden,
  onListo,
  onCancelar,
}: {
  orden: OrdenDetalle;
  onListo: (actualizada: OrdenDetalle) => Promise<void>;
  onCancelar: () => void;
}) {
  const [imagenes, setImagenes] = useState<ImagenPreparada[]>([]);
  const [errorGeneral, setErrorGeneral] = useState<string | null>(null);
  const form = useForm({
    resolver: zodResolver(PagoFormSchema),
    defaultValues: {
      // "2.000.000": como lo escribiría él (ver normalizarImporte).
      monto: orden.cuenta.saldo === null ? '' : formatearCantidad(orden.cuenta.saldo, 2),
      medio: 'TRANSFERENCIA' as MedioPago,
      fecha: '',
      nota: '',
    },
  });
  const medio = form.watch('medio');

  const pagar = useMutation({
    mutationFn: (valores: ReturnType<typeof PagoFormSchema.parse>) =>
      registrarPago(orden.id, {
        ...valores,
        comprobantes: imagenes.map((imagen) => ({ datos: imagen.datos })),
      }),
    onSuccess: onListo,
    onError: (error) => {
      // El error de una imagen viene en "comprobantes", que no es un campo
      // del formulario: se muestra arriba, junto a las fotos.
      const deImagen = Object.entries(detallesPorCampo(error)).find(([campo]) =>
        campo.startsWith('comprobantes'),
      )?.[1];
      setErrorGeneral(deImagen ?? aplicarErroresDelServidor(error, form.setError));
    },
  });

  return (
    <form
      noValidate
      className="space-y-4 rounded-xl border border-slate-200 p-4 dark:border-slate-700"
      onSubmit={alEnviar(
        form.handleSubmit((valores) => {
          setErrorGeneral(null);
          pagar.mutate(valores);
        }),
      )}
    >
      <h3 className="font-semibold text-slate-900 dark:text-slate-50">Nuevo pago</h3>
      <Campo
        etiqueta="Monto"
        ayuda="Se puede escribir con puntos: 2.000.000"
        error={form.formState.errors.monto?.message}
      >
        <input
          type="text"
          inputMode="decimal"
          className={CLASE_CONTROL}
          {...form.register('monto')}
        />
      </Campo>

      {/* Tres botones grandes en vez de un desplegable: se toca uno y listo. */}
      <fieldset>
        <legend className="mb-1 text-sm font-medium text-slate-700 dark:text-slate-200">
          Cómo pagaste
        </legend>
        {/* En el celular, uno abajo del otro: "Transferencia" no entra en un
            tercio de pantalla (lo mostró la captura). */}
        <div className="grid gap-2 sm:grid-cols-3">
          {MEDIOS_PAGO.map((opcion) => (
            <label
              key={opcion}
              className={`grid min-h-12 cursor-pointer place-items-center rounded-xl border px-2 text-center text-sm font-medium ${
                medio === opcion
                  ? 'border-corteza bg-corteza text-white dark:border-corteza-claro'
                  : 'border-slate-300 text-slate-700 dark:border-slate-600 dark:text-slate-200'
              }`}
            >
              <input type="radio" value={opcion} className="sr-only" {...form.register('medio')} />
              {TEXTO_MEDIO[opcion]}
            </label>
          ))}
        </div>
      </fieldset>

      <ElegirImagenes
        etiqueta="Comprobante (foto o captura, opcional)"
        imagenes={imagenes}
        onCambiar={setImagenes}
      />

      <div className="grid gap-4 sm:grid-cols-2">
        <Campo
          etiqueta="Cuándo pagaste (opcional)"
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
        <Campo etiqueta="Nota (opcional)" error={form.formState.errors.nota?.message}>
          <input type="text" className={CLASE_CONTROL} {...form.register('nota')} />
        </Campo>
      </div>

      {errorGeneral !== null && <MensajeError>{errorGeneral}</MensajeError>}
      <div className="flex flex-wrap gap-2">
        <button type="submit" disabled={pagar.isPending} className={CLASE_BOTON_PRIMARIO}>
          {pagar.isPending ? 'Guardando...' : 'Guardar pago'}
        </button>
        <button type="button" onClick={onCancelar} className={CLASE_BOTON_SECUNDARIO}>
          Cancelar
        </button>
      </div>
    </form>
  );
}
