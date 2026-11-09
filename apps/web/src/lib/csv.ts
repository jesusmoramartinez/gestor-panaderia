/**
 * EXPORTAR A CSV (Fase 12d): "valores separados por comas", el formato más
 * simple de planilla. Se arma acá mismo, sin librerías.
 *
 * Tres detalles para que lo abra bien un Excel en español:
 *   - el separador es ";" (con "," Excel en español pone todo en una celda,
 *     porque la coma es su separador decimal);
 *   - los números van con coma decimal: 1234,5;
 *   - el archivo empieza con un BOM (un carácter invisible, \uFEFF) que le
 *     avisa a Excel que el texto es UTF-8: sin eso, "Azúcar" sale "AzÃºcar".
 */
export type Celda = string | number | null;

/** Un número de la API ('1234.5') como lo lee un Excel en español ('1234,5'). */
export function numeroCsv(valor: string | number | null): string {
  if (valor === null) return '';
  return String(valor).replace('.', ',');
}

function celda(valor: Celda): string {
  const texto = valor === null ? '' : String(valor);
  // Comillas si hace falta: un ";" o un salto de línea adentro romperían la fila.
  return /[;"\n\r]/.test(texto) ? `"${texto.replaceAll('"', '""')}"` : texto;
}

export function armarCsv(
  columnas: readonly string[],
  filas: readonly (readonly Celda[])[],
): string {
  return `\uFEFF${[columnas, ...filas].map((fila) => fila.map(celda).join(';')).join('\r\n')}\r\n`;
}

export function descargarCsv(
  nombre: string,
  columnas: readonly string[],
  filas: readonly (readonly Celda[])[],
): void {
  const archivo = new Blob([armarCsv(columnas, filas)], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(archivo);
  const enlace = document.createElement('a');
  enlace.href = url;
  enlace.download = nombre.endsWith('.csv') ? nombre : `${nombre}.csv`;
  document.body.append(enlace);
  enlace.click();
  enlace.remove();
  URL.revokeObjectURL(url);
}
