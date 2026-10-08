/**
 * Manejo de fechas.
 *
 * REGLA DEL PROYECTO: las fechas se guardan en UTC y se muestran en hora de
 * Argentina. La conversión ocurre solo acá, al formatear para la pantalla.
 * Nunca se guarda "hora local" sin zona: si lo hacés, una carga a las 23:30
 * puede quedar registrada en el día equivocado y después no hay forma de
 * saber qué pasó.
 */

export const ZONA_HORARIA_ARGENTINA = 'America/Argentina/Buenos_Aires';

// Se crea UNA sola vez (construir un Intl.DateTimeFormat es costoso).
const formateadorFechaHora = new Intl.DateTimeFormat('es-AR', {
  timeZone: ZONA_HORARIA_ARGENTINA,
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

/**
 * Convierte un instante a texto en hora de Argentina.
 * Ejemplo: 2026-10-05T23:30:00Z  →  "05/10/2026, 20:30"
 */
export function formatearFechaArgentina(fecha: Date): string {
  return formateadorFechaHora.format(fecha);
}

// 'en-CA' es un truco conocido: es el único formato de Intl que escribe las
// fechas como AAAA-MM-DD, que es justo el que necesitamos para compararlas.
const formateadorDia = new Intl.DateTimeFormat('en-CA', {
  timeZone: ZONA_HORARIA_ARGENTINA,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/**
 * Qué DÍA es en Argentina en este instante, como 'AAAA-MM-DD'.
 *
 * Hace falta para las fechas que son días de calendario y no instantes (la
 * fecha estimada de entrega de una orden: "llega el jueves"). Preguntar "¿ya
 * pasó el jueves?" con el día en UTC fallaría todas las noches entre las 21 y
 * las 24, cuando en UTC ya es mañana.
 */
export function diaEnArgentina(instante: Date): string {
  return formateadorDia.format(instante);
}

/** '2026-10-08' → '08/10/2026'. Para mostrar un día de calendario. */
export function formatearDia(dia: string): string {
  const [anio, mes, diaDelMes] = dia.split('-');
  return `${diaDelMes ?? ''}/${mes ?? ''}/${anio ?? ''}`;
}
