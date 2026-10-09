import { zodResolver } from '@hookform/resolvers/zod';
import {
  aDecimal,
  esDecimalValido,
  formatearCantidad,
  formatearFechaArgentina,
  normalizarNumero,
  RecibirTransferenciaSchema,
  type TransferenciaDetalle as Detalle,
} from '@panaderia/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link, useParams } from 'react-router';

import { DialogoConfirmacion } from '../components/Dialogo';
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
import { EtiquetaEstadoTransferencia } from '../components/transferencias';
import { usePuede } from '../hooks/useSesion';
import { aplicarErroresDelServidor } from '../lib/erroresFormulario';
import {
  anularTransferencia,
  obtenerTransferencia,
  recibirTransferencia,
} from '../lib/transferencias';

/**
 * El detalle de una transferencia y, si está en tránsito, lo que se puede
 * hacer con ella según DÓNDE trabaja quien la mira:
 *
 *   en el destino → confirmar lo que llegó (C-19)
 *   en el origen  → anularla, si todavía no llegó
 *
 * La API vuelve a controlar las dos cosas; esto es para no mostrar botones
 * que van a dar 403.
 */
export function TransferenciaDetalle() {
  const { id = '' } = useParams();
  const queryClient = useQueryClient();
  const { activa, sucursales } = useSucursalActiva();
  const puedeRecibir = usePuede('transferencia:recibir');
  const puedeEnviar = usePuede('transferencia:enviar');
  const [anulando, setAnulando] = useState(false);
  const [motivo, setMotivo] = useState('');

  const transferencia = useQuery({
    queryKey: ['transferencia', id],
    queryFn: () => obtenerTransferencia(id),
  });

  const anular = useMutation({
    mutationFn: () => anularTransferencia(id, { motivo }),
    onSuccess: async (actualizada) => {
      queryClient.setQueryData(['transferencia', id], actualizada);
      await queryClient.invalidateQueries({ queryKey: ['transferencias'] });
      await queryClient.invalidateQueries({ queryKey: ['stock'] });
      await queryClient.invalidateQueries({ queryKey: ['alertas'] });
      await queryClient.invalidateQueries({ queryKey: ['reposicion'] });
      setAnulando(false);
    },
  });

  if (transferencia.isError) return <MensajeError>{transferencia.error.message}</MensajeError>;
  if (transferencia.isPending) {
    return <p className="text-sm text-slate-600 dark:text-slate-400">Cargando...</p>;
  }

  const datos = transferencia.data;
  // Lo que se muestra depende de DÓNDE está parada la persona (la sucursal
  // activa), no de en cuáles puede operar. El dueño puede operar en las dos:
  // si acaba de despachar desde la Central, mostrarle "¿qué llegó?" sería
  // absurdo. Lo encontró la prueba en el navegador.
  const estaEnDestino = activa?.id === datos.destino.id;
  const estaEnOrigen = activa?.id === datos.origen.id;
  const operaEnDestino = sucursales.some((s) => s.id === datos.destino.id);
  const enTransito = datos.acciones.includes('recibir');
  const muestraRecepcion = enTransito && puedeRecibir && estaEnDestino;
  const muestraAnular = datos.acciones.includes('anular') && puedeEnviar && estaEnOrigen;
  const avisarCambio = enTransito && puedeRecibir && operaEnDestino && !estaEnDestino;

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div>
        <Link
          to="/transferencias"
          className="text-sm text-corteza hover:underline dark:text-corteza-claro"
        >
          ← Volver a transferencias
        </Link>
        <div className="mt-1 flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-50">
            Transferencia {datos.numero}
          </h1>
          <EtiquetaEstadoTransferencia estado={datos.estado} />
        </div>
        <p className="mt-1 text-lg">
          {datos.origen.nombre} → {datos.destino.nombre}
        </p>
        <p className="text-sm text-slate-600 dark:text-slate-400">
          Salió {formatearFechaArgentina(new Date(datos.fechaEnvio))} · la mandó{' '}
          {datos.usuarioEnvio.nombre}
          {datos.fechaRecepcion !== null &&
            ` · llegó ${formatearFechaArgentina(new Date(datos.fechaRecepcion))}`}
          {datos.usuarioRecepcion !== null && ` · la recibió ${datos.usuarioRecepcion.nombre}`}
        </p>
        {datos.notas !== null && (
          <p className="mt-1 text-sm text-slate-600 italic dark:text-slate-300">«{datos.notas}»</p>
        )}
        {datos.estado === 'ANULADA' && (
          <p className="mt-2 rounded-lg bg-slate-100 p-3 text-sm dark:bg-slate-800">
            Anulada por {datos.anuladaPor?.nombre ?? '—'}: «{datos.motivoAnulacion}». Lo que había
            salido volvió al stock de {datos.origen.nombre}.
          </p>
        )}
      </div>

      {muestraRecepcion ? (
        // La key hace que React arme el formulario de cero si cambia la
        // transferencia: los valores iniciales salen de ella.
        <Recepcion key={datos.id} transferencia={datos} />
      ) : (
        <Tarjeta titulo={datos.estado === 'ENVIADA' ? 'En camino' : 'Qué se mandó y qué llegó'}>
          <ul className="divide-y divide-slate-100 dark:divide-slate-800">
            {datos.lineas.map((linea) => {
              const unidad = linea.insumo.unidadBaseCodigo;
              const otraUnidad = linea.unidadIngresadaCodigo !== unidad;
              return (
                <li key={linea.id} className="flex flex-wrap items-baseline gap-x-4 gap-y-1 py-3">
                  <span className="min-w-40 font-medium">{linea.insumo.nombre}</span>
                  <span className="text-sm text-slate-600 dark:text-slate-400">
                    salieron {formatearCantidad(linea.cantidadBaseEnviada)} {unidad}
                    {otraUnidad &&
                      ` (cargó ${formatearCantidad(linea.cantidadIngresada)} ${linea.unidadIngresadaCodigo})`}
                  </span>
                  {linea.cantidadBaseRecibida !== null && (
                    <span className="ml-auto text-right text-sm">
                      llegaron {formatearCantidad(linea.cantidadBaseRecibida)} {unidad}
                      {linea.diferencia !== null && linea.diferencia !== '0' && (
                        <span className="block font-semibold text-amber-800 dark:text-amber-300">
                          faltaron {formatearCantidad(linea.diferencia)} {unidad} (merma)
                        </span>
                      )}
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
          {datos.estado === 'ENVIADA' && (
            <p className="mt-3 text-sm text-slate-600 dark:text-slate-400">
              Ya salió del stock de {datos.origen.nombre}. Entra al de {datos.destino.nombre} cuando
              lo confirmen allá.
            </p>
          )}
        </Tarjeta>
      )}

      {avisarCambio && (
        <p className="rounded-xl bg-sky-50 p-3 text-sm text-sky-900 dark:bg-sky-950/40 dark:text-sky-200">
          Para confirmar lo que llegó, cambiá arriba a la sucursal{' '}
          <strong>{datos.destino.nombre}</strong>.
        </p>
      )}

      {muestraAnular && (
        <button
          type="button"
          onClick={() => {
            anular.reset();
            setAnulando(true);
          }}
          className={CLASE_BOTON_PELIGRO}
        >
          Anular el envío
        </button>
      )}

      <DialogoConfirmacion
        abierto={anulando}
        titulo={`Anular la transferencia ${String(datos.numero)}`}
        textoConfirmar="Anular"
        trabajando={anular.isPending}
        onConfirmar={() => {
          anular.mutate();
        }}
        onCancelar={() => {
          setAnulando(false);
        }}
      >
        <p className="text-sm text-slate-600 dark:text-slate-400">
          Todo vuelve al stock de {datos.origen.nombre}. Queda en el historial como anulada.
        </p>
        <label className="mt-3 block">
          <span className="mb-1 block text-sm font-medium">Por qué se anula</span>
          <input
            type="text"
            value={motivo}
            onChange={(evento) => {
              setMotivo(evento.target.value);
            }}
            placeholder="Se eligió la sucursal equivocada..."
            className={CLASE_CONTROL}
          />
        </label>
        {anular.isError && (
          <div className="mt-3">
            <MensajeError>{anular.error.message}</MensajeError>
          </div>
        )}
      </DialogoConfirmacion>
    </div>
  );
}

/**
 * Confirmar lo que llegó. Arranca con TODO lo enviado (el caso común: llegó
 * todo), y si algo llegó de menos se corrige: la pantalla avisa en vivo que
 * la diferencia se va a registrar como merma.
 */
function Recepcion({ transferencia }: { transferencia: Detalle }) {
  const queryClient = useQueryClient();
  const [errorGeneral, setErrorGeneral] = useState<string | null>(null);

  const todoLoEnviado = () => ({
    fecha: '',
    notas: '',
    lineas: transferencia.lineas.map((linea) => ({
      lineaId: linea.id,
      cantidadRecibida: linea.cantidadBaseEnviada,
    })),
  });

  const form = useForm({
    resolver: zodResolver(RecibirTransferenciaSchema),
    defaultValues: todoLoEnviado(),
  });

  const recibir = useMutation({
    mutationFn: (valores: Parameters<typeof recibirTransferencia>[1]) =>
      recibirTransferencia(transferencia.id, valores),
    onSuccess: async (actualizada) => {
      queryClient.setQueryData(['transferencia', transferencia.id], actualizada);
      await queryClient.invalidateQueries({ queryKey: ['transferencias'] });
      await queryClient.invalidateQueries({ queryKey: ['stock'] });
      await queryClient.invalidateQueries({ queryKey: ['alertas'] });
      await queryClient.invalidateQueries({ queryKey: ['reposicion'] });
      await queryClient.invalidateQueries({ queryKey: ['historial'] });
    },
    onError: (error) => {
      setErrorGeneral(aplicarErroresDelServidor(error, form.setError));
    },
  });

  const valores = form.watch('lineas');

  return (
    <form
      onSubmit={(evento) => {
        evento.preventDefault();
        setErrorGeneral(null);
        void form.handleSubmit((datos) => {
          recibir.mutate(datos);
        })(evento);
      }}
      noValidate
      className="space-y-4"
    >
      <Tarjeta titulo="¿Qué llegó?">
        <p className="mb-3 text-sm text-slate-600 dark:text-slate-400">
          Contá lo que bajó de la camioneta. Si llegó menos, corregí la cantidad: la diferencia se
          registra como merma por <em>Diferencia en transferencia</em>.
        </p>
        <button
          type="button"
          onClick={() => {
            form.reset({ ...form.getValues(), lineas: todoLoEnviado().lineas });
          }}
          className={`${CLASE_BOTON_SECUNDARIO} mb-3`}
        >
          Llegó todo
        </button>
        <ul className="space-y-3">
          {transferencia.lineas.map((linea, indice) => {
            const unidad = linea.insumo.unidadBaseCodigo;
            const escrito = normalizarNumero(valores[indice]?.cantidadRecibida ?? '');
            const falta =
              esDecimalValido(escrito) && escrito !== ''
                ? aDecimal(linea.cantidadBaseEnviada).minus(escrito)
                : null;
            return (
              <li
                key={linea.id}
                className="grid gap-3 rounded-xl border border-slate-200 p-3 sm:grid-cols-[2fr_1fr] dark:border-slate-700"
              >
                <div>
                  <p className="font-medium">{linea.insumo.nombre}</p>
                  <p className="text-sm text-slate-600 dark:text-slate-400">
                    salieron {formatearCantidad(linea.cantidadBaseEnviada)} {unidad}
                  </p>
                  {falta !== null && falta.greaterThan(0) && (
                    <p className="text-sm font-semibold text-amber-800 dark:text-amber-300">
                      faltan {formatearCantidad(falta)} {unidad}: se registra como merma
                    </p>
                  )}
                  {falta !== null && falta.lessThan(0) && (
                    <p className="text-sm font-semibold text-red-700 dark:text-red-400">
                      no puede llegar más de lo que salió
                    </p>
                  )}
                </div>
                <Campo
                  etiqueta={`Llegaron (${unidad})`}
                  error={form.formState.errors.lineas?.[indice]?.cantidadRecibida?.message}
                >
                  <input
                    type="text"
                    inputMode="decimal"
                    className={CLASE_CONTROL}
                    {...form.register(
                      `lineas.${String(indice)}.cantidadRecibida` as 'lineas.0.cantidadRecibida',
                    )}
                  />
                </Campo>
              </li>
            );
          })}
        </ul>
      </Tarjeta>

      <Tarjeta titulo="Notas">
        <Campo etiqueta="Notas (opcional)" error={form.formState.errors.notas?.message}>
          <input
            type="text"
            placeholder="Una bolsa llegó rota..."
            className={CLASE_CONTROL}
            {...form.register('notas')}
          />
        </Campo>
      </Tarjeta>

      {errorGeneral !== null && <MensajeError>{errorGeneral}</MensajeError>}

      <div className="flex justify-end">
        <button type="submit" disabled={recibir.isPending} className={CLASE_BOTON_PRIMARIO}>
          {recibir.isPending ? 'Guardando...' : 'Confirmar recepción'}
        </button>
      </div>
    </form>
  );
}
