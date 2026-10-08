import { Pool } from 'pg';

import { env } from '../config/env.js';

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

export async function cerrarPool(): Promise<void> {
  await pool.end();
}
