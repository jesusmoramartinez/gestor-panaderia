import { readdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import { PrismaPg } from '@prisma/adapter-pg';
import { Client, Pool } from 'pg';

import { sembrar } from '../prisma/semilla.js';
import { PrismaClient } from '../src/generated/prisma/client.js';

/**
 * Preparación global de los tests (corre UNA vez, antes de todo).
 *
 * 1. Borra y vuelve a crear la base `panaderia_test`.
 * 2. Aplica las migraciones ejecutando el SQL real, en orden. No usamos el CLI
 *    de Prisma a propósito: así los tests verifican que el SQL que vamos a
 *    aplicar en producción funciona de verdad sobre una base vacía.
 * 3. Carga la semilla (las dos empresas).
 *
 * Partir de cero en cada corrida es lo que hace que los tests sean
 * REPETIBLES: no importa qué dejó la corrida anterior.
 */
export default async function prepararBase(): Promise<void> {
  const urlPrueba = process.env['DATABASE_URL_PRUEBA'];
  const urlAdmin = process.env['DATABASE_URL_ADMIN'];

  if (!urlPrueba || !urlAdmin) {
    throw new Error(
      'Faltan las URLs de la base de prueba. ¿Existe el archivo .env en la raíz? (cp .env.example .env)',
    );
  }

  const nombre = new URL(urlPrueba).pathname.replace('/', '');

  const admin = new Client({ connectionString: urlAdmin });
  await admin.connect();
  try {
    // WITH (FORCE) corta las conexiones que hayan quedado abiertas de una
    // corrida anterior; sin eso, el DROP falla si algo está conectado.
    await admin.query(`DROP DATABASE IF EXISTS "${nombre}" WITH (FORCE)`);
    await admin.query(`CREATE DATABASE "${nombre}"`);
  } finally {
    await admin.end();
  }

  const cliente = new Client({ connectionString: urlPrueba });
  await cliente.connect();
  try {
    for (const sql of await leerMigraciones()) {
      await cliente.query(sql);
    }
  } finally {
    await cliente.end();
  }

  const pool = new Pool({ connectionString: urlPrueba });
  const prisma = new PrismaClient({
    adapter: new PrismaPg(pool, { disposeExternalPool: false }),
  });
  try {
    await sembrar(prisma);
  } finally {
    await prisma.$disconnect();
    await pool.end();
  }
}

/** Lee los migration.sql en orden cronológico (el nombre empieza con la fecha). */
async function leerMigraciones(): Promise<string[]> {
  const raiz = join(dirname(new URL(import.meta.url).pathname), '..', 'prisma', 'migrations');
  const entradas = await readdir(raiz, { withFileTypes: true });
  const carpetas = entradas
    .filter((entrada) => entrada.isDirectory())
    .map((entrada) => entrada.name)
    .sort();

  const sqls: string[] = [];
  for (const carpeta of carpetas) {
    sqls.push(await readFile(join(raiz, carpeta, 'migration.sql'), 'utf8'));
  }
  return sqls;
}
