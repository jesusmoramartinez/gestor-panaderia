import {
  type AjustarStockInput,
  type AnularMovimientoInput,
  type CargarConsumoInput,
  type CargarMermaInput,
  type CargarSaldoInicialInput,
  type FiltroHistorial,
  type FiltroStock,
  HistorialMovimientosSchema,
  ListaMotivosSchema,
  ResultadoAjusteSchema,
  ResultadoCargaSchema,
  StockPorSucursalSchema,
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

export function obtenerStock(filtro: FiltroStock) {
  return pedirApi(`/api/stock?${armarQuery({ ...filtro })}`, { esquema: StockPorSucursalSchema });
}

export function obtenerHistorial(insumoId: string, filtro: FiltroHistorial) {
  return pedirApi(`/api/insumos/${insumoId}/movimientos?${armarQuery({ ...filtro })}`, {
    esquema: HistorialMovimientosSchema,
  });
}

export function listarMotivos(tipo?: 'MERMA' | 'AJUSTE' | 'CONSUMO') {
  return pedirApi(`/api/motivos?${armarQuery({ tipo })}`, { esquema: ListaMotivosSchema });
}

export function cargarSaldoInicial(entrada: CargarSaldoInicialInput) {
  return pedirApi('/api/movimientos/saldo-inicial', {
    metodo: 'POST',
    cuerpo: entrada,
    esquema: ResultadoCargaSchema,
  });
}

export function cargarConsumo(entrada: CargarConsumoInput) {
  return pedirApi('/api/movimientos/consumo', {
    metodo: 'POST',
    cuerpo: entrada,
    esquema: ResultadoCargaSchema,
  });
}

export function cargarMerma(entrada: CargarMermaInput) {
  return pedirApi('/api/movimientos/merma', {
    metodo: 'POST',
    cuerpo: entrada,
    esquema: ResultadoCargaSchema,
  });
}

/**
 * Ajustar el stock a lo contado.
 *
 * Responde 200 y no 201 a propósito: si todas las cuentas coincidían no se
 * creó ningún movimiento, y el cuerpo es un informe de lo que pasó.
 */
export function ajustarStock(entrada: AjustarStockInput) {
  return pedirApi('/api/movimientos/ajuste', {
    metodo: 'POST',
    cuerpo: entrada,
    esquema: ResultadoAjusteSchema,
  });
}

export function anularMovimiento(movimientoId: string, entrada: AnularMovimientoInput) {
  return pedirApi(`/api/movimientos/${movimientoId}/reversa`, {
    metodo: 'POST',
    cuerpo: entrada,
    esquema: ResultadoCargaSchema,
  });
}
