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
