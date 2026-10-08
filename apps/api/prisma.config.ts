import { join } from 'node:path';

import { defineConfig } from 'prisma/config';

/**
 * Configuración del CLI de Prisma (Prisma 7).
 *
 * Novedad de la versión 7: la URL de la base ya NO va en schema.prisma, va acá.
 * Y este archivo es TypeScript, así que puede ejecutar código — por eso puede
 * cargar el .env por su cuenta.
 *
 * Usamos process.loadEnvFile (nativo de Node) en lugar de la librería dotenv
 * que sugiere la plantilla de Prisma: una dependencia menos, y es el mismo
 * criterio que usamos en la API (que carga el .env con --env-file).
 *
 * La ruta se resuelve desde la ubicación de ESTE archivo (import.meta.dirname)
 * y no desde el directorio actual, así funciona igual la corras desde
 * apps/api o desde la raíz del repositorio.
 */
try {
  process.loadEnvFile(join(import.meta.dirname, '../../.env'));
} catch {
  // En una copia recién clonada todavía no existe el .env, y `prisma generate`
  // (que corre en el postinstall) no necesita la base. Los comandos que SÍ la
  // necesitan van a fallar después con un mensaje claro.
}

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
    // Lo que ejecuta `prisma migrate reset` y `prisma db seed`.
    seed: 'tsx --env-file=../../.env prisma/seed.ts',
  },
  datasource: {
    url: process.env['DATABASE_URL'],
  },
});
