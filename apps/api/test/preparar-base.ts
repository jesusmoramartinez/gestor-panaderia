import { dirname, join } from 'node:path';

import { PrismaPg } from '@prisma/adapter-pg';
import { Client, Pool } from 'pg';

import { sembrar } from '../prisma/semilla.js';
import { PrismaClient } from '../src/generated/prisma/client.js';
import { aplicarMigraciones } from '../src/migraciones/migrador.js';

/**
 * Preparación global de los tests (corre UNA vez, antes de todo).
 *
 * 1. Borra y vuelve a crear la base `panaderia_test`.
 * 2. Aplica las migraciones con el MISMO migrador que usa el servidor
 *    (src/migraciones/migrador.ts), no con la CLI de Prisma: así cada corrida
 *    de tests verifica que lo que se aplica en producción funciona de verdad
 *    sobre una base vacía.
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
    await aplicarMigraciones(cliente, CARPETA_MIGRACIONES);
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

/** La carpeta de las migraciones, la misma que usa la CLI de Prisma. */
export const CARPETA_MIGRACIONES = join(
  dirname(new URL(import.meta.url).pathname),
  '..',
  'prisma',
  'migrations',
);
