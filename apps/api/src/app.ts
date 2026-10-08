import cookieParser from 'cookie-parser';
import express, { type ErrorRequestHandler, type Express } from 'express';

import { AppError, describirError } from './lib/errores.js';
import { auditoriaRouter } from './modules/auditoria/routes.js';
import { authRouter } from './modules/auth/routes.js';
import { categoriasRouter } from './modules/categorias/routes.js';
import { healthRouter } from './modules/health/routes.js';
import { insumosRouter } from './modules/insumos/routes.js';
import { movimientosRouter } from './modules/movimientos/routes.js';
import { proveedoresRouter } from './modules/proveedores/routes.js';
import { unidadesRouter } from './modules/unidades/routes.js';
import { usuariosRouter } from './modules/usuarios/routes.js';

/**
 * Arma la aplicación de Express pero NO la pone a escuchar.
 * Separar "armar" de "escuchar" permite que los tests creen la app y la
 * levanten en un puerto libre sin tocar el servidor de desarrollo.
 */
// El tipo de retorno va anotado a mano: con `declaration: true` TypeScript
// tiene que poder nombrar el tipo en el .d.ts que genera, y el tipo inferido
// apuntaba a una ruta interna de node_modules (no portable).
export function crearApp(): Express {
  const app = express();

  // Parsea los cuerpos JSON. El límite evita que alguien mande 500 MB.
  app.use(express.json({ limit: '1mb' }));

  // Deja las cookies del pedido en req.cookies. Express sabe ESCRIBIR cookies
  // (res.cookie) pero no leerlas.
  app.use(cookieParser());

  // Todos los endpoints viven bajo /api.
  app.use('/api', healthRouter);
  app.use('/api', authRouter);
  app.use('/api', usuariosRouter);
  app.use('/api', auditoriaRouter);
  app.use('/api', unidadesRouter);
  app.use('/api', categoriasRouter);
  app.use('/api', insumosRouter);
  app.use('/api', proveedoresRouter);
  app.use('/api', movimientosRouter);

  // Cualquier otra ruta: 404 con la misma forma que el resto de los errores.
  app.use((_req, res) => {
    res.status(404).json({ codigo: 'NO_ENCONTRADO', mensaje: 'La ruta no existe' });
  });

  // Manejador central de errores. Se reconoce porque recibe CUATRO parámetros.
  // En Express 5, si un handler async lanza, el error llega acá solo
  // (en Express 4 había que capturarlo a mano en cada ruta).
  const manejarError: ErrorRequestHandler = (error, _req, res, _next) => {
    // Un AppError es un error ESPERADO y parte del diseño: su mensaje está
    // escrito para que lo lea una persona, así que se devuelve tal cual.
    if (error instanceof AppError) {
      res.status(error.status).json({
        codigo: error.codigo,
        mensaje: error.mensaje,
        ...(error.detalles === undefined ? {} : { detalles: error.detalles }),
      });
      return;
    }

    // Cualquier otra cosa es un bug o una falla de infraestructura.
    console.error('[api] error no manejado:', describirError(error));
    // Al cliente NUNCA se le manda el detalle interno: filtraría rutas de
    // archivos, consultas SQL y versiones de librerías.
    res.status(500).json({ codigo: 'ERROR_INTERNO', mensaje: 'Ocurrió un error inesperado' });
  };
  app.use(manejarError);

  return app;
}
