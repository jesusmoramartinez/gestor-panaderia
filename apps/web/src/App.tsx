import { Navigate, Route, Routes } from 'react-router';

import { RutaProtegida } from './components/RutaProtegida';
import { Inicio } from './routes/Inicio';
import { InsumoDetalle } from './routes/InsumoDetalle';
import { InsumoNuevo } from './routes/InsumoNuevo';
import { Insumos } from './routes/Insumos';
import { CargarMovimiento } from './routes/CargarMovimiento';
import { HistorialInsumo } from './routes/HistorialInsumo';
import { Login } from './routes/Login';
import { ProveedorDetalle } from './routes/ProveedorDetalle';
import { ProveedorNuevo } from './routes/ProveedorNuevo';
import { Proveedores } from './routes/Proveedores';
import { Stock } from './routes/Stock';

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
        <Route path="/insumos" element={<Insumos />} />
        {/* El orden importa: /insumos/nuevo tiene que ir ANTES de
            /insumos/:id, porque si no "nuevo" se tomaría como un id. */}
        <Route path="/insumos/nuevo" element={<InsumoNuevo />} />
        <Route path="/insumos/:id" element={<InsumoDetalle />} />

        <Route path="/proveedores" element={<Proveedores />} />
        {/* Igual que con los insumos: "nuevo" antes que ":id". */}
        <Route path="/proveedores/nuevo" element={<ProveedorNuevo />} />
        <Route path="/proveedores/:id" element={<ProveedorDetalle />} />

        <Route path="/stock" element={<Stock />} />
        {/* Las tres cargas son la misma pantalla con distinta configuración.
            Van ANTES de /stock/:insumoId, igual que /insumos/nuevo. */}
        <Route path="/stock/consumo" element={<CargarMovimiento clase="CONSUMO" />} />
        <Route path="/stock/merma" element={<CargarMovimiento clase="MERMA" />} />
        <Route path="/stock/saldo-inicial" element={<CargarMovimiento clase="SALDO_INICIAL" />} />
        <Route path="/stock/:insumoId" element={<HistorialInsumo />} />
      </Route>

      {/* Cualquier URL que no exista vuelve al inicio. */}
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
