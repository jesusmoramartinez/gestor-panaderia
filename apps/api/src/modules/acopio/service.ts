// CAPA 3 — SERVICIO: las reglas del negocio. No sabe que existe HTTP.
import {
  aDecimal,
  type CompraAbierta,
  cuentaDeCompra,
  cuentaDeRenglon,
  type DeudaProveedor,
  diaEnArgentina,
  diasEntre,
  type LoQueMeDeben,
  type PlataAFavor,
  type RenglonDeuda,
  redondearDinero,
} from '@panaderia/shared';

import type { Contexto } from '../../lib/contexto.js';
import * as repo from './repo.js';

/**
 * LO QUE ME DEBEN (Fase 12a): la pantalla principal del MVP.
 *
 * Responde "¿qué me deben, a quién y de qué compra?" sumando las compras que
 * todavía esperan mercadería. No guarda nada: es una foto calculada en el
 * momento desde las órdenes, las entregas y los pagos (regla 15: todo valor
 * derivado se reconstruye desde los hechos).
 */
export async function loQueMeDeben(ctx: Contexto): Promise<LoQueMeDeben> {
  const compras = await repo.comprasAbiertas(ctx.empresaId, ctx.sucursalesPermitidas);
  const ordenIds = compras.map((compra) => compra.id);
  const recibido = await repo.recibidoPorRenglon(ordenIds);
  const pagado = await repo.pagadoPorCompra(ordenIds);
  const hoy = diaEnArgentina(new Date());

  const porProveedor = new Map<string, DeudaProveedor>();
  const comprasAbiertas: CompraAbierta[] = [];
  let valorPendienteTotal = aDecimal('0');
  let adelantadoTotal = aDecimal('0');

  for (const compra of compras) {
    const renglones = compra.lineas.map((linea) => ({
      linea,
      entrada: {
        cantidad: linea.cantidad.toString(),
        cantidadBase: linea.cantidadBase.toString(),
        recibidoBase: recibido.get(linea.id) ?? '0',
        factor: linea.factorConversion.toString(),
        precioUnitario: linea.precioUnitario?.toString() ?? null,
      },
    }));
    const cuenta = cuentaDeCompra(
      renglones.map((renglon) => renglon.entrada),
      pagado.get(compra.id) ?? '0',
    );

    const deuda = porProveedor.get(compra.proveedor.id) ?? {
      proveedor: compra.proveedor,
      valorPendiente: '0',
      adelantadoSinEntregar: '0',
      renglonesSinPrecio: 0,
      renglones: [] as RenglonDeuda[],
    };

    for (const { linea, entrada } of renglones) {
      const cuentaRenglon = cuentaDeRenglon(entrada);
      // Solo lo que falta: un renglón completo de una compra parcial ya no
      // le debe nada.
      if (cuentaRenglon.pendiente.isZero()) continue;
      deuda.renglones.push({
        ordenId: compra.id,
        ordenNumero: compra.numero,
        insumo: {
          id: linea.insumo.id,
          nombre: linea.insumo.nombre,
          unidadBaseCodigo: linea.insumo.unidadBase.codigo,
        },
        presentacion: linea.presentacion,
        pendiente: cuentaRenglon.pendiente.toString(),
        pendienteBase: cuentaRenglon.pendienteBase.toString(),
        precioUnitario: entrada.precioUnitario,
        valorPendiente: cuentaRenglon.valorPendiente?.toString() ?? null,
      });
      if (cuentaRenglon.valorPendiente === null) deuda.renglonesSinPrecio += 1;
    }

    deuda.valorPendiente = redondearDinero(
      aDecimal(deuda.valorPendiente).plus(cuenta.valorPendiente),
    ).toString();
    deuda.adelantadoSinEntregar = redondearDinero(
      aDecimal(deuda.adelantadoSinEntregar).plus(cuenta.adelantadoSinEntregar),
    ).toString();
    porProveedor.set(compra.proveedor.id, deuda);

    valorPendienteTotal = valorPendienteTotal.plus(cuenta.valorPendiente);
    adelantadoTotal = adelantadoTotal.plus(cuenta.adelantadoSinEntregar);

    const desde = compra.pedidaAt ?? compra.createdAt;
    comprasAbiertas.push({
      id: compra.id,
      numero: compra.numero,
      estado: compra.estado,
      proveedor: compra.proveedor,
      sucursal: compra.sucursal,
      pedidaAt: compra.pedidaAt?.toISOString() ?? null,
      diasAbierta: diasEntre(diaEnArgentina(desde), hoy),
      total: cuenta.total?.toString() ?? null,
      valorRecibido: cuenta.valorRecibido.toString(),
      valorPendiente: cuenta.valorPendiente.toString(),
    });
  }

  // Las terminadas que se pagaron de más: plata a favor.
  const terminadas = await repo.comprasTerminadasConPagos(ctx.empresaId, ctx.sucursalesPermitidas);
  const idsTerminadas = terminadas.map((compra) => compra.id);
  const recibidoTerminadas = await repo.recibidoPorRenglon(idsTerminadas);
  const pagadoTerminadas = await repo.pagadoPorCompra(idsTerminadas);
  const aFavor: PlataAFavor[] = [];
  for (const compra of terminadas) {
    const cuenta = cuentaDeCompra(
      compra.lineas.map((linea) => ({
        cantidad: linea.cantidad.toString(),
        cantidadBase: linea.cantidadBase.toString(),
        recibidoBase: recibidoTerminadas.get(linea.id) ?? '0',
        factor: linea.factorConversion.toString(),
        precioUnitario: linea.precioUnitario?.toString() ?? null,
      })),
      pagadoTerminadas.get(compra.id) ?? '0',
    );
    if (cuenta.adelantadoSinEntregar.isZero()) continue;
    aFavor.push({
      id: compra.id,
      numero: compra.numero,
      estado: compra.estado,
      proveedor: compra.proveedor,
      monto: cuenta.adelantadoSinEntregar.toString(),
    });
    adelantadoTotal = adelantadoTotal.plus(cuenta.adelantadoSinEntregar);
  }

  return {
    valorPendiente: redondearDinero(valorPendienteTotal).toString(),
    adelantadoSinEntregar: redondearDinero(adelantadoTotal).toString(),
    aFavor,
    // El que más le debe, primero: es a quien hay que llamar.
    proveedores: [...porProveedor.values()]
      .filter((deuda) => deuda.renglones.length > 0)
      .sort(
        (a, b) =>
          aDecimal(b.valorPendiente).comparedTo(aDecimal(a.valorPendiente)) ||
          a.proveedor.nombre.localeCompare(b.proveedor.nombre, 'es'),
      ),
    comprasAbiertas,
  };
}
