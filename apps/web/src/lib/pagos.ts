import {
  type AgregarComprobantesInput,
  type AnularPagoInput,
  OrdenDetalleSchema,
  RecepcionDetalleSchema,
  type RegistrarPagoInput,
} from '@panaderia/shared';

import { pedirApi } from './api';

/** Los pagos responden con la compra entera: la pantalla la reemplaza de una. */
export function registrarPago(ordenId: string, entrada: RegistrarPagoInput) {
  return pedirApi(`/api/ordenes-compra/${ordenId}/pagos`, {
    metodo: 'POST',
    cuerpo: entrada,
    esquema: OrdenDetalleSchema,
  });
}

export function anularPago(pagoId: string, entrada: AnularPagoInput) {
  return pedirApi(`/api/pagos/${pagoId}/anular`, {
    metodo: 'POST',
    cuerpo: entrada,
    esquema: OrdenDetalleSchema,
  });
}

export function agregarComprobantesAPago(pagoId: string, entrada: AgregarComprobantesInput) {
  return pedirApi(`/api/pagos/${pagoId}/comprobantes`, {
    metodo: 'POST',
    cuerpo: entrada,
    esquema: OrdenDetalleSchema,
  });
}

export function agregarComprobantesARecepcion(
  recepcionId: string,
  entrada: AgregarComprobantesInput,
) {
  return pedirApi(`/api/recepciones/${recepcionId}/comprobantes`, {
    metodo: 'POST',
    cuerpo: entrada,
    esquema: RecepcionDetalleSchema,
  });
}
