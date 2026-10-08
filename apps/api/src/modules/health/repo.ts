// CAPA 4 — ACCESO A DATOS: solo consultas. No decide reglas.
import { pool } from '../../lib/db.js';

/**
 * La consulta más simple posible: le pedimos a Postgres que devuelva un 1.
 * No lee ninguna tabla, así que funciona incluso con la base recién creada
 * y vacía. Si esto responde, la conexión está viva.
 */
export async function verificarConexion(): Promise<void> {
  await pool.query('SELECT 1');
}
