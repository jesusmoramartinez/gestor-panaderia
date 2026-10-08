import { EstadoSaludSchema } from '@panaderia/shared';

import { pedirApi } from './api';

export function obtenerSalud() {
  return pedirApi('/api/health', { esquema: EstadoSaludSchema });
}
