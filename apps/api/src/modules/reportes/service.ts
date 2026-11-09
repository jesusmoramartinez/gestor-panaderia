// CAPA 3 — SERVICIO: arma los reportes. Las cuentas son de shared (puras).
import {
  comparacionDeProveedores,
  type CompraReporte,
  cumplimientoDeProveedores,
  diaEnArgentina,
  entregasPorSemana,
  finDelDiaEnArgentina,
  type FiltroReportes,
  gastoPorInsumo,
  gastoPorMes,
  gastoPorProveedor,
  inicioDelDiaEnArgentina,
  pagosPorMedio,
  preciosPagados,
  type Reportes,
} from '@panaderia/shared';

import type { Contexto } from '../../lib/contexto.js';
import { recibidoPorRenglon } from '../acopio/repo.js';
import * as repo from './repo.js';

/** Sin fechas: desde el primer día de hace 11 meses hasta hoy (12 meses). */
function periodoPorDefecto(hoy: string): { desde: string; hasta: string } {
  const [anio, mes] = hoy.split('-').map(Number) as [number, number];
  const total = anio * 12 + (mes - 1) - 11;
  const desde = `${String(Math.floor(total / 12))}-${String((total % 12) + 1).padStart(2, '0')}-01`;
  return { desde, hasta: hoy };
}

export async function reportes(ctx: Contexto, filtro: FiltroReportes): Promise<Reportes> {
  const porDefecto = periodoPorDefecto(diaEnArgentina(new Date()));
  const desde = filtro.desde ?? porDefecto.desde;
  const hasta = filtro.hasta ?? porDefecto.hasta;
  const inicio = inicioDelDiaEnArgentina(desde);
  const fin = finDelDiaEnArgentina(hasta);

  // Fuera de una transacción: son lecturas y pueden ir en paralelo.
  const [filasCompras, filasPagos, filasEntregas] = await Promise.all([
    repo.compras(ctx.empresaId, ctx.sucursalesPermitidas, inicio, fin),
    repo.pagos(ctx.empresaId, ctx.sucursalesPermitidas, inicio, fin),
    repo.entregas(ctx.empresaId, ctx.sucursalesPermitidas, inicio, fin),
  ]);
  const ordenIds = filasCompras.map((compra) => compra.id);
  const [recibido, ultimaEntrega] = await Promise.all([
    recibidoPorRenglon(ordenIds),
    repo.ultimaEntregaPorCompra(ordenIds),
  ]);

  const compras: CompraReporte[] = filasCompras.map((compra) => ({
    id: compra.id,
    numero: compra.numero,
    estado: compra.estado,
    // El filtro exige pedidaAt: nunca es null acá.
    pedidaAt: (compra.pedidaAt ?? new Date(0)).toISOString(),
    proveedor: compra.proveedor,
    ultimaEntregaAt: ultimaEntrega.get(compra.id)?.toISOString() ?? null,
    renglones: compra.lineas.map((linea) => ({
      insumo: {
        id: linea.insumo.id,
        nombre: linea.insumo.nombre,
        unidad: linea.insumo.unidadBase.codigo,
      },
      presentacion: linea.presentacion?.nombre ?? null,
      cantidad: linea.cantidad.toString(),
      cantidadBase: linea.cantidadBase.toString(),
      factor: linea.factorConversion.toString(),
      precioUnitario: linea.precioUnitario?.toString() ?? null,
      recibidoBase: recibido.get(linea.id) ?? '0',
    })),
  }));
  const pagos = filasPagos.map((pago) => ({
    fecha: pago.fecha.toISOString(),
    monto: pago.monto.toString(),
    medio: pago.medio,
    proveedor: pago.orden.proveedor,
  }));
  const entregas = filasEntregas.map((entrega) => ({
    id: entrega.id,
    numero: entrega.numero,
    fecha: entrega.fecha.toISOString(),
    proveedor: entrega.proveedor,
    sucursal: entrega.sucursal.nombre,
    compraNumero: entrega.orden?.numero ?? null,
    renglones: entrega.lineas.map((linea) => ({
      insumo: {
        id: linea.insumo.id,
        nombre: linea.insumo.nombre,
        unidad: linea.insumo.unidadBase.codigo,
      },
      presentacion: linea.presentacion?.nombre ?? null,
      cantidad: linea.cantidad.toString(),
      precioUnitario: linea.precioUnitario.toString(),
    })),
  }));

  return {
    desde,
    hasta,
    gastoPorMes: gastoPorMes(compras, pagos, desde, hasta),
    gastoPorProveedor: gastoPorProveedor(compras),
    gastoPorInsumo: gastoPorInsumo(compras),
    pagosPorMedio: pagosPorMedio(pagos, desde, hasta),
    precios: preciosPagados(compras),
    comparacion: comparacionDeProveedores(compras),
    cumplimiento: cumplimientoDeProveedores(compras),
    entregasPorSemana: entregasPorSemana(entregas),
  };
}
