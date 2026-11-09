import { z } from 'zod';

import { MEDIOS_PAGO } from '../dominio/acopio.js';

/**
 * LOS REPORTES (Fase 12d): el período y la respuesta.
 *
 * Una sola respuesta trae todos los reportes del período: son pocos datos
 * (una panadería compra decenas de veces por mes, no miles), y así cambiar de
 * reporte en la pantalla no vuelve a preguntar nada.
 */

const Dia = z.iso.date('Fecha inválida');

/** El período, en días de Argentina. Vacío = los últimos 12 meses. */
export const FiltroReportesSchema = z
  .object({ desde: Dia.optional(), hasta: Dia.optional() })
  .refine(
    (filtro) =>
      filtro.desde === undefined || filtro.hasta === undefined || filtro.desde <= filtro.hasta,
    { error: '"Desde" tiene que ser antes que "hasta"', path: ['hasta'] },
  );
export type FiltroReportes = z.infer<typeof FiltroReportesSchema>;

const Ref = z.object({ id: z.string(), nombre: z.string() });
const MedioPagoSchema = z.enum(MEDIOS_PAGO);

export const ReportesSchema = z.object({
  desde: z.string(),
  hasta: z.string(),
  gastoPorMes: z.array(z.object({ mes: z.string(), comprado: z.string(), pagado: z.string() })),
  gastoPorProveedor: z.array(
    z.object({ proveedor: Ref, compras: z.number(), comprado: z.string() }),
  ),
  gastoPorInsumo: z.array(
    z.object({ insumo: Ref, unidad: z.string(), cantidadBase: z.string(), comprado: z.string() }),
  ),
  pagosPorMedio: z.object({
    totales: z.array(z.object({ medio: MedioPagoSchema, pagos: z.number(), total: z.string() })),
    porMes: z.array(
      z.object({
        mes: z.string(),
        EFECTIVO: z.string(),
        TRANSFERENCIA: z.string(),
        MERCADO_PAGO: z.string(),
      }),
    ),
  }),
  precios: z.array(
    z.object({
      insumoId: z.string(),
      fecha: z.string(),
      ordenId: z.string(),
      compraNumero: z.number(),
      proveedor: Ref,
      presentacion: z.string().nullable(),
      precioUnitario: z.string(),
      precioPorUnidadBase: z.string(),
    }),
  ),
  comparacion: z.array(
    z.object({
      insumo: Ref,
      unidad: z.string(),
      proveedores: z.array(
        z.object({
          proveedor: Ref,
          compras: z.number(),
          cantidadBase: z.string(),
          promedio: z.string(),
          minimo: z.string(),
          maximo: z.string(),
          ultimo: z.string(),
          masBarato: z.boolean(),
        }),
      ),
    }),
  ),
  cumplimiento: z.array(
    z.object({
      proveedor: Ref,
      compras: z.number(),
      completas: z.number(),
      cerradasConFaltante: z.number(),
      abiertas: z.number(),
      canceladas: z.number(),
      diasPromedio: z.number().nullable(),
      porcentajeEntregado: z.number().nullable(),
    }),
  ),
  entregasPorSemana: z.array(
    z.object({
      semana: z.string(),
      entregas: z.number(),
      valor: z.string(),
      renglones: z.array(
        z.object({
          recepcionId: z.string(),
          fecha: z.string(),
          entregaNumero: z.number(),
          compraNumero: z.number().nullable(),
          proveedor: Ref,
          sucursal: z.string(),
          insumo: z.string(),
          unidad: z.string(),
          presentacion: z.string().nullable(),
          cantidad: z.string(),
          valor: z.string(),
        }),
      ),
    }),
  ),
});
export type Reportes = z.infer<typeof ReportesSchema>;
