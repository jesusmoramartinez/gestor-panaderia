/**
 * LA EMPRESA DE DEMO, EN LOCAL: una copia de cómo está la de Marcelo en
 * producción, para ver en desarrollo lo mismo que ve él.
 *
 *   pnpm db:demo     (entrar con marcelo@panaderia.test / panaderia123)
 *
 * Crea "Panadería Morinigo (local)" con Catán (Central) y Laferrere, y le carga
 * los datos de ejemplo base y los extra. Si ya existe, no hace nada.
 *
 * Solo corre contra una base local, con las mismas dos guardas que la semilla.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { darDeAltaEmpresa } from '../src/alta/alta.js';
import { cargarDatosDemo } from '../src/alta/datos-demo.js';
import { cargarDatosDemoExtra } from '../src/alta/datos-demo-extra.js';
import { cerrarConexiones, prisma } from '../src/lib/db.js';
import { PASSWORD_DEV } from './semilla.js';

const EMAIL = 'marcelo@panaderia.test';

async function main(): Promise<void> {
  const { env } = process;
  if (env.NODE_ENV === 'production') throw new Error('No se ejecuta en producción.');
  const host = new URL(env.DATABASE_URL ?? '').hostname;
  if (!['localhost', '127.0.0.1'].includes(host)) {
    throw new Error(`Solo corre contra una base local, y esta es ${host}.`);
  }

  if (await prisma.usuario.findUnique({ where: { email: EMAIL } })) {
    console.log(`[demo] ya existe: entrá con ${EMAIL} / ${PASSWORD_DEV}`);
    return;
  }

  const { empresaId } = await darDeAltaEmpresa(
    prisma,
    {
      empresa: { nombre: 'Panadería Morinigo (local)' },
      sucursales: [
        { codigo: 'CAT', nombre: 'Catán', esCentral: true },
        { codigo: 'LAF', nombre: 'Laferrere' },
      ],
      dueno: { email: EMAIL, nombre: 'Marcelo (local)' },
    },
    PASSWORD_DEV,
  );

  const carpeta = join(import.meta.dirname, 'demo-imagenes');
  const imagen = (nombre: string) => readFileSync(join(carpeta, nombre)).toString('base64');
  const imagenes = {
    transferencia: imagen('transferencia.jpg'),
    mercadoPago: imagen('mercado-pago.jpg'),
    remito: imagen('remito.jpg'),
  };

  await cargarDatosDemo(empresaId, imagenes);
  const extra = await cargarDatosDemoExtra(empresaId, imagenes);
  console.log(
    `[demo] listo: ${String(extra.insumos)} insumos y ${String(13 + extra.compras)} compras. ` +
      `Entrá con ${EMAIL} / ${PASSWORD_DEV}`,
  );
}

main()
  .catch((error: unknown) => {
    console.error(`[demo] ERROR: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  })
  .finally(() => cerrarConexiones());
