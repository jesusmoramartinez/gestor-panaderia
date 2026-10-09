// CAPA 3 — SERVICIO: las reglas del negocio. No sabe que existe HTTP.
import {
  aBultosEnteros,
  aDecimal,
  type CompraSugerida,
  estadoDeStock,
  type FiltroReposicion,
  planificarReposicion,
  type Reposicion,
  redondearDinero,
  type ResumenAlertas,
} from '@panaderia/shared';

import { type Contexto, puedeOperarEn } from '../../lib/contexto.js';
import { errores } from '../../lib/errores.js';
import * as repo from './repo.js';

const clave = (sucursalId: string, insumoId: string) => `${sucursalId}|${insumoId}`;

/**
 * `NUMERIC::text` en Postgres conserva los ceros de la escala ("100.000000");
 * el resto de la API devuelve "100" (el toString de Decimal). Se normaliza
 * acá para que la respuesta sea igual a la de cualquier otro endpoint.
 */
const normal = (valor: string) => aDecimal(valor).toString();

/**
 * LA REPOSICIÓN: qué hay que traer, de dónde y cuánto.
 *
 * La cuenta la hace `planificarReposicion` (función pura, con sus tests).
 * Este servicio junta los datos, la llama y arma las tres vistas que usa la
 * pantalla: por sucursal, lo que se transfiere desde la Central, y lo que se
 * compra agrupado por proveedor.
 *
 * El plan se calcula con TODA la empresa y recién después se filtra por las
 * sucursales del usuario: el reparto del sobrante de la Central tiene que
 * ser el mismo lo mire quien lo mire.
 */
export async function obtener(ctx: Contexto, filtro: FiltroReposicion): Promise<Reposicion> {
  if (filtro.sucursalId !== undefined && !puedeOperarEn(ctx, filtro.sucursalId)) {
    throw errores.sucursalNoPermitida();
  }

  // Consultas sueltas (no hay transacción): Promise.all sí corresponde.
  const [filas, pedidos, camino, preferidos, insumos, sucursales] = await Promise.all([
    repo.situaciones(ctx.empresaId),
    repo.yaPedido(ctx.empresaId),
    repo.enCamino(ctx.empresaId),
    repo.preferidos(ctx.empresaId),
    repo.insumos(ctx.empresaId),
    repo.sucursales(ctx.empresaId),
  ]);

  const pedidoPor = new Map(
    pedidos.map((p) => [clave(p.sucursal_id, p.insumo_id), normal(p.cantidad)]),
  );
  const caminoPor = new Map(
    camino.map((c) => [clave(c.sucursal_id, c.insumo_id), normal(c.cantidad)]),
  );
  const preferidoPor = new Map(preferidos.map((p) => [p.insumoId, p]));
  const insumoPor = new Map(insumos.map((i) => [i.id, i]));
  const sucursalPor = new Map(sucursales.map((s) => [s.id, s]));
  const central = sucursales.find((s) => s.esCentral) ?? null;

  const planes = planificarReposicion(
    filas.map((fila) => ({
      sucursalId: fila.sucursal_id,
      insumoId: fila.insumo_id,
      saldo: fila.saldo,
      stockMinimo: fila.stock_minimo,
      stockMaximo: fila.stock_maximo,
      yaPedido: pedidoPor.get(clave(fila.sucursal_id, fila.insumo_id)) ?? '0',
      enCamino: caminoPor.get(clave(fila.sucursal_id, fila.insumo_id)) ?? '0',
    })),
    central?.id ?? null,
  );
  const situacionPor = new Map(filas.map((f) => [clave(f.sucursal_id, f.insumo_id), f]));

  const visible = (sucursalId: string) =>
    puedeOperarEn(ctx, sucursalId) &&
    (filtro.sucursalId === undefined || filtro.sucursalId === sucursalId);

  const items: Reposicion['items'] = [];
  const transferencias = new Map<string, Reposicion['transferencias'][number]>();
  const compras = new Map<string, Reposicion['compras'][number]>();

  for (const plan of planes) {
    if (!visible(plan.sucursalId)) continue;
    const sucursal = sucursalPor.get(plan.sucursalId);
    const datosInsumo = insumoPor.get(plan.insumoId);
    const situacion = situacionPor.get(clave(plan.sucursalId, plan.insumoId));
    if (!sucursal || !datosInsumo || !situacion) continue;

    const sucursalRef = { id: sucursal.id, codigo: sucursal.codigo, nombre: sucursal.nombre };
    const insumo = {
      id: datosInsumo.id,
      nombre: datosInsumo.nombre,
      unidadBaseCodigo: datosInsumo.unidadBase.codigo,
    };

    // --- Lo que se compra, al preferido y en bultos enteros.
    let compra: CompraSugerida | null = null;
    if (plan.aComprar.greaterThan(0)) {
      const preferido = preferidoPor.get(plan.insumoId);
      const factor = preferido?.presentacion?.cantidadBase.toString() ?? '1';
      const { bultos, cantidadBase } = aBultosEnteros(plan.aComprar, factor);
      const precio = preferido?.ultimoPrecio?.toString() ?? null;
      compra = {
        proveedor: preferido?.proveedor ?? null,
        presentacion:
          preferido?.presentacion == null
            ? null
            : {
                id: preferido.presentacion.id,
                nombre: preferido.presentacion.nombre,
                cantidadBase: preferido.presentacion.cantidadBase.toString(),
              },
        bultos: bultos.toString(),
        cantidadBase: cantidadBase.toString(),
        precioUnitario: precio,
        precioAt: preferido?.ultimoPrecioAt?.toISOString() ?? null,
        subtotal: precio === null ? null : redondearDinero(bultos.times(precio)).toString(),
      };

      const claveCompra = `${compra.proveedor?.id ?? 'sin-proveedor'}|${sucursal.id}`;
      const grupo = compras.get(claveCompra) ?? {
        proveedor: compra.proveedor,
        sucursal: sucursalRef,
        lineas: [],
        totalEstimado: null,
      };
      grupo.lineas.push({
        insumo,
        presentacion: compra.presentacion,
        bultos: compra.bultos,
        cantidadBase: compra.cantidadBase,
        precioUnitario: compra.precioUnitario,
        precioAt: compra.precioAt,
        subtotal: compra.subtotal,
      });
      if (compra.subtotal !== null) {
        grupo.totalEstimado = aDecimal(grupo.totalEstimado ?? '0')
          .plus(compra.subtotal)
          .toString();
      }
      compras.set(claveCompra, grupo);
    }

    // --- Lo que se trae de la Central.
    if (plan.desdeCentral.greaterThan(0)) {
      const grupo = transferencias.get(sucursal.id) ?? { destino: sucursalRef, lineas: [] };
      grupo.lineas.push({ insumo, cantidadBase: plan.desdeCentral.toString() });
      transferencias.set(sucursal.id, grupo);
    }

    items.push({
      sucursal: sucursalRef,
      insumo,
      estado: plan.estado,
      saldo: normal(situacion.saldo),
      stockMinimo: normal(situacion.stock_minimo),
      stockMaximo: situacion.stock_maximo === null ? null : normal(situacion.stock_maximo),
      yaPedido: pedidoPor.get(clave(plan.sucursalId, plan.insumoId)) ?? '0',
      enCamino: caminoPor.get(clave(plan.sucursalId, plan.insumoId)) ?? '0',
      objetivo: plan.objetivo.toString(),
      faltante: plan.faltante.toString(),
      desdeCentral: plan.desdeCentral.toString(),
      aComprar: plan.aComprar.toString(),
      compra,
    });
  }

  return {
    central:
      central === null ? null : { id: central.id, codigo: central.codigo, nombre: central.nombre },
    items,
    transferencias: [...transferencias.values()],
    // Primero los que tienen proveedor; "sin proveedor preferido" al final.
    compras: [...compras.values()].sort((a, b) =>
      a.proveedor === null
        ? 1
        : b.proveedor === null
          ? -1
          : a.proveedor.nombre.localeCompare(b.proveedor.nombre),
    ),
  };
}

/**
 * El número del menú: cuántos insumos están en alerta en UNA sucursal.
 *
 * Misma regla que la reposición: solo cuentan los que tienen mínimo. Por eso
 * no se usa el semáforo de la pantalla de stock tal cual: ahí un insumo sin
 * mínimo y sin stock se ve "sin stock", y el número arrancaría en 28.
 */
export async function resumenAlertas(ctx: Contexto, sucursalId: string): Promise<ResumenAlertas> {
  const filas = await repo.alertasDeSucursal(ctx.empresaId, sucursalId);
  let critico = 0;
  let bajo = 0;
  for (const fila of filas) {
    const estado = estadoDeStock(fila.saldo, fila.stock_minimo);
    if (estado === 'CRITICO') critico += 1;
    if (estado === 'BAJO') bajo += 1;
  }
  return { critico, bajo };
}
