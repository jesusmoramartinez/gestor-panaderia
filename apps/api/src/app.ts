import cookieParser from 'cookie-parser';
import express, { type ErrorRequestHandler, type Express } from 'express';
import helmet from 'helmet';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
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
 * levanten en un puerto libre sin tocar el servidor de desarrollo.
 */
// El tipo de retorno va anotado a mano: con `declaration: true` TypeScript
// tiene que poder nombrar el tipo en el .d.ts que genera, y el tipo inferido
// apuntaba a una ruta interna de node_modules (no portable).
export function crearApp(): Express {
  const app = express();

  // Detrás de un proxy (Caddy, en el VPS), la IP real viene en X-Forwarded-For. Ver
  // TRUST_PROXY en config/env.schema.ts: sin esto, el limitador vería a
  // todos los usuarios como una sola IP.
  app.set('trust proxy', env.TRUST_PROXY ? 1 : false);

  // CABECERAS DE SEGURIDAD (helmet). Valen para la API y para las pantallas,
  // que desde el VPS también salen de acá:
  //   - Content-Security-Policy: solo corre el JavaScript que viene de este
  //     mismo sitio, en archivos. Un script inyectado (XSS) no se ejecuta.
  //     Es la misma política que ya probaba Playwright contra el build.
  //   - Strict-Transport-Security: "hablame solo por HTTPS". Arranca en un
  //     día, como la clínica: si algo sale mal con el certificado, el
  //     navegador no queda atado un año.
  //   - X-Content-Type-Options: nosniff, para que el navegador no "adivine"
  //     que un JSON es un script;
  //   - saca X-Powered-By: Express (no regalar qué tecnología se usa).
  // Caddy pone además las mismas cabeceras que en la clínica y, donde
  // coinciden, gana la de Caddy (ver infra/servidor/caddy/Caddyfile).
  app.use(
    helmet({
      contentSecurityPolicy: {
        useDefaults: false,
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'"],
          imgSrc: ["'self'", 'data:'],
          fontSrc: ["'self'"],
          connectSrc: ["'self'"],
          objectSrc: ["'none'"],
          baseUri: ["'self'"],
          formAction: ["'self'"],
          frameAncestors: ["'none'"],
        },
      },
      strictTransportSecurity: { maxAge: 86_400, includeSubDomains: false },
    }),
  );
  app.use((_req, res, next) => {
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()');
    next();
  });

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

  // Una ruta de la API que no existe: 404 con la misma forma que el resto de
  // los errores (y nunca el index.html de la web, que confundiría al front).
  app.use('/api', (_req, res) => {
    res.status(404).json({ codigo: 'NO_ENCONTRADO', mensaje: 'La ruta no existe' });
  });

  // LAS PANTALLAS (solo si WEB_DIR está: en el VPS y en Playwright).
  if (env.WEB_DIR !== undefined) {
    servirWeb(app, env.WEB_DIR);
  }

  // Cualquier otra ruta: 404.
  app.use((_req, res) => {
    res.status(404).json({ codigo: 'NO_ENCONTRADO', mensaje: 'La ruta no existe' });
  });

  app.use(manejarError);

  return app;
}

/**
 * Sirve la web compilada por Vite.
 *
 * - /assets/*: los archivos llevan un hash en el nombre (index-3f9a1c.js), así
 *   que el mismo nombre es siempre el mismo contenido: el navegador los
 *   guarda un año sin volver a preguntar.
 * - index.html: nunca se guarda. Es lo que apunta a los assets de la versión
 *   nueva: si quedara viejo en la caché, después de un deploy el navegador
 *   seguiría pidiendo los archivos de la versión anterior.
 * - Cualquier otra ruta (/stock, /compras/123) devuelve index.html: es una
 *   SPA, y la ruta la resuelve React Router en el navegador. Sin esto,
 *   recargar la página en /stock daría 404.
 */
function servirWeb(app: Express, carpeta: string): void {
  const indice = join(carpeta, 'index.html');
  const sinCache = 'no-cache';

  app.use('/assets', express.static(join(carpeta, 'assets'), { immutable: true, maxAge: '1y' }));
  // Un asset que no existe es un 404, no el index.html (el navegador lo
  // intentaría ejecutar como JavaScript).
  app.use('/assets', (_req, res) => {
    res.status(404).json({ codigo: 'NO_ENCONTRADO', mensaje: 'El archivo no existe' });
  });
  app.use(
    express.static(carpeta, {
      index: false,
      setHeaders: (res) => res.setHeader('Cache-Control', sinCache),
    }),
  );
  app.get('/{*ruta}', (_req, res) => {
    res.setHeader('Cache-Control', sinCache);
    res.sendFile(indice);
  });
}
