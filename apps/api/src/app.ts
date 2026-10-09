import cookieParser from 'cookie-parser';
import express, { type ErrorRequestHandler, type Express } from 'express';
import helmet from 'helmet';
import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { pinoHttp } from 'pino-http';

import { env } from './config/env.js';
import { AppError, describirError } from './lib/errores.js';
import { logger } from './lib/log.js';
import { limitarPedidos } from './middlewares/limitePedidos.js';
import { auditoriaRouter } from './modules/auditoria/routes.js';
import { authRouter } from './modules/auth/routes.js';
import { categoriasRouter } from './modules/categorias/routes.js';
import { comprasRouter } from './modules/compras/routes.js';
import { healthRouter } from './modules/health/routes.js';
import { insumosRouter } from './modules/insumos/routes.js';
import { movimientosRouter } from './modules/movimientos/routes.js';
import { plantillasRouter } from './modules/plantillas/routes.js';
import { proveedoresRouter } from './modules/proveedores/routes.js';
import { reposicionRouter } from './modules/reposicion/routes.js';
import { sucursalesRouter } from './modules/sucursales/routes.js';
import { transferenciasRouter } from './modules/transferencias/routes.js';
import { unidadesRouter } from './modules/unidades/routes.js';
import { usuariosRouter } from './modules/usuarios/routes.js';

/**
 * El id de un pedido: el que manda quien llama (X-Request-Id), si tiene una
 * forma razonable, o uno nuevo. Viaja de vuelta en la respuesta y aparece en
 * CADA línea de log de ese pedido: con él se encuentra todo lo que pasó en
 * un pedido entre miles.
 */
function idDelPedido(req: IncomingMessage, res: ServerResponse): string {
  const recibido = req.headers['x-request-id'];
  const id =
    typeof recibido === 'string' && /^[\w-]{8,64}$/.test(recibido) ? recibido : randomUUID();
  res.setHeader('X-Request-Id', id);
  return id;
}

/**
 * El manejador central de errores. Se reconoce porque recibe CUATRO
 * parámetros. En Express 5, si un handler async lanza, el error llega acá
 * solo (en Express 4 había que capturarlo a mano en cada ruta).
 *
 * Se exporta para poder testearlo con un error de verdad inesperado.
 */
export const manejarError: ErrorRequestHandler = (error, req, res, _next) => {
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

  // Errores del propio Express que NO son bugs: un cuerpo que no es JSON
  // válido, o demasiado grande. Antes caían como 500 ("error inesperado"),
  // y eran culpa de quien mandó el pedido.
  const tipo = (error as { type?: unknown }).type;
  if (tipo === 'entity.parse.failed') {
    res
      .status(400)
      .json({ codigo: 'DATOS_INVALIDOS', mensaje: 'El cuerpo del pedido no es JSON válido.' });
    return;
  }
  if (tipo === 'entity.too.large') {
    res.status(413).json({
      codigo: 'PEDIDO_DEMASIADO_GRANDE',
      mensaje: 'El pedido es demasiado grande.',
    });
    return;
  }

  // Cualquier otra cosa es un bug o una falla de infraestructura.
  //
  // El DETALLE COMPLETO (mensaje, pila, causa) va al LOG, con el id del
  // pedido. Al cliente NUNCA: filtraría rutas de archivos, consultas SQL y
  // versiones de librerías, que es exactamente lo que busca un atacante.
  // Lo que sí recibe es el id, para poder decir "me pasó esto" y que se
  // encuentre en los logs.
  req.log.error({ err: error, detalle: describirError(error) }, 'error no manejado');
  // pino-http tipa el id como string | number | objeto. El nuestro es texto
  // (lo arma idDelPedido), pero si alguien monta pino-http sin él es un
  // número, y el código que ve el usuario tiene que ser el mismo del log.
  const idPedido =
    typeof req.id === 'string' || typeof req.id === 'number' ? String(req.id) : 'sin-id';
  res.status(500).json({
    codigo: 'ERROR_INTERNO',
    mensaje: `Ocurrió un error inesperado. Si se repite, avisá con este código: ${idPedido.slice(0, 8)}`,
    idPedido,
  });
};

/**
 * Arma la aplicación de Express pero NO la pone a escuchar.
 * Separar "armar" de "escuchar" permite que los tests creen la app y la
 * levanten en un puerto libre sin tocar el servidor de desarrollo, y que
 * Vercel la use como función (api/index.ts) sin `listen`.
 */
// El tipo de retorno va anotado a mano: con `declaration: true` TypeScript
// tiene que poder nombrar el tipo en el .d.ts que genera, y el tipo inferido
// apuntaba a una ruta interna de node_modules (no portable).
export function crearApp(): Express {
  const app = express();

  // Detrás de un proxy (Vercel), la IP real viene en X-Forwarded-For. Ver
  // TRUST_PROXY en config/env.schema.ts: sin esto, el limitador vería a
  // todos los usuarios como una sola IP.
  app.set('trust proxy', env.TRUST_PROXY ? 1 : false);

  // CABECERAS DE SEGURIDAD (helmet). Las más importantes para esta API:
  //   - Strict-Transport-Security: "hablame solo por HTTPS", por un año;
  //   - X-Content-Type-Options: nosniff, para que el navegador no
  //     "adivine" que un JSON es un script;
  //   - Content-Security-Policy y X-Frame-Options: nadie puede meter la API
  //     en un <iframe> de otro sitio (clickjacking);
  //   - saca X-Powered-By: Express (no regalar qué tecnología se usa).
  // Las del front (el HTML de Vite) las pone Vercel: ver vercel.json.
  app.use(helmet());

  // Una línea de log por pedido, con su id, su duración y su status.
  app.use(
    pinoHttp({
      logger,
      genReqId: idDelPedido,
      // 5xx = error, 4xx = advertencia (un 409 de stock es normal, pero
      // muchos juntos dicen algo), el resto = info.
      customLogLevel: (_req, res, error) =>
        error !== undefined || res.statusCode >= 500
          ? 'error'
          : res.statusCode >= 400
            ? 'warn'
            : 'info',
      // Solo lo útil: sin cabeceras (ahí viaja la cookie de sesión).
      serializers: {
        req: (req: { id: unknown; method: string; url: string }) => ({
          id: req.id,
          method: req.method,
          url: req.url,
        }),
        res: (res: { statusCode: number }) => ({ statusCode: res.statusCode }),
      },
    }),
  );

  // Un freno grueso contra scripts que martillan la API.
  app.use('/api', limitarPedidos(env.LIMITE_PEDIDOS_POR_MINUTO));

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
  app.use('/api', comprasRouter);
  app.use('/api', plantillasRouter);
  app.use('/api', sucursalesRouter);
  app.use('/api', transferenciasRouter);
  app.use('/api', reposicionRouter);

  // Cualquier otra ruta: 404 con la misma forma que el resto de los errores.
  app.use((_req, res) => {
    res.status(404).json({ codigo: 'NO_ENCONTRADO', mensaje: 'La ruta no existe' });
  });

  app.use(manejarError);

  return app;
}
