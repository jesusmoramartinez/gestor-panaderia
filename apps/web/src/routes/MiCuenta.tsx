import { CambiarEmailSchema, CambiarPasswordFormSchema } from '@panaderia/shared';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useForm } from 'react-hook-form';

import {
  alEnviar,
  Campo,
  CLASE_BOTON_PRIMARIO,
  CLASE_CONTROL,
  MensajeError,
  Tarjeta,
} from '../components/formulario';
import { SelectorTema } from '../components/Tema';
import { useSesion } from '../hooks/useSesion';
import { aplicarErroresDelServidor } from '../lib/erroresFormulario';
import { CLAVE_SESION, cambiarEmail, cambiarPassword } from '../lib/sesion';

/**
 * MI CUENTA (Fase 12a): cambiar mi contraseña y el email con el que entro.
 *
 * Las dos cosas piden la contraseña actual: si alguien encuentra la sesión
 * abierta en la computadora de la panadería, no puede quedarse con la cuenta.
 */
export function MiCuenta() {
  const sesion = useSesion();

  return (
    <div className="mx-auto max-w-xl space-y-4">
      <div>
        <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-50">Mi cuenta</h1>
        {sesion.data !== undefined && (
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
            {sesion.data.nombre} · entrás con <strong>{sesion.data.email}</strong>
          </p>
        )}
      </div>
      <FormularioPassword />
      <FormularioEmail emailActual={sesion.data?.email ?? ''} />
      {/* En el celular el selector de tema no está en el encabezado: va acá. */}
      <Tarjeta titulo="Apariencia">
        <p className="mb-3 text-sm text-slate-600 dark:text-slate-400">
          Claro, oscuro, o automático según el teléfono o la computadora.
        </p>
        <SelectorTema />
      </Tarjeta>
    </div>
  );
}

function FormularioPassword() {
  const [listo, setListo] = useState(false);
  const [errorGeneral, setErrorGeneral] = useState<string | null>(null);
  const form = useForm({
    resolver: zodResolver(CambiarPasswordFormSchema),
    defaultValues: { actual: '', nueva: '', repetir: '' },
  });

  const cambiar = useMutation({
    mutationFn: cambiarPassword,
    onSuccess: () => {
      setListo(true);
      form.reset();
    },
    onError: (error) => {
      setErrorGeneral(aplicarErroresDelServidor(error, form.setError));
    },
  });

  return (
    <Tarjeta titulo="Cambiar la contraseña">
      <form
        noValidate
        className="space-y-4"
        onSubmit={alEnviar(
          form.handleSubmit((valores) => {
            setListo(false);
            setErrorGeneral(null);
            cambiar.mutate({ actual: valores.actual, nueva: valores.nueva });
          }),
        )}
      >
        <Campo etiqueta="Contraseña actual" error={form.formState.errors.actual?.message}>
          <input
            type="password"
            autoComplete="current-password"
            className={CLASE_CONTROL}
            {...form.register('actual')}
          />
        </Campo>
        <Campo
          etiqueta="Contraseña nueva"
          ayuda="Al menos 8 caracteres. Mejor una frase que solo vos sepas."
          error={form.formState.errors.nueva?.message}
        >
          <input
            type="password"
            autoComplete="new-password"
            className={CLASE_CONTROL}
            {...form.register('nueva')}
          />
        </Campo>
        <Campo etiqueta="Repetí la nueva" error={form.formState.errors.repetir?.message}>
          <input
            type="password"
            autoComplete="new-password"
            className={CLASE_CONTROL}
            {...form.register('repetir')}
          />
        </Campo>
        {errorGeneral !== null && <MensajeError>{errorGeneral}</MensajeError>}
        {listo && (
          <p
            role="status"
            className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300"
          >
            Listo: la contraseña cambió. Si tenías la sesión abierta en otro lado, quedó cerrada.
          </p>
        )}
        <button type="submit" disabled={cambiar.isPending} className={CLASE_BOTON_PRIMARIO}>
          {cambiar.isPending ? 'Cambiando...' : 'Cambiar contraseña'}
        </button>
      </form>
    </Tarjeta>
  );
}

function FormularioEmail({ emailActual }: { emailActual: string }) {
  const queryClient = useQueryClient();
  const [listo, setListo] = useState(false);
  const [errorGeneral, setErrorGeneral] = useState<string | null>(null);
  const form = useForm({
    resolver: zodResolver(CambiarEmailSchema),
    defaultValues: { email: '', password: '' },
  });

  const cambiar = useMutation({
    mutationFn: cambiarEmail,
    onSuccess: (sesion) => {
      // El encabezado y esta pantalla muestran el email: se actualizan solos.
      queryClient.setQueryData(CLAVE_SESION, sesion);
      setListo(true);
      form.reset();
    },
    onError: (error) => {
      setErrorGeneral(aplicarErroresDelServidor(error, form.setError));
    },
  });

  return (
    <Tarjeta titulo="Cambiar el email con el que entrás">
      <form
        noValidate
        className="space-y-4"
        onSubmit={alEnviar(
          form.handleSubmit((valores) => {
            setListo(false);
            setErrorGeneral(null);
            cambiar.mutate(valores);
          }),
        )}
      >
        <Campo etiqueta="Email nuevo" error={form.formState.errors.email?.message}>
          <input
            type="email"
            autoComplete="email"
            inputMode="email"
            placeholder={emailActual}
            className={CLASE_CONTROL}
            {...form.register('email')}
          />
        </Campo>
        <Campo etiqueta="Tu contraseña" error={form.formState.errors.password?.message}>
          <input
            type="password"
            autoComplete="current-password"
            className={CLASE_CONTROL}
            {...form.register('password')}
          />
        </Campo>
        {errorGeneral !== null && <MensajeError>{errorGeneral}</MensajeError>}
        {listo && (
          <p
            role="status"
            className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300"
          >
            Listo: desde ahora entrás con el email nuevo.
          </p>
        )}
        <button type="submit" disabled={cambiar.isPending} className={CLASE_BOTON_PRIMARIO}>
          {cambiar.isPending ? 'Cambiando...' : 'Cambiar email'}
        </button>
      </form>
    </Tarjeta>
  );
}
