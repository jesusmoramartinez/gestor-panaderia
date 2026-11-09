/**
 * LOS REPORTES (Etapa 2, Fase 12d): "todo reporte que se pueda hacer de los
 * datos ingresados" (C-26).
 *
 * Todas son funciones PURAS: reciben las filas del período (compras, pagos,
 * entregas) y devuelven el reporte. La API solo trae las filas; las cuentas
 * se prueban acá sin base de datos (reportes.test.ts), con números conocidos.
 *
 * Qué es cada cosa, para que los números no se contradigan:
 *   - COMPRADO: lo que valen las compras (cantidad × precio de cada compra),
 *     por la fecha en que se PIDIERON. Las canceladas y los borradores no
 *     cuentan: no son una compra.
 *   - PAGADO: la plata que salió, por la fecha de cada PAGO (sin anulados).
 *   Como Marcelo paga por adelantado, casi siempre van juntos; si no, la
 *   diferencia es justamente lo que falta pagar.
 */
import { diasEntre, type MedioPago, MEDIOS_PAGO } from './acopio.js';
import { aDecimal, type Decimal, redondearCantidad, redondearDinero } from './decimal.js';
import { diaEnArgentina } from './fecha.js';

type Ref = { id: string; nombre: string };

export type RenglonCompraReporte = {
  insumo: Ref & { unidad: string };
  presentacion: string | null;
  /** En presentaciones. */
  cantidad: string;
  cantidadBase: string;
  factor: string;
  precioUnitario: string | null;
  recibidoBase: string;
};

export type CompraReporte = {
  id: string;
  numero: number;
  estado: string;
  /** ISO: cuándo se pidió. */
  pedidaAt: string;
  proveedor: Ref;
  renglones: RenglonCompraReporte[];
  /** ISO de la última entrega confirmada, o null. */
  ultimaEntregaAt: string | null;
};

export type PagoReporte = { fecha: string; monto: string; medio: MedioPago; proveedor: Ref };

export type EntregaReporte = {
  id: string;
  numero: number;
  fecha: string;
  proveedor: Ref;
  sucursal: string;
  compraNumero: number | null;
  renglones: {
    insumo: Ref & { unidad: string };
    presentacion: string | null;
    cantidad: string;
    precioUnitario: string;
  }[];
};

const cero = (): Decimal => aDecimal('0');
const comoTexto = (valor: Decimal): string => redondearDinero(valor).toString();
const esCompraDeVerdad = (compra: CompraReporte) =>
  compra.estado !== 'CANCELADA' && compra.estado !== 'BORRADOR';

function valorDe(renglon: { cantidad: string; precioUnitario: string | null }): Decimal {
  return renglon.precioUnitario === null
    ? cero()
    : aDecimal(renglon.cantidad).times(renglon.precioUnitario);
}

/** 'AAAA-MM' en hora de Argentina. */
export function mesDe(instante: string): string {
  return diaEnArgentina(new Date(instante)).slice(0, 7);
}

/** Todos los meses entre dos días, inclusive: así un mes sin compras aparece en cero. */
export function mesesEntre(desde: string, hasta: string): string[] {
  const meses: string[] = [];
  let [anio, mes] = desde.slice(0, 7).split('-').map(Number) as [number, number];
  const fin = hasta.slice(0, 7);
  for (let vuelta = 0; vuelta < 600; vuelta += 1) {
    const actual = `${String(anio)}-${String(mes).padStart(2, '0')}`;
    meses.push(actual);
    if (actual >= fin) break;
    mes += 1;
    if (mes > 12) {
      mes = 1;
      anio += 1;
    }
  }
  return meses;
}

/** El lunes de la semana de un día (las semanas empiezan el lunes). */
export function lunesDe(dia: string): string {
  const fecha = new Date(`${dia}T00:00:00Z`);
  const desdeLunes = (fecha.getUTCDay() + 6) % 7;
  fecha.setUTCDate(fecha.getUTCDate() - desdeLunes);
  return fecha.toISOString().slice(0, 10);
}

// ===========================================================================
// 4. Gasto por mes
// ===========================================================================

export type GastoMes = { mes: string; comprado: string; pagado: string };

export function gastoPorMes(
  compras: readonly CompraReporte[],
  pagos: readonly PagoReporte[],
  desde: string,
  hasta: string,
): GastoMes[] {
  const comprado = new Map<string, Decimal>();
  const pagado = new Map<string, Decimal>();
  for (const compra of compras.filter(esCompraDeVerdad)) {
    const mes = mesDe(compra.pedidaAt);
    const valor = compra.renglones.reduce((suma, r) => suma.plus(valorDe(r)), cero());
    comprado.set(mes, (comprado.get(mes) ?? cero()).plus(valor));
  }
  for (const pago of pagos) {
    const mes = mesDe(pago.fecha);
    pagado.set(mes, (pagado.get(mes) ?? cero()).plus(pago.monto));
  }
  return mesesEntre(desde, hasta).map((mes) => ({
    mes,
    comprado: comoTexto(comprado.get(mes) ?? cero()),
    pagado: comoTexto(pagado.get(mes) ?? cero()),
  }));
}

// ===========================================================================
// 5. Gasto por proveedor y por insumo
// ===========================================================================

export type GastoProveedor = { proveedor: Ref; compras: number; comprado: string };
export type GastoInsumo = { insumo: Ref; unidad: string; cantidadBase: string; comprado: string };

export function gastoPorProveedor(compras: readonly CompraReporte[]): GastoProveedor[] {
  const porId = new Map<string, { proveedor: Ref; compras: number; comprado: Decimal }>();
  for (const compra of compras.filter(esCompraDeVerdad)) {
    const fila = porId.get(compra.proveedor.id) ?? {
      proveedor: compra.proveedor,
      compras: 0,
      comprado: cero(),
    };
    fila.compras += 1;
    fila.comprado = compra.renglones.reduce((suma, r) => suma.plus(valorDe(r)), fila.comprado);
    porId.set(compra.proveedor.id, fila);
  }
  return [...porId.values()]
    .sort((a, b) => b.comprado.comparedTo(a.comprado))
    .map((fila) => ({ ...fila, comprado: comoTexto(fila.comprado) }));
}

export function gastoPorInsumo(compras: readonly CompraReporte[]): GastoInsumo[] {
  const porId = new Map<
    string,
    { insumo: Ref; unidad: string; cantidadBase: Decimal; comprado: Decimal }
  >();
  for (const compra of compras.filter(esCompraDeVerdad)) {
    for (const renglon of compra.renglones) {
      const fila = porId.get(renglon.insumo.id) ?? {
        insumo: { id: renglon.insumo.id, nombre: renglon.insumo.nombre },
        unidad: renglon.insumo.unidad,
        cantidadBase: cero(),
        comprado: cero(),
      };
      fila.cantidadBase = fila.cantidadBase.plus(renglon.cantidadBase);
      fila.comprado = fila.comprado.plus(valorDe(renglon));
      porId.set(renglon.insumo.id, fila);
    }
  }
  return [...porId.values()]
    .sort((a, b) => b.comprado.comparedTo(a.comprado))
    .map((fila) => ({
      ...fila,
      cantidadBase: redondearCantidad(fila.cantidadBase).toString(),
      comprado: comoTexto(fila.comprado),
    }));
}

// ===========================================================================
// 6. Pagos por medio
// ===========================================================================

export type PagosPorMedio = {
  totales: { medio: MedioPago; pagos: number; total: string }[];
  porMes: ({ mes: string } & Record<MedioPago, string>)[];
};

export function pagosPorMedio(
  pagos: readonly PagoReporte[],
  desde: string,
  hasta: string,
): PagosPorMedio {
  const totales = new Map(MEDIOS_PAGO.map((medio) => [medio, { pagos: 0, total: cero() }]));
  const porMes = new Map<string, Map<MedioPago, Decimal>>();
  for (const pago of pagos) {
    const total = totales.get(pago.medio);
    if (total) {
      total.pagos += 1;
      total.total = total.total.plus(pago.monto);
    }
    const mes = mesDe(pago.fecha);
    const delMes = porMes.get(mes) ?? new Map<MedioPago, Decimal>();
    delMes.set(pago.medio, (delMes.get(pago.medio) ?? cero()).plus(pago.monto));
    porMes.set(mes, delMes);
  }
  return {
    totales: MEDIOS_PAGO.map((medio) => ({
      medio,
      pagos: totales.get(medio)?.pagos ?? 0,
      total: comoTexto(totales.get(medio)?.total ?? cero()),
    })),
    porMes: mesesEntre(desde, hasta).map((mes) => {
      const delMes = porMes.get(mes);
      return {
        mes,
        EFECTIVO: comoTexto(delMes?.get('EFECTIVO') ?? cero()),
        TRANSFERENCIA: comoTexto(delMes?.get('TRANSFERENCIA') ?? cero()),
        MERCADO_PAGO: comoTexto(delMes?.get('MERCADO_PAGO') ?? cero()),
      };
    }),
  };
}

// ===========================================================================
// 7. Evolución del precio · 8. Comparación de proveedores
// ===========================================================================

export type PrecioPagado = {
  insumoId: string;
  fecha: string;
  ordenId: string;
  compraNumero: number;
  proveedor: Ref;
  presentacion: string | null;
  precioUnitario: string;
  /**
   * El precio por UNIDAD BASE (por kg): la única forma de comparar una
   * bolsa de 25 kg con una de 50, o al molino con el mayorista.
   */
  precioPorUnidadBase: string;
};

/** Cada precio que se pagó por cada insumo, en orden de fecha. */
export function preciosPagados(compras: readonly CompraReporte[]): PrecioPagado[] {
  const filas: PrecioPagado[] = [];
  for (const compra of compras.filter(esCompraDeVerdad)) {
    for (const renglon of compra.renglones) {
      if (renglon.precioUnitario === null) continue;
      filas.push({
        insumoId: renglon.insumo.id,
        fecha: compra.pedidaAt,
        ordenId: compra.id,
        compraNumero: compra.numero,
        proveedor: compra.proveedor,
        presentacion: renglon.presentacion,
        precioUnitario: renglon.precioUnitario,
        precioPorUnidadBase: comoTexto(aDecimal(renglon.precioUnitario).dividedBy(renglon.factor)),
      });
    }
  }
  return filas.sort((a, b) => Date.parse(a.fecha) - Date.parse(b.fecha));
}

export type ComparacionInsumo = {
  insumo: Ref;
  unidad: string;
  proveedores: {
    proveedor: Ref;
    compras: number;
    cantidadBase: string;
    /** Promedio PONDERADO por lo que se compró a cada precio. */
    promedio: string;
    minimo: string;
    maximo: string;
    ultimo: string;
    masBarato: boolean;
  }[];
};

export function comparacionDeProveedores(compras: readonly CompraReporte[]): ComparacionInsumo[] {
  type Acumulado = {
    proveedor: Ref;
    compras: Set<string>;
    cantidadBase: Decimal;
    gastado: Decimal;
    minimo: Decimal | null;
    maximo: Decimal | null;
    ultimo: { fecha: number; precio: Decimal } | null;
  };
  const porInsumo = new Map<
    string,
    { insumo: Ref; unidad: string; porProveedor: Map<string, Acumulado> }
  >();

  for (const compra of compras.filter(esCompraDeVerdad)) {
    for (const renglon of compra.renglones) {
      if (renglon.precioUnitario === null) continue;
      const precioBase = aDecimal(renglon.precioUnitario).dividedBy(renglon.factor);
      const insumo = porInsumo.get(renglon.insumo.id) ?? {
        insumo: { id: renglon.insumo.id, nombre: renglon.insumo.nombre },
        unidad: renglon.insumo.unidad,
        porProveedor: new Map<string, Acumulado>(),
      };
      const acumulado = insumo.porProveedor.get(compra.proveedor.id) ?? {
        proveedor: compra.proveedor,
        compras: new Set<string>(),
        cantidadBase: cero(),
        gastado: cero(),
        minimo: null,
        maximo: null,
        ultimo: null,
      };
      acumulado.compras.add(compra.id);
      acumulado.cantidadBase = acumulado.cantidadBase.plus(renglon.cantidadBase);
      acumulado.gastado = acumulado.gastado.plus(valorDe(renglon));
      acumulado.minimo =
        acumulado.minimo === null || precioBase.lessThan(acumulado.minimo)
          ? precioBase
          : acumulado.minimo;
      acumulado.maximo =
        acumulado.maximo === null || precioBase.greaterThan(acumulado.maximo)
          ? precioBase
          : acumulado.maximo;
      const fecha = Date.parse(compra.pedidaAt);
      if (acumulado.ultimo === null || fecha >= acumulado.ultimo.fecha) {
        acumulado.ultimo = { fecha, precio: precioBase };
      }
      insumo.porProveedor.set(compra.proveedor.id, acumulado);
      porInsumo.set(renglon.insumo.id, insumo);
    }
  }

  return [...porInsumo.values()]
    .map(({ insumo, unidad, porProveedor }) => {
      const filas = [...porProveedor.values()].map((a) => ({
        proveedor: a.proveedor,
        compras: a.compras.size,
        cantidadBase: redondearCantidad(a.cantidadBase).toString(),
        promedio: a.cantidadBase.isZero() ? cero() : a.gastado.dividedBy(a.cantidadBase),
        minimo: a.minimo ?? cero(),
        maximo: a.maximo ?? cero(),
        ultimo: a.ultimo?.precio ?? cero(),
      }));
      // El más barato es por el promedio: un precio suelto de oferta no lo define.
      const masBarato = filas.reduce<Decimal | null>(
        (min, fila) => (min === null || fila.promedio.lessThan(min) ? fila.promedio : min),
        null,
      );
      return {
        insumo,
        unidad,
        proveedores: filas
          .sort((a, b) => a.promedio.comparedTo(b.promedio))
          .map((fila) => ({
            ...fila,
            promedio: comoTexto(fila.promedio),
            minimo: comoTexto(fila.minimo),
            maximo: comoTexto(fila.maximo),
            ultimo: comoTexto(fila.ultimo),
            // Solo hay "más barato" si hay con quién comparar.
            masBarato: filas.length > 1 && masBarato !== null && fila.promedio.equals(masBarato),
          })),
      };
    })
    .sort((a, b) => a.insumo.nombre.localeCompare(b.insumo.nombre, 'es'));
}

// ===========================================================================
// 9. Cumplimiento de proveedores
// ===========================================================================

export type CumplimientoProveedor = {
  proveedor: Ref;
  compras: number;
  completas: number;
  cerradasConFaltante: number;
  abiertas: number;
  canceladas: number;
  /** Días promedio desde que se pidió hasta la última entrega, de las completas. */
  diasPromedio: number | null;
  /** Qué parte del valor de lo comprado ya llegó (0 a 100). */
  porcentajeEntregado: number | null;
};

export function cumplimientoDeProveedores(
  compras: readonly CompraReporte[],
): CumplimientoProveedor[] {
  type Acumulado = {
    proveedor: Ref;
    compras: number;
    completas: number;
    cerradasConFaltante: number;
    abiertas: number;
    canceladas: number;
    dias: number[];
    total: Decimal;
    recibido: Decimal;
  };
  const porId = new Map<string, Acumulado>();
  for (const compra of compras.filter((c) => c.estado !== 'BORRADOR')) {
    const a = porId.get(compra.proveedor.id) ?? {
      proveedor: compra.proveedor,
      compras: 0,
      completas: 0,
      cerradasConFaltante: 0,
      abiertas: 0,
      canceladas: 0,
      dias: [],
      total: cero(),
      recibido: cero(),
    };
    a.compras += 1;
    if (compra.estado === 'RECIBIDA') a.completas += 1;
    if (compra.estado === 'CERRADA') a.cerradasConFaltante += 1;
    if (compra.estado === 'PEDIDA' || compra.estado === 'PARCIAL') a.abiertas += 1;
    if (compra.estado === 'CANCELADA') a.canceladas += 1;
    if (compra.estado === 'RECIBIDA' && compra.ultimaEntregaAt !== null) {
      a.dias.push(
        diasEntre(
          diaEnArgentina(new Date(compra.pedidaAt)),
          diaEnArgentina(new Date(compra.ultimaEntregaAt)),
        ),
      );
    }
    if (compra.estado !== 'CANCELADA') {
      for (const renglon of compra.renglones) {
        if (renglon.precioUnitario === null) continue;
        a.total = a.total.plus(valorDe(renglon));
        a.recibido = a.recibido.plus(
          aDecimal(renglon.recibidoBase).dividedBy(renglon.factor).times(renglon.precioUnitario),
        );
      }
    }
    porId.set(compra.proveedor.id, a);
  }
  return [...porId.values()]
    .map((a) => ({
      proveedor: a.proveedor,
      compras: a.compras,
      completas: a.completas,
      cerradasConFaltante: a.cerradasConFaltante,
      abiertas: a.abiertas,
      canceladas: a.canceladas,
      diasPromedio:
        a.dias.length === 0
          ? null
          : Math.round((a.dias.reduce((suma, d) => suma + d, 0) / a.dias.length) * 10) / 10,
      porcentajeEntregado: a.total.isZero()
        ? null
        : Math.round(a.recibido.dividedBy(a.total).times(100).toNumber()),
    }))
    .sort((a, b) => a.proveedor.nombre.localeCompare(b.proveedor.nombre, 'es'));
}

// ===========================================================================
// 10. Entregas por semana
// ===========================================================================

export type SemanaDeEntregas = {
  /** El lunes de la semana, 'AAAA-MM-DD'. */
  semana: string;
  entregas: number;
  valor: string;
  renglones: {
    recepcionId: string;
    fecha: string;
    entregaNumero: number;
    compraNumero: number | null;
    proveedor: Ref;
    sucursal: string;
    insumo: string;
    unidad: string;
    presentacion: string | null;
    cantidad: string;
    valor: string;
  }[];
};

export function entregasPorSemana(entregas: readonly EntregaReporte[]): SemanaDeEntregas[] {
  const porSemana = new Map<
    string,
    { entregas: Set<string>; valor: Decimal; renglones: SemanaDeEntregas['renglones'] }
  >();
  for (const entrega of entregas) {
    const semana = lunesDe(diaEnArgentina(new Date(entrega.fecha)));
    const grupo = porSemana.get(semana) ?? {
      entregas: new Set<string>(),
      valor: cero(),
      renglones: [],
    };
    grupo.entregas.add(entrega.id);
    for (const renglon of entrega.renglones) {
      const valor = aDecimal(renglon.cantidad).times(renglon.precioUnitario);
      grupo.valor = grupo.valor.plus(valor);
      grupo.renglones.push({
        recepcionId: entrega.id,
        fecha: entrega.fecha,
        entregaNumero: entrega.numero,
        compraNumero: entrega.compraNumero,
        proveedor: entrega.proveedor,
        sucursal: entrega.sucursal,
        insumo: renglon.insumo.nombre,
        unidad: renglon.insumo.unidad,
        presentacion: renglon.presentacion,
        cantidad: renglon.cantidad,
        valor: comoTexto(valor),
      });
    }
    porSemana.set(semana, grupo);
  }
  // La semana más reciente primero: es lo que se mira.
  return [...porSemana.entries()]
    .sort(([a], [b]) => b.localeCompare(a))
    .map(([semana, grupo]) => ({
      semana,
      entregas: grupo.entregas.size,
      valor: comoTexto(grupo.valor),
      renglones: grupo.renglones.sort((a, b) => Date.parse(a.fecha) - Date.parse(b.fecha)),
    }));
}
