/**
 * Carga los datos de ejemplo EXTRA encima de los de ejemplo base. Ver
 * datos-demo-extra.ts. En el servidor (dentro de la imagen):
 *
 *   node dist/alta/datos-demo-extra-cli.js <empresaId> --confirmo-datos-de-prueba [carpeta-de-imagenes]
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { cerrarConexiones } from '../lib/db.js';
import { cargarDatosDemoExtra } from './datos-demo-extra.js';

const [empresaId, confirmacion, carpeta] = process.argv.slice(2);

function imagen(nombre: string): string | undefined {
  if (carpeta === undefined) return undefined;
  const ruta = join(carpeta, nombre);
  return existsSync(ruta) ? readFileSync(ruta).toString('base64') : undefined;
}

async function main(): Promise<void> {
  if (empresaId === undefined || confirmacion !== '--confirmo-datos-de-prueba') {
    throw new Error(
      'Uso: datos-demo-extra-cli <empresaId> --confirmo-datos-de-prueba [carpeta-de-imagenes]',
    );
  }
  const r = await cargarDatosDemoExtra(empresaId, {
    transferencia: imagen('transferencia.jpg'),
    mercadoPago: imagen('mercado-pago.jpg'),
    remito: imagen('remito.jpg'),
  });
  console.log(
    `[demo-extra] listo: ${String(r.insumos)} insumos en total, ${String(r.compras)} compras nuevas, ` +
      `${String(r.movimientos)} movimientos de stock.`,
  );
}

main()
  .catch((error: unknown) => {
    console.error(`[demo-extra] ERROR: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  })
  .finally(() => cerrarConexiones());
