import { ReposicionSchema, ResumenAlertasSchema } from '@panaderia/shared';

import { pedirApi } from './api';

export function obtenerReposicion(sucursalId?: string) {
  const query = sucursalId === undefined ? '' : `?sucursalId=${sucursalId}`;
  return pedirApi(`/api/reposicion${query}`, { esquema: ReposicionSchema });
}

export function obtenerAlertas(sucursalId: string) {
  return pedirApi(`/api/alertas?sucursalId=${sucursalId}`, { esquema: ResumenAlertasSchema });
}

/**
 * Lo que la reposición le pasa a otra pantalla para que arranque precargada.
 *
 * Viaja en el `state` de la navegación de React Router (no en la URL): es un
 * dato de esta visita, no algo que tenga sentido guardar en favoritos, y una
 * lista de líneas en la URL sería larguísima.
 */
export type PrecargaOrden = {
  tipo: 'orden';
  proveedorId: string;
  sucursalId: string;
  lineas: { insumoId: string; presentacionId: string; cantidad: string; precioUnitario: string }[];
};

export type PrecargaTransferencia = {
  tipo: 'transferencia';
  destinoId: string;
  lineas: { insumoId: string; cantidad: string }[];
};

/** Lee la precarga del `state`, verificando la forma: el state puede ser cualquier cosa. */
export function leerPrecarga<T extends PrecargaOrden | PrecargaTransferencia>(
  state: unknown,
  tipo: T['tipo'],
): T | null {
  if (typeof state !== 'object' || state === null) return null;
  const precarga = (state as { precarga?: { tipo?: unknown } }).precarga;
  return precarga?.tipo === tipo ? (precarga as T) : null;
}
