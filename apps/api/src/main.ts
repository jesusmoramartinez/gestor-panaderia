import { crearApp } from './app.js';
import { env } from './config/env.js';
import { cerrarConexiones } from './lib/db.js';
import { logger } from './lib/log.js';

const app = crearApp();

const servidor = app.listen(env.PORT, () => {
  logger.info(
    { puerto: env.PORT, entorno: env.NODE_ENV },
    `escuchando en http://localhost:${String(env.PORT)}`,
  );
});

/**
 * Cierre ordenado: cuando apretás Ctrl+C, en lugar de morir de golpe el
 * servidor deja de aceptar pedidos nuevos, espera a que terminen los que
 * están en curso y recién entonces cierra las conexiones a la base.
 */
for (const senal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(senal, () => {
    logger.info({ senal }, 'cerrando');
    servidor.close(() => {
      cerrarConexiones()
        .then(() => process.exit(0))
        .catch(() => process.exit(1));
    });
  });
}
