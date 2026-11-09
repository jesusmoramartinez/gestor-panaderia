import { LoQueMeDebenSchema } from '@panaderia/shared';

import { pedirApi } from './api';

/** La pantalla principal del MVP: qué le deben, a quién y de qué compra. */
export function obtenerLoQueMeDeben() {
  return pedirApi('/api/acopio/me-deben', { esquema: LoQueMeDebenSchema });
}
