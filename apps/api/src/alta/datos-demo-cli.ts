/**
 * Carga los datos de ejemplo en una empresa recién dada de alta. Ver
 * datos-demo.ts. En el servidor (dentro de la imagen):
 *
 *   node dist/alta/datos-demo-cli.js <empresaId> --confirmo-datos-de-prueba [carpeta-de-imagenes]
 *
 * La carpeta, opcional, puede traer transferencia.jpg, mercado-pago.jpg y
 * remito.jpg: se usan como comprobantes de ejemplo.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { cerrarConexiones } from '../lib/db.js';
import { cargarDatosDemo } from './datos-demo.js';

const [empresaId, confirmacion, carpeta] = process.argv.slice(2);

function imagen(nombre: string): string | undefined {
  if (carpeta === undefined) return undefined;
  const ruta = join(carpeta, nombre);
  return existsSync(ruta) ? readFileSync(ruta).toString('base64') : undefined;
}

async function main(): Promise<void> {
  if (empresaId === undefined || confirmacion !== '--confirmo-datos-de-prueba') {
    throw new Error(
      'Uso: datos-demo-cli <empresaId> --confirmo-datos-de-prueba [carpeta-de-imagenes]',
    );
  }
  const resultado = await cargarDatosDemo(empresaId, {
    transferencia: imagen('transferencia.jpg'),
    mercadoPago: imagen('mercado-pago.jpg'),
    remito: imagen('remito.jpg'),
  });
  console.log(
    `[demo] listo: ${String(resultado.insumos)} insumos, ${String(resultado.proveedores)} proveedores, ` +
      `${String(resultado.compras)} compras de ejemplo.`,
  );
}

main()
  .catch((error: unknown) => {
    console.error(`[demo] ERROR: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  })
  .finally(() => cerrarConexiones());
