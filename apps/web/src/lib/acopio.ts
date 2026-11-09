import {
  type AgregarNotaInput,
  HistorialCompraSchema,
  LoQueMeDebenSchema,
} from '@panaderia/shared';

import { pedirApi } from './api';

/** La pantalla principal del MVP: qué le deben, a quién y de qué compra. */
export function obtenerLoQueMeDeben() {
  return pedirApi('/api/acopio/me-deben', { esquema: LoQueMeDebenSchema });
}

/** El historial de una compra: creada, pagos, entregas, notas, cierre. */
export function obtenerHistorial(ordenId: string) {
  return pedirApi(`/api/ordenes-compra/${ordenId}/historial`, { esquema: HistorialCompraSchema });
}

export function agregarNota(ordenId: string, entrada: AgregarNotaInput) {
  return pedirApi(`/api/ordenes-compra/${ordenId}/notas`, {
    metodo: 'POST',
    cuerpo: entrada,
    esquema: HistorialCompraSchema,
  });
}
