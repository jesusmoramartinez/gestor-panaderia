import {
  type ActualizarInsumoInput,
  type ActualizarPresentacionInput,
  CategoriaSchema,
  type CrearInsumoInput,
  type CrearPresentacionInput,
  type FiltroInsumos,
  InsumoDetalleSchema,
  ListadoInsumosSchema,
  ListaUnidadesSchema,
  type ParametrosSucursalInput,
} from '@panaderia/shared';
import { z } from 'zod';

import { pedirApi } from './api';

/** Lo que el listado necesita del filtro; todo opcional menos la paginación. */
export type FiltroListado = Partial<Omit<FiltroInsumos, 'limite' | 'desplazamiento'>> & {
  limite: number;
  desplazamiento: number;
};

function armarQuery(filtro: FiltroListado): string {
  const params = new URLSearchParams();
  if (filtro.busqueda) params.set('busqueda', filtro.busqueda);
  if (filtro.categoriaId) params.set('categoriaId', filtro.categoriaId);
  if (filtro.incluirInactivos) params.set('incluirInactivos', 'true');
  params.set('limite', String(filtro.limite));
  params.set('desplazamiento', String(filtro.desplazamiento));
  return params.toString();
}

export function listarInsumos(filtro: FiltroListado) {
  return pedirApi(`/api/insumos?${armarQuery(filtro)}`, { esquema: ListadoInsumosSchema });
}

export function obtenerInsumo(id: string) {
  return pedirApi(`/api/insumos/${id}`, { esquema: InsumoDetalleSchema });
}

export function crearInsumo(entrada: CrearInsumoInput) {
  return pedirApi('/api/insumos', {
    metodo: 'POST',
    cuerpo: entrada,
    esquema: InsumoDetalleSchema,
  });
}

export function actualizarInsumo(id: string, entrada: ActualizarInsumoInput) {
  return pedirApi(`/api/insumos/${id}`, {
    metodo: 'PATCH',
    cuerpo: entrada,
    esquema: InsumoDetalleSchema,
  });
}

export function cambiarEstadoInsumo(id: string, activo: boolean) {
  return pedirApi(`/api/insumos/${id}/${activo ? 'activar' : 'desactivar'}`, {
    metodo: 'POST',
    esquema: InsumoDetalleSchema,
  });
}

export function crearPresentacion(insumoId: string, entrada: CrearPresentacionInput) {
  return pedirApi(`/api/insumos/${insumoId}/presentaciones`, {
    metodo: 'POST',
    cuerpo: entrada,
    esquema: InsumoDetalleSchema,
  });
}

export function actualizarPresentacion(
  insumoId: string,
  presentacionId: string,
  entrada: ActualizarPresentacionInput,
) {
  return pedirApi(`/api/insumos/${insumoId}/presentaciones/${presentacionId}`, {
    metodo: 'PATCH',
    cuerpo: entrada,
    esquema: InsumoDetalleSchema,
  });
}

export function definirParametrosSucursal(
  insumoId: string,
  sucursalId: string,
  entrada: ParametrosSucursalInput,
) {
  return pedirApi(`/api/insumos/${insumoId}/sucursales/${sucursalId}`, {
    metodo: 'PUT',
    cuerpo: entrada,
    esquema: InsumoDetalleSchema,
  });
}

export function listarCategorias() {
  return pedirApi('/api/categorias', { esquema: z.array(CategoriaSchema) });
}

export function crearCategoria(nombre: string) {
  return pedirApi('/api/categorias', {
    metodo: 'POST',
    cuerpo: { nombre },
    esquema: CategoriaSchema,
  });
}

export function listarUnidades() {
  return pedirApi('/api/unidades', { esquema: ListaUnidadesSchema });
}
