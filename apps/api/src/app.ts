import express, { type ErrorRequestHandler, type Express } from 'express';

import { healthRouter } from './modules/health/routes.js';

/**
 * Arma la aplicación de Express pero NO la pone a escuchar.
 * Separar "armar" de "escuchar" permite que los tests creen la app en memoria
 * sin ocupar un puerto.
 */
// El tipo de retorno va anotado a mano: con `declaration: true` TypeScript
// tiene que poder nombrar el tipo en el .d.ts que genera, y el tipo inferido
// apuntaba a una ruta interna de node_modules (no portable).
export function crearApp(): Express {
  const app = express();

  // Parsea los cuerpos JSON. El límite evita que alguien mande 500 MB.
  app.use(express.json({ limit: '1mb' }));

  // Todos los endpoints viven bajo /api.
  app.use('/api', healthRouter);

  // Cualquier otra ruta: 404 con la misma forma que el resto de los errores.
  app.use((_req, res) => {
    res.status(404).json({ codigo: 'NO_ENCONTRADO', mensaje: 'La ruta no existe' });
  });

  // Manejador central de errores. Se reconoce porque recibe CUATRO parámetros.
  // En Express 5, si un handler async lanza, el error llega acá solo
  // (en Express 4 había que capturarlo a mano en cada ruta).
  const manejarError: ErrorRequestHandler = (error, _req, res, _next) => {
    console.error('[api] error no manejado:', error);
    // Al cliente NUNCA se le manda el detalle interno: filtraría rutas de
    // archivos, consultas SQL y versiones de librerías.
    res.status(500).json({ codigo: 'ERROR_INTERNO', mensaje: 'Ocurrió un error inesperado' });
  };
  app.use(manejarError);

  return app;
}
