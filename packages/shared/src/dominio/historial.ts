/**
 * EL HISTORIAL DE UNA COMPRA (Etapa 2, Fase 12c).
 *
 * No es una tabla: es la UNIÓN, ordenada por fecha, de cosas que ya están
 * guardadas (la compra, sus pagos, sus entregas, sus notas, sus anulaciones).
 * Guardarlo aparte sería tener dos versiones de la misma historia, y tarde o
 * temprano dirían cosas distintas (regla 15: lo derivado se reconstruye).
 *
 * Es una función PURA: recibe los datos y devuelve los eventos con sus
 * textos. Así el orden y las palabras se prueban sin base de datos, y la
 * pantalla solo los dibuja.
 */
import { formatearCantidad, formatearDinero } from './decimal.js';
import type { MedioPago } from './acopio.js';

export const TIPOS_EVENTO = [
  'CREADA',
  'PEDIDA',
  'EDITADA',
  'PAGO',
  'PAGO_ANULADO',
  'ENTREGA',
  'ENTREGA_ANULADA',
  'NOTA',
  'CERRADA',
  'CANCELADA',
] as const;
export type TipoEvento = (typeof TIPOS_EVENTO)[number];

export const ETIQUETA_MEDIO_PAGO: Record<MedioPago, string> = {
  EFECTIVO: 'Efectivo',
  TRANSFERENCIA: 'Transferencia',
  MERCADO_PAGO: 'Mercado Pago',
};

type Persona = { id: string; nombre: string };

export type EventoHistorial = {
  tipo: TipoEvento;
  /** ISO. */
  fecha: string;
  usuario: Persona | null;
  titulo: string;
  detalle: string | null;
  /** Para enlazar a la entrega. */
  recepcionId: string | null;
};

export type DatosHistorial = {
  creadaAt: string;
  pedidaAt: string | null;
  cerradaAt: string | null;
  estado: string;
  notaCierre: string | null;
  creadaPor: Persona;
  /** Quién la cerró o canceló (sale de la auditoría; puede no saberse). */
  cerradaPor: Persona | null;
  cantidadInsumos: number;
  total: string | null;
  ediciones: { fecha: string; usuario: Persona | null }[];
  pagos: {
    fecha: string;
    monto: string;
    medio: MedioPago;
    nota: string | null;
    usuario: Persona;
    comprobantes: number;
    anuladoAt: string | null;
    anuladoPor: Persona | null;
    motivoAnulacion: string | null;
  }[];
  entregas: {
    id: string;
    numero: number;
    fecha: string;
    sucursal: string;
    usuario: Persona;
    renglones: { insumo: string; cantidad: string; presentacion: string | null; unidad: string }[];
    remito: string | null;
    fotos: number;
    anuladaAt: string | null;
    anuladaPor: Persona | null;
    motivoAnulacion: string | null;
  }[];
  notas: { fecha: string; texto: string; usuario: Persona }[];
};

/**
 * Una compra creada YA pedida guarda las dos fechas casi iguales: es un
 * solo hecho ("creada y pedida"), no dos. Un minuto de margen alcanza.
 */
const MISMO_MOMENTO_MS = 60_000;

/** Si dos eventos tienen la misma fecha, el orden en que pasan las cosas. */
const ORDEN_DEL_TIPO: Record<TipoEvento, number> = {
  CREADA: 0,
  PEDIDA: 1,
  EDITADA: 2,
  PAGO: 3,
  ENTREGA: 4,
  NOTA: 5,
  PAGO_ANULADO: 6,
  ENTREGA_ANULADA: 7,
  CERRADA: 8,
  CANCELADA: 8,
};

function plural(cantidad: number, singular: string, plural: string): string {
  return `${String(cantidad)} ${cantidad === 1 ? singular : plural}`;
}

export function armarHistorial(datos: DatosHistorial): EventoHistorial[] {
  const eventos: EventoHistorial[] = [];
  const evento = (e: Omit<EventoHistorial, 'recepcionId'> & { recepcionId?: string | null }) => {
    eventos.push({ ...e, recepcionId: e.recepcionId ?? null });
  };

  const juntas =
    datos.pedidaAt !== null &&
    Math.abs(Date.parse(datos.pedidaAt) - Date.parse(datos.creadaAt)) < MISMO_MOMENTO_MS;
  evento({
    tipo: 'CREADA',
    fecha: datos.creadaAt,
    usuario: datos.creadaPor,
    titulo: juntas ? 'Compra creada y pedida' : 'Compra creada como borrador',
    detalle: `${plural(datos.cantidadInsumos, 'insumo', 'insumos')} · ${
      datos.total === null ? 'sin precio cargado' : `total ${formatearDinero(datos.total)}`
    }`,
  });
  if (datos.pedidaAt !== null && !juntas) {
    evento({
      tipo: 'PEDIDA',
      fecha: datos.pedidaAt,
      usuario: null,
      titulo: 'Marcada como pedida',
      detalle: null,
    });
  }

  for (const edicion of datos.ediciones) {
    evento({
      tipo: 'EDITADA',
      fecha: edicion.fecha,
      usuario: edicion.usuario,
      titulo: 'Compra editada',
      detalle: null,
    });
  }

  for (const pago of datos.pagos) {
    const partes = [
      pago.nota,
      pago.comprobantes > 0 ? plural(pago.comprobantes, 'comprobante', 'comprobantes') : null,
    ].filter((parte): parte is string => parte !== null);
    evento({
      tipo: 'PAGO',
      fecha: pago.fecha,
      usuario: pago.usuario,
      titulo: `Pago de ${formatearDinero(pago.monto)} · ${ETIQUETA_MEDIO_PAGO[pago.medio]}`,
      detalle: partes.length === 0 ? null : partes.join(' · '),
    });
    if (pago.anuladoAt !== null) {
      evento({
        tipo: 'PAGO_ANULADO',
        fecha: pago.anuladoAt,
        usuario: pago.anuladoPor,
        titulo: `Pago de ${formatearDinero(pago.monto)} anulado`,
        detalle: pago.motivoAnulacion,
      });
    }
  }

  for (const entrega of datos.entregas) {
    const que = entrega.renglones
      .map((renglon) =>
        renglon.presentacion === null
          ? `${formatearCantidad(renglon.cantidad)} ${renglon.unidad} de ${renglon.insumo}`
          : `${formatearCantidad(renglon.cantidad)} × ${renglon.presentacion} de ${renglon.insumo}`,
      )
      .join(', ');
    const extras = [
      entrega.remito === null ? null : `remito ${entrega.remito}`,
      entrega.fotos > 0 ? plural(entrega.fotos, 'foto', 'fotos') : null,
    ].filter((parte): parte is string => parte !== null);
    evento({
      tipo: 'ENTREGA',
      fecha: entrega.fecha,
      usuario: entrega.usuario,
      titulo: `Entrega ${String(entrega.numero)} en ${entrega.sucursal}`,
      detalle: [que, ...extras].join(' · '),
      recepcionId: entrega.id,
    });
    if (entrega.anuladaAt !== null) {
      evento({
        tipo: 'ENTREGA_ANULADA',
        fecha: entrega.anuladaAt,
        usuario: entrega.anuladaPor,
        titulo: `Entrega ${String(entrega.numero)} anulada`,
        detalle: entrega.motivoAnulacion,
        recepcionId: entrega.id,
      });
    }
  }

  for (const nota of datos.notas) {
    evento({
      tipo: 'NOTA',
      fecha: nota.fecha,
      usuario: nota.usuario,
      titulo: 'Nota',
      detalle: nota.texto,
    });
  }

  if (datos.cerradaAt !== null && (datos.estado === 'CERRADA' || datos.estado === 'CANCELADA')) {
    evento({
      tipo: datos.estado,
      fecha: datos.cerradaAt,
      usuario: datos.cerradaPor,
      titulo: datos.estado === 'CERRADA' ? 'Cerrada con faltante' : 'Cancelada',
      detalle: datos.notaCierre,
    });
  }

  // Del más viejo al más nuevo; a igual fecha, en el orden en que pasan.
  return eventos.sort(
    (a, b) =>
      Date.parse(a.fecha) - Date.parse(b.fecha) || ORDEN_DEL_TIPO[a.tipo] - ORDEN_DEL_TIPO[b.tipo],
  );
}
