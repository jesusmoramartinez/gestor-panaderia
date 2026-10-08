import { LoginSchema, NOMBRE_SISTEMA } from '@panaderia/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent, type ReactNode } from 'react';
import { useNavigate } from 'react-router';

import { detallesPorCampo, ErrorDeApi } from '../lib/api';
import { CLAVE_SESION, iniciarSesion } from '../lib/sesion';

export function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [erroresLocales, setErroresLocales] = useState<Record<string, string>>({});

  const queryClient = useQueryClient();
  const navegar = useNavigate();

  const entrar = useMutation({
    mutationFn: iniciarSesion,
    onSuccess: (usuario) => {
      // El login ya devolvió los datos de la sesión, así que los guardamos en
      // el caché: la pantalla siguiente no necesita volver a pedir /auth/me.
      queryClient.setQueryData(CLAVE_SESION, usuario);
      void navegar('/', { replace: true });
    },
  });

  function enviar(evento: FormEvent): void {
    evento.preventDefault();

    // Validamos con el MISMO esquema que usa la API. Dos ventajas: el error
    // aparece sin ir al servidor, y si mañana cambia la regla cambia en los
    // dos lados a la vez.
    const resultado = LoginSchema.safeParse({ email, password });
    if (!resultado.success) {
      const porCampo: Record<string, string> = {};
      for (const problema of resultado.error.issues) {
        const campo = problema.path.join('.');
        porCampo[campo] ??= problema.message;
      }
      setErroresLocales(porCampo);
      return;
    }

    setErroresLocales({});
    entrar.mutate(resultado.data);
  }

  // Los errores de campo pueden venir de la validación local o del servidor.
  const erroresServidor = detallesPorCampo(entrar.error);
  const errorDe = (campo: string): string | undefined =>
    erroresLocales[campo] ?? erroresServidor[campo];

  const mensajeGeneral =
    entrar.error instanceof ErrorDeApi
      ? entrar.error.mensaje
      : entrar.error
        ? 'No se pudo contactar la API. ¿Está corriendo "pnpm dev"?'
        : null;

  return (
    <main className="grid min-h-dvh place-items-center bg-masa p-4 dark:bg-horno">
      <form
        onSubmit={enviar}
        noValidate
        className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-lg sm:p-8 dark:bg-slate-900"
      >
        <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-50">{NOMBRE_SISTEMA}</h1>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">Ingresá para continuar</p>

        <div className="mt-6 space-y-4">
          <Campo etiqueta="Email" error={errorDe('email')}>
            <input
              type="email"
              value={email}
              onChange={(evento) => {
                setEmail(evento.target.value);
              }}
              autoComplete="username"
              autoFocus
              className="min-h-12 w-full rounded-xl border border-slate-300 px-3 dark:border-slate-600 dark:bg-slate-800"
            />
          </Campo>

          <Campo etiqueta="Contraseña" error={errorDe('password')}>
            <input
              type="password"
              value={password}
              onChange={(evento) => {
                setPassword(evento.target.value);
              }}
              autoComplete="current-password"
              className="min-h-12 w-full rounded-xl border border-slate-300 px-3 dark:border-slate-600 dark:bg-slate-800"
            />
          </Campo>
        </div>

        {mensajeGeneral && (
          <p
            role="alert"
            className="mt-4 rounded-lg bg-red-50 p-3 text-sm text-red-800 dark:bg-red-950/50 dark:text-red-300"
          >
            {mensajeGeneral}
          </p>
        )}

        <button
          type="submit"
          disabled={entrar.isPending}
          className="mt-6 min-h-12 w-full rounded-xl bg-corteza px-4 font-semibold text-white transition active:scale-[0.99] disabled:opacity-50"
        >
          {entrar.isPending ? 'Verificando...' : 'Entrar'}
        </button>
      </form>
    </main>
  );
}

function Campo({
  etiqueta,
  error,
  children,
}: {
  etiqueta: string;
  error: string | undefined;
  children: ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-200">
        {etiqueta}
      </span>
      {children}
      {error && <span className="mt-1 block text-sm text-red-700 dark:text-red-400">{error}</span>}
    </label>
  );
}
