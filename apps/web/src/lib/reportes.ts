import { ReportesSchema } from '@panaderia/shared';

import { pedirApi } from './api';

/** Todos los reportes de un período ('AAAA-MM-DD'). */
export function obtenerReportes(desde: string, hasta: string) {
  const params = new URLSearchParams({ desde, hasta });
  return pedirApi(`/api/reportes?${params.toString()}`, { esquema: ReportesSchema });
}
