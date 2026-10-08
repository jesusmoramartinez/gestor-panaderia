import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';

import { env } from '../config/env.js';
import { PrismaClient } from '../generated/prisma/client.js';

/**
 * Un POOL es un conjunto de conexiones reutilizables a Postgres.
 *
 * ¿Por qué un pool y no abrir una conexión por pedido? Porque abrir una
 * conexión a Postgres cuesta decenas de milisegundos y consume memoria en el
 * servidor. El pool las mantiene abiertas y las presta: cada pedido toma una,
 * la usa y la devuelve.
 */
export const pool = new Pool({
  connectionString: env.DATABASE_URL,
  max: 10,
  // Si la base no responde en 5s, fallar con un error claro en lugar de
  // dejar el pedido colgado para siempre.
  connectionTimeoutMillis: 5_000,
});

// Si una conexión en reposo se cae (por ejemplo, reiniciás el contenedor de
// Postgres), pg emite un evento 'error'. Sin este listener, Node considera
// que es un error no manejado y MATA el proceso. Con esto, la API sigue viva
// y el pool abre una conexión nueva en el próximo pedido.
pool.on('error', (error: Error) => {
  console.error('[db] error en una conexión en reposo:', error.message);
});

/**
 * Prisma 7 no se conecta solo: necesita un "driver adapter", que es el puente
 * entre Prisma y el driver real de la base. Le pasamos EL MISMO pool de arriba.
 *
 * ¿Por qué compartirlo en lugar de dejar que Prisma abra el suyo?
 *   - Un solo conjunto de conexiones contra Postgres (no 10 + 10).
 *   - Un solo lugar donde se configuran límites y timeouts.
 *   - Un solo cierre ordenado.
 *   - Y el `SELECT 1` del health check pasa por el mismo pool que usa Prisma,
 *     así que verifica de verdad lo que la aplicación va a usar.
 *
 * disposeExternalPool: false significa "el pool no es tuyo, no lo cierres":
 * de cerrarlo nos encargamos nosotros en cerrarConexiones().
 */
const adaptador = new PrismaPg(pool, { disposeExternalPool: false });

export const prisma = new PrismaClient({ adapter: adaptador });

/** Cierre ordenado: primero Prisma, después el pool que le presta las conexiones. */
export async function cerrarConexiones(): Promise<void> {
  await prisma.$disconnect();
  await pool.end();
}
