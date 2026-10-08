import { Navigate } from 'react-router';

import { useSesion } from '../hooks/useSesion';
import { LayoutPrivado } from './LayoutPrivado';

/**
 * Envuelve todas las pantallas que requieren sesión.
 *
 * Mientras pregunta al servidor muestra un cartel de carga; si el servidor
 * dice que no hay sesión, redirige al login.
 *
 * Importante: esto NO es seguridad. Cualquiera puede modificar el JavaScript
 * de su navegador y entrar a la pantalla. Lo que protege los datos es que la
 * API responda 401 a cada pedido sin sesión, y eso ya está probado con tests.
 * Esto es comodidad: evita mostrar una pantalla vacía y llena de errores.
 */
export function RutaProtegida() {
  const sesion = useSesion();

  if (sesion.isPending) {
    return (
      <div className="grid min-h-dvh place-items-center bg-masa dark:bg-horno">
        <p className="text-slate-500 dark:text-slate-400">Verificando sesión...</p>
      </div>
    );
  }

  if (sesion.isError || !sesion.data) {
    return <Navigate to="/login" replace />;
  }

  return <LayoutPrivado sesion={sesion.data} />;
}
