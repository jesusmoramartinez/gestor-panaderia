import { PanelStock } from '../components/PanelStock';
import { LoQueMeDeben } from './LoQueMeDeben';

/**
 * LA PRIMERA PANTALLA de quien ve compras (el dueño): lo que HAY (el stock)
 * y lo que le DEBEN (el acopio), lado a lado. En la PC sobra ancho, así que
 * van en dos columnas; en el celular, una abajo de la otra.
 */
export function Principal() {
  return (
    <div className="grid items-start gap-6 lg:grid-cols-2">
      <PanelStock />
      <LoQueMeDeben enInicio />
    </div>
  );
}
