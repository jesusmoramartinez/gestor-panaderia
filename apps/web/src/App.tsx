import { Navigate, Route, Routes } from 'react-router';

import { RutaProtegida } from './components/RutaProtegida';
import { Inicio } from './routes/Inicio';
import { Login } from './routes/Login';

/**
 * El mapa de pantallas de la aplicación.
 *
 * El <Route> sin `path` que envuelve a los demás es una "ruta de layout": no
 * tiene URL propia, solo agrupa. RutaProtegida verifica la sesión una vez y
 * dibuja el encabezado común; las pantallas de adentro aparecen en su <Outlet>.
 */
export function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />

      <Route element={<RutaProtegida />}>
        <Route path="/" element={<Inicio />} />
      </Route>

      {/* Cualquier URL que no exista vuelve al inicio. */}
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
