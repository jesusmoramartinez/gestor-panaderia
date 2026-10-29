/**
 * EL MIGRADOR DE PRODUCCIÓN: aplica las migraciones pendientes, en orden.
 *
 * Hace lo mismo que `prisma migrate deploy`, sin la CLI de Prisma. La CLI
 * arrastra unos 200 MB (Prisma Studio, una base embebida, TypeScript) que la
 * imagen de producción no necesita para correr diez archivos SQL.
 *
 * Es COMPATIBLE con Prisma a propósito: anota cada migración en la misma
 * tabla `_prisma_migrations`, con el mismo checksum (el sha256 del archivo) y
 * el mismo candado. Si algún día se corre `prisma migrate status` contra una
 * base migrada con esto, la ve como propia (lo verifica migrador.test.ts
 * contra la CLI de verdad).
 *
 * Igual que `migrate deploy`, NUNCA borra ni resetea nada: solo agrega lo que
 * falta. Y se niega a seguir si algo no cuadra:
 *   - una migración que falló a medias (hay que mirarla a mano);
 *   - una migración aplicada cuyo archivo cambió (las aplicadas no se editan);
 *   - una migración aplicada que no está en la carpeta (¿imagen vieja?).
 */
import { createHash, randomUUID } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

import type { Client } from 'pg';

/** El mismo número de candado que usa Prisma: los dos no corren a la vez. */
const CANDADO_DE_MIGRACIONES = 72707369;

export type Migracion = { nombre: string; sql: string; checksum: string };

export type ResultadoMigracion = { aplicadas: string[]; yaEstaban: number };

/** Las migraciones de la carpeta, en orden (el nombre empieza con la fecha). */
export async function leerMigraciones(carpeta: string): Promise<Migracion[]> {
  const entradas = await readdir(carpeta, { withFileTypes: true });
  const nombres = entradas
    .filter((entrada) => entrada.isDirectory())
    .map((entrada) => entrada.name)
    .sort();

  const migraciones: Migracion[] = [];
  for (const nombre of nombres) {
    const sql = await readFile(join(carpeta, nombre, 'migration.sql'), 'utf8');
    migraciones.push({ nombre, sql, checksum: createHash('sha256').update(sql).digest('hex') });
  }
  return migraciones;
}

type FilaAplicada = {
  migration_name: string;
  checksum: string;
  finished_at: Date | null;
  rolled_back_at: Date | null;
};

export class MigracionError extends Error {
  override readonly name = 'MigracionError';
}

/**
 * Aplica las migraciones pendientes. Recibe un cliente ya conectado (no un
 * pool: el candado de Postgres es de la CONEXIÓN, y tiene que ser la misma
 * de principio a fin).
 */
export async function aplicarMigraciones(
  cliente: Client,
  carpeta: string,
  avisar: (mensaje: string) => void = () => {},
): Promise<ResultadoMigracion> {
  const migraciones = await leerMigraciones(carpeta);

  await cliente.query('SELECT pg_advisory_lock($1)', [CANDADO_DE_MIGRACIONES]);
  try {
    // La misma tabla que crea Prisma, columna por columna.
    await cliente.query(`
      CREATE TABLE IF NOT EXISTS "_prisma_migrations" (
        "id"                  VARCHAR(36) PRIMARY KEY NOT NULL,
        "checksum"            VARCHAR(64) NOT NULL,
        "finished_at"         TIMESTAMPTZ,
        "migration_name"      VARCHAR(255) NOT NULL,
        "logs"                TEXT,
        "rolled_back_at"      TIMESTAMPTZ,
        "started_at"          TIMESTAMPTZ NOT NULL DEFAULT now(),
        "applied_steps_count" INTEGER NOT NULL DEFAULT 0
      )`);

    const { rows } = await cliente.query<FilaAplicada>(
      `SELECT migration_name, checksum, finished_at, rolled_back_at
       FROM "_prisma_migrations" WHERE rolled_back_at IS NULL`,
    );

    const fallida = rows.find((fila) => fila.finished_at === null);
    if (fallida !== undefined) {
      throw new MigracionError(
        `La migración ${fallida.migration_name} falló a medias en un intento anterior. ` +
          'No se aplica nada más hasta revisarla a mano (ver el campo "logs" de _prisma_migrations).',
      );
    }

    const porNombre = new Map(migraciones.map((m) => [m.nombre, m]));
    for (const fila of rows) {
      const local = porNombre.get(fila.migration_name);
      if (local === undefined) {
        throw new MigracionError(
          `La base tiene aplicada ${fila.migration_name}, que no está en esta versión. ` +
            '¿Se está activando una imagen más vieja que la base?',
        );
      }
      if (local.checksum !== fila.checksum) {
        throw new MigracionError(
          `El archivo de ${fila.migration_name} cambió después de aplicarse. ` +
            'Una migración aplicada no se edita: el cambio va en una migración nueva.',
        );
      }
    }

    const aplicadas = new Set(rows.map((fila) => fila.migration_name));
    const pendientes = migraciones.filter((m) => !aplicadas.has(m.nombre));

    for (const migracion of pendientes) {
      const id = randomUUID();
      await cliente.query(
        `INSERT INTO "_prisma_migrations" (id, checksum, migration_name, started_at, applied_steps_count)
         VALUES ($1, $2, $3, now(), 0)`,
        [id, migracion.checksum, migracion.nombre],
      );
      try {
        // Todo el archivo en un solo envío: Postgres lo corre como una sola
        // transacción implícita. Si una sentencia falla, no queda nada a medias.
        await cliente.query(migracion.sql);
      } catch (error) {
        const detalle = error instanceof Error ? error.message : String(error);
        await cliente.query(`UPDATE "_prisma_migrations" SET logs = $2 WHERE id = $1`, [
          id,
          detalle,
        ]);
        throw new MigracionError(`Falló la migración ${migracion.nombre}: ${detalle}`);
      }
      await cliente.query(
        `UPDATE "_prisma_migrations" SET finished_at = now(), applied_steps_count = 1 WHERE id = $1`,
        [id],
      );
      avisar(`aplicada ${migracion.nombre}`);
    }

    return { aplicadas: pendientes.map((m) => m.nombre), yaEstaban: rows.length };
  } finally {
    await cliente.query('SELECT pg_advisory_unlock($1)', [CANDADO_DE_MIGRACIONES]);
  }
}
