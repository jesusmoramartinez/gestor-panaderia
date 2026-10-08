import { crearApp } from './app.js';
import { env } from './config/env.js';
import { cerrarPool } from './lib/db.js';

const app = crearApp();

const servidor = app.listen(env.PORT, () => {
  console.log(`[api] escuchando en http://localhost:${env.PORT}  (NODE_ENV=${env.NODE_ENV})`);
});

/**
 * Cierre ordenado: cuando apretás Ctrl+C, en lugar de morir de golpe el
 * servidor deja de aceptar pedidos nuevos, espera a que terminen los que
 * están en curso y recién entonces cierra las conexiones a la base.
 */
for (const senal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(senal, () => {
    console.log(`\n[api] recibí ${senal}, cerrando...`);
    servidor.close(() => {
      cerrarPool()
        .then(() => process.exit(0))
        .catch(() => process.exit(1));
    });
  });
}
