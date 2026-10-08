import {
  type AnularRecepcionInput,
  type CerrarOrdenInput,
  CostoInsumoSchema,
  type CrearOrdenInput,
  type EditarOrdenInput,
  type FiltroOrdenes,
  type FiltroRecepciones,
  type GuardarPlantillaInput,
  ListaOrdenesSchema,
  ListaPlantillasSchema,
  ListaRecepcionesSchema,
  OrdenDetalleSchema,
  PlantillaSchema,
  type RecepcionDeOrdenInput,
  RecepcionDetalleSchema,
  type RecepcionDirectaInput,
} from '@panaderia/shared';

import { pedirApi } from './api';

function armarQuery(valores: Record<string, string | boolean | number | undefined>): string {
  const params = new URLSearchParams();
  for (const [clave, valor] of Object.entries(valores)) {
    if (valor === undefined || valor === '' || valor === false) continue;
    params.set(clave, String(valor));
  }
  return params.toString();
}

// --- Órdenes ---------------------------------------------------------------

export function listarOrdenes(filtro: Partial<FiltroOrdenes>) {
  return pedirApi(`/api/ordenes-compra?${armarQuery({ ...filtro })}`, {
    esquema: ListaOrdenesSchema,
  });
}

export function obtenerOrden(id: string) {
  return pedirApi(`/api/ordenes-compra/${id}`, { esquema: OrdenDetalleSchema });
}

export function crearOrden(entrada: CrearOrdenInput) {
  return pedirApi('/api/ordenes-compra', {
    metodo: 'POST',
    cuerpo: entrada,
    esquema: OrdenDetalleSchema,
  });
}

export function editarOrden(id: string, entrada: EditarOrdenInput) {
  return pedirApi(`/api/ordenes-compra/${id}`, {
    metodo: 'PUT',
    cuerpo: entrada,
    esquema: OrdenDetalleSchema,
  });
}

/** Las tres transiciones manuales de la máquina de estados. */
export function transicionarOrden(
  id: string,
  accion: 'pedir' | 'cancelar' | 'cerrar',
  entrada: CerrarOrdenInput = { nota: null },
) {
  return pedirApi(`/api/ordenes-compra/${id}/${accion}`, {
    metodo: 'POST',
    cuerpo: entrada,
    esquema: OrdenDetalleSchema,
  });
}

export function recibirOrden(id: string, entrada: RecepcionDeOrdenInput) {
  return pedirApi(`/api/ordenes-compra/${id}/recepciones`, {
    metodo: 'POST',
    cuerpo: entrada,
    esquema: RecepcionDetalleSchema,
  });
}

// --- Recepciones -----------------------------------------------------------

export function listarRecepciones(filtro: Partial<FiltroRecepciones>) {
  return pedirApi(`/api/recepciones?${armarQuery({ ...filtro })}`, {
    esquema: ListaRecepcionesSchema,
  });
}

export function obtenerRecepcion(id: string) {
  return pedirApi(`/api/recepciones/${id}`, { esquema: RecepcionDetalleSchema });
}

export function recibirDirecta(entrada: RecepcionDirectaInput) {
  return pedirApi('/api/recepciones', {
    metodo: 'POST',
    cuerpo: entrada,
    esquema: RecepcionDetalleSchema,
  });
}

export function anularRecepcion(id: string, entrada: AnularRecepcionInput) {
  return pedirApi(`/api/recepciones/${id}/anular`, {
    metodo: 'POST',
    cuerpo: entrada,
    esquema: RecepcionDetalleSchema,
  });
}

export function obtenerCostoInsumo(insumoId: string) {
  return pedirApi(`/api/insumos/${insumoId}/costo`, { esquema: CostoInsumoSchema });
}

// --- Plantillas ------------------------------------------------------------

export function listarPlantillas(incluirInactivas = false) {
  return pedirApi(`/api/plantillas-pedido?${armarQuery({ incluirInactivas })}`, {
    esquema: ListaPlantillasSchema,
  });
}

export function obtenerPlantilla(id: string) {
  return pedirApi(`/api/plantillas-pedido/${id}`, { esquema: PlantillaSchema });
}

export function crearPlantilla(entrada: GuardarPlantillaInput) {
  return pedirApi('/api/plantillas-pedido', {
    metodo: 'POST',
    cuerpo: entrada,
    esquema: PlantillaSchema,
  });
}

export function editarPlantilla(id: string, entrada: GuardarPlantillaInput) {
  return pedirApi(`/api/plantillas-pedido/${id}`, {
    metodo: 'PUT',
    cuerpo: entrada,
    esquema: PlantillaSchema,
  });
}

export function cambiarEstadoPlantilla(id: string, activa: boolean) {
  return pedirApi(`/api/plantillas-pedido/${id}/${activa ? 'activar' : 'desactivar'}`, {
    metodo: 'POST',
    esquema: PlantillaSchema,
  });
}
