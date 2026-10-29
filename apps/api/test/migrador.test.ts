import { execFile } from 'node:child_process';
import { cp, mkdtemp, rm, writeFile, appendFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { aplicarMigraciones, MigracionError } from '../src/migraciones/migrador.js';
import { CARPETA_MIGRACIONES } from './preparar-base.js';

/**
 * EL MIGRADOR DE PRODUCCIÓN (src/migraciones/migrador.ts), contra una base
 * vacía propia: `panaderia_migrador_test`.
 *
 * Lo más importante: que la CLI de Prisma vea la base como suya. Si no, el
 * día que alguien corra `prisma migrate` contra ella, querría volver a
 * aplicar todo.
 */

const urlPrueba = process.env['DATABASE_URL'] ?? '';
const NOMBRE = 'panaderia_migrador_test';

function conBase(url: string, nombre: string): string {
  const parsed = new URL(url);
  parsed.pathname = `/${nombre}`;
  return parsed.toString();
}

const urlAdmin = conBase(urlPrueba, 'postgres');
const urlMigrador = conBase(urlPrueba, NOMBRE);

let cliente: Client;
let carpetaTemporal: string;

async function conCliente<T>(url: string, hacer: (c: Client) => Promise<T>): Promise<T> {
  const c = new Client({ connectionString: url });
  await c.connect();
  try {
    return await hacer(c);
  } finally {
    await c.end();
  }
}

beforeAll(async () => {
  await conCliente(urlAdmin, async (admin) => {
    await admin.query(`DROP DATABASE IF EXISTS "${NOMBRE}" WITH (FORCE)`);
    await admin.query(`CREATE DATABASE "${NOMBRE}"`);
  });
  cliente = new Client({ connectionString: urlMigrador });
  await cliente.connect();
  carpetaTemporal = await mkdtemp(join(tmpdir(), 'migraciones-'));
});

afterAll(async () => {
  await cliente.end();
  await rm(carpetaTemporal, { recursive: true, force: true });
  await conCliente(urlAdmin, (admin) =>
    admin.query(`DROP DATABASE IF EXISTS "${NOMBRE}" WITH (FORCE)`),
  );
});

/** Una copia de las migraciones de verdad, para poder romperla. */
async function copiaDeMigraciones(nombre: string): Promise<string> {
  const destino = join(carpetaTemporal, nombre);
  await cp(CARPETA_MIGRACIONES, destino, { recursive: true });
  return destino;
}

describe('migrador', () => {
  it('aplica todas las migraciones en una base vacía, y la segunda vez no hace nada', async () => {
    const primera = await aplicarMigraciones(cliente, CARPETA_MIGRACIONES);
    expect(primera.yaEstaban).toBe(0);
    expect(primera.aplicadas.length).toBeGreaterThanOrEqual(10);

    const segunda = await aplicarMigraciones(cliente, CARPETA_MIGRACIONES);
    expect(segunda.aplicadas).toEqual([]);
    expect(segunda.yaEstaban).toBe(primera.aplicadas.length);

    const { rows } = await cliente.query<{ sin_terminar: string }>(
      `SELECT count(*) FILTER (WHERE finished_at IS NULL) AS sin_terminar FROM "_prisma_migrations"`,
    );
    expect(rows[0]?.sin_terminar).toBe('0');
  });

  it('la CLI de Prisma ve la base como suya ("up to date")', async () => {
    const { stdout } = await promisify(execFile)('pnpm', ['exec', 'prisma', 'migrate', 'status'], {
      env: { ...process.env, DATABASE_URL: urlMigrador },
    });
    expect(stdout).toContain('Database schema is up to date');
  });

  it('se niega si una migración aplicada cambió', async () => {
    const carpeta = await copiaDeMigraciones('editada');
    await appendFile(join(carpeta, '20261008014341_nucleo', 'migration.sql'), '\n-- editada\n');

    await expect(aplicarMigraciones(cliente, carpeta)).rejects.toThrow(
      /cambió después de aplicarse/,
    );
  });

  it('se niega si la base tiene una migración que esta versión no trae', async () => {
    const carpeta = await copiaDeMigraciones('vieja');
    await rm(join(carpeta, '20261009032228_seguridad_supabase'), { recursive: true });

    await expect(aplicarMigraciones(cliente, carpeta)).rejects.toThrow(/no está en esta versión/);
  });

  it('una migración que falla no deja nada a medias, y frena las siguientes', async () => {
    const carpeta = await copiaDeMigraciones('rota');
    await mkdir(join(carpeta, '29990101000000_rota'));
    await writeFile(
      join(carpeta, '29990101000000_rota', 'migration.sql'),
      'CREATE TABLE prueba_a_medias (id int);\nSELECT * FROM tabla_que_no_existe;\n',
    );

    await expect(aplicarMigraciones(cliente, carpeta)).rejects.toBeInstanceOf(MigracionError);

    // La primera sentencia tampoco quedó: el archivo entero es una transacción.
    const { rows: tablas } = await cliente.query(
      `SELECT 1 FROM pg_tables WHERE tablename = 'prueba_a_medias'`,
    );
    expect(tablas).toHaveLength(0);

    // Queda anotada como fallida, con el error...
    const { rows } = await cliente.query<{ logs: string | null }>(
      `SELECT logs FROM "_prisma_migrations" WHERE migration_name = '29990101000000_rota'`,
    );
    expect(rows[0]?.logs).toContain('tabla_que_no_existe');

    // ...y nada más se aplica hasta que alguien la mire.
    await expect(aplicarMigraciones(cliente, carpeta)).rejects.toThrow(/falló a medias/);
  });
});
