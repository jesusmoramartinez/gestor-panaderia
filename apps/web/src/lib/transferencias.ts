import {
  type AnularTransferenciaInput,
  type EnviarTransferenciaInput,
  type FiltroTransferencias,
  ListaSucursalesSchema,
  ListaTransferenciasSchema,
  type RecibirTransferenciaInput,
  TransferenciaDetalleSchema,
} from '@panaderia/shared';

import { pedirApi } from './api';

export function listarSucursales() {
  return pedirApi('/api/sucursales', { esquema: ListaSucursalesSchema });
}

export function listarTransferencias(
  filtro: Partial<FiltroTransferencias> & { sucursalId: string },
) {
  const params = new URLSearchParams();
  for (const [clave, valor] of Object.entries(filtro)) {
    if (valor !== undefined) params.set(clave, String(valor));
  }
  return pedirApi(`/api/transferencias?${params.toString()}`, {
    esquema: ListaTransferenciasSchema,
  });
}

export function obtenerTransferencia(id: string) {
  return pedirApi(`/api/transferencias/${id}`, { esquema: TransferenciaDetalleSchema });
}

export function enviarTransferencia(entrada: EnviarTransferenciaInput) {
  return pedirApi('/api/transferencias', {
    metodo: 'POST',
    cuerpo: entrada,
    esquema: TransferenciaDetalleSchema,
  });
}

export function recibirTransferencia(id: string, entrada: RecibirTransferenciaInput) {
  return pedirApi(`/api/transferencias/${id}/recibir`, {
    metodo: 'POST',
    cuerpo: entrada,
    esquema: TransferenciaDetalleSchema,
  });
}

export function anularTransferencia(id: string, entrada: AnularTransferenciaInput) {
  return pedirApi(`/api/transferencias/${id}/anular`, {
    metodo: 'POST',
    cuerpo: entrada,
    esquema: TransferenciaDetalleSchema,
  });
}
