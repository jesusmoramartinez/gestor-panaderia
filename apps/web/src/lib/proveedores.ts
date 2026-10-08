import {
  type ActualizarProveedorInput,
  type ActualizarProveedorInsumoInput,
  type CrearProveedorInput,
  type CrearProveedorInsumoInput,
  type FiltroProveedores,
  ListaProveedoresDeInsumoSchema,
  ListaProveedoresSchema,
  ProveedorDetalleSchema,
} from '@panaderia/shared';

import { pedirApi } from './api';

function armarQuery(filtro: Partial<FiltroProveedores>): string {
  const params = new URLSearchParams();
  if (filtro.busqueda) params.set('busqueda', filtro.busqueda);
  if (filtro.incluirInactivos) params.set('incluirInactivos', 'true');
  return params.toString();
}

export function listarProveedores(filtro: Partial<FiltroProveedores>) {
  return pedirApi(`/api/proveedores?${armarQuery(filtro)}`, { esquema: ListaProveedoresSchema });
}

export function obtenerProveedor(id: string) {
  return pedirApi(`/api/proveedores/${id}`, { esquema: ProveedorDetalleSchema });
}

export function crearProveedor(entrada: CrearProveedorInput) {
  return pedirApi('/api/proveedores', {
    metodo: 'POST',
    cuerpo: entrada,
    esquema: ProveedorDetalleSchema,
  });
}

export function actualizarProveedor(id: string, entrada: ActualizarProveedorInput) {
  return pedirApi(`/api/proveedores/${id}`, {
    metodo: 'PATCH',
    cuerpo: entrada,
    esquema: ProveedorDetalleSchema,
  });
}

export function cambiarEstadoProveedor(id: string, activo: boolean) {
  return pedirApi(`/api/proveedores/${id}/${activo ? 'activar' : 'desactivar'}`, {
    metodo: 'POST',
    esquema: ProveedorDetalleSchema,
  });
}

export function asociarInsumo(proveedorId: string, entrada: CrearProveedorInsumoInput) {
  return pedirApi(`/api/proveedores/${proveedorId}/insumos`, {
    metodo: 'POST',
    cuerpo: entrada,
    esquema: ProveedorDetalleSchema,
  });
}

export function actualizarAsociacion(
  proveedorId: string,
  asociacionId: string,
  entrada: ActualizarProveedorInsumoInput,
) {
  return pedirApi(`/api/proveedores/${proveedorId}/insumos/${asociacionId}`, {
    metodo: 'PATCH',
    cuerpo: entrada,
    esquema: ProveedorDetalleSchema,
  });
}

/**
 * La vista espejo: los proveedores de UN insumo.
 *
 * Es la misma tabla puente leída desde la otra punta, y por eso el endpoint
 * cuelga de /insumos. Lo usa la ficha del insumo.
 */
export function listarProveedoresDeInsumo(insumoId: string) {
  return pedirApi(`/api/insumos/${insumoId}/proveedores`, {
    esquema: ListaProveedoresDeInsumoSchema,
  });
}
