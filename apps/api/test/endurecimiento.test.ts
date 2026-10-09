import express from 'express';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { Writable } from 'node:stream';
import { pino } from 'pino';
import { pinoHttp } from 'pino-http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { manejarError } from '../src/app.js';
import { cerrarConexiones } from '../src/lib/db.js';
import { limitarPedidos } from '../src/middlewares/limitePedidos.js';
import { ClienteHttp } from './cliente-http.js';

/**
 * ENDURECIMIENTO (Fase 11): lo que cambia entre "anda en mi máquina" y
 * "está en internet".
 */

let api: ClienteHttp;

beforeAll(async () => {
  api = await ClienteHttp.levantar();
});

afterAll(async () => {
  await api.cerrar();
  await cerrarConexiones();
});

/** Levanta una app de Express cualquiera en un puerto libre. */
async function levantar(app: express.Express) {
  const servidor = app.listen(0, '127.0.0.1');
  await once(servidor, 'listening');
  const { port } = servidor.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${String(port)}`,
    cerrar: async () => {
      servidor.close();
      await once(servidor, 'close');
    },
  };
}

describe('cabeceras de seguridad (helmet)', () => {
  it('las respuestas traen las cabeceras y no dicen qué tecnología se usa', async () => {
    const r = await api.crudo('/api/health');
    expect(r.headers.get('x-content-type-options')).toBe('nosniff');
    expect(r.headers.get('strict-transport-security')).toContain('max-age=');
    expect(r.headers.get('x-frame-options')).toBe('SAMEORIGIN');
    expect(r.headers.get('content-security-policy')).toContain("default-src 'self'");
    // Sin "X-Powered-By: Express": no regalar la tecnología.
    expect(r.headers.get('x-powered-by')).toBeNull();
  });
});

describe('id de pedido', () => {
  it('cada respuesta trae su X-Request-Id', async () => {
    const r = await api.crudo('/api/health');
    expect(r.headers.get('x-request-id')).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('respeta el id que manda quien llama, si tiene una forma razonable', async () => {
    const propio = await api.crudo('/api/health', {
      headers: { 'x-request-id': 'pedido-12345678' },
    });
    expect(propio.headers.get('x-request-id')).toBe('pedido-12345678');
    // Uno con caracteres raros (intento de meter basura en los logs) se reemplaza.
    const raro = await api.crudo('/api/health', {
      headers: { 'x-request-id': 'a b"<script>' },
    });
    expect(raro.headers.get('x-request-id')).toMatch(/^[0-9a-f-]{36}$/);
  });
});

describe('errores que no son bugs', () => {
  it('un cuerpo que no es JSON válido es 400, no 500', async () => {
    const r = await api.crudo('/api/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{"email": "dueno@',
    });
    expect(r.status).toBe(400);
    expect(((await r.json()) as { codigo: string }).codigo).toBe('DATOS_INVALIDOS');
  });

  it('un cuerpo de más de 1 MB es 413', async () => {
    const r = await api.crudo('/api/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ relleno: 'x'.repeat(1_100_000) }),
    });
    expect(r.status).toBe(413);
  });
});

describe('✅ un error inesperado: mensaje genérico al usuario, detalle completo en el log', () => {
  it('el cliente no ve nada interno, y el log tiene todo, con el id del pedido', async () => {
    const lineas: string[] = [];
    const destino = new Writable({
      write(trozo: Buffer, _codificacion, listo) {
        lineas.push(trozo.toString());
        listo();
      },
    });

    const app = express();
    app.use(pinoHttp({ logger: pino(destino) }));
    app.get('/explota', () => {
      // Lo que NUNCA tiene que llegar al navegador: SQL, nombres de tablas.
      throw new Error('relation "secreto" does not exist en SELECT * FROM secreto');
    });
    app.use(manejarError);
    const servidor = await levantar(app);

    try {
      const r = await fetch(`${servidor.url}/explota`);
      const cuerpo = (await r.json()) as { codigo: string; mensaje: string; idPedido: string };

      expect(r.status).toBe(500);
      expect(cuerpo.codigo).toBe('ERROR_INTERNO');
      expect(cuerpo.mensaje).toMatch(/Ocurrió un error inesperado/);
      const crudo = JSON.stringify(cuerpo);
      expect(crudo).not.toContain('secreto');
      expect(crudo).not.toContain('SELECT');
      expect(crudo).not.toMatch(/at .*\.ts/); // ninguna pila

      // Y el log tiene el detalle completo, con el mismo id que vio el usuario.
      const error = lineas
        .map((linea) => JSON.parse(linea) as Record<string, unknown>)
        .find((linea) => linea['msg'] === 'error no manejado');
      expect(JSON.stringify(error)).toContain('SELECT * FROM secreto');
      expect(JSON.stringify(error)).toContain(cuerpo.idPedido);
    } finally {
      await servidor.cerrar();
    }
  });
});

describe('límite general de pedidos', () => {
  it('pasado el tope por minuto, responde 429', async () => {
    const app = express();
    app.use(limitarPedidos(3));
    app.get('/algo', (_req, res) => {
      res.json({ ok: true });
    });
    app.use(manejarErrorSinLog);
    const servidor = await levantar(app);

    try {
      const estados: number[] = [];
      for (let i = 0; i < 4; i += 1) estados.push((await fetch(`${servidor.url}/algo`)).status);
      expect(estados).toEqual([200, 200, 200, 429]);
    } finally {
      await servidor.cerrar();
    }
  });
});

/** Igual que el manejador real, sin depender de pino (este test no lo monta). */
const manejarErrorSinLog: express.ErrorRequestHandler = (error, _req, res, _next) => {
  const { status, codigo } = error as { status: number; codigo: string };
  res.status(status).json({ codigo });
};
