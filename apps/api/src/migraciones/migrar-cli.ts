/**
 * Aplica las migraciones pendientes a la base de DATABASE_URL.
 *
 *   En el servidor (lo corre actualizar.sh, con la imagen nueva):
 *     node dist/migraciones/migrar-cli.js
 *
 * En desarrollo se sigue usando la CLI de Prisma (`pnpm db:migrate`), que
 * además CREA migraciones nuevas. Ver migrador.ts.
 */
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Client } from 'pg';

import { env } from '../config/env.js';
import { aplicarMigraciones } from './migrador.js';

// dist/migraciones/ → ../../prisma/migrations, igual desde src/ con tsx.
const carpeta = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'prisma', 'migrations');

const cliente = new Client({ connectionString: env.DATABASE_URL });
try {
  await cliente.connect();
  const resultado = await aplicarMigraciones(cliente, carpeta, (mensaje) =>
    console.log(`[migrar] ${mensaje}`),
  );
  console.log(
    resultado.aplicadas.length === 0
      ? `[migrar] nada pendiente (${String(resultado.yaEstaban)} ya aplicadas)`
      : `[migrar] listo: ${String(resultado.aplicadas.length)} aplicadas`,
  );
} catch (error) {
  console.error(`[migrar] ERROR: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
} finally {
  await cliente.end();
}
