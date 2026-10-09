import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { readFileSync } from 'node:fs';
import { defineConfig } from 'vite';

/**
 * Las cabeceras de seguridad de producción, leídas de vercel.json (la única
 * fuente de verdad), para aplicarlas también en `vite preview`.
 *
 * Así las pruebas de Playwright, que corren contra el build de producción,
 * usan la MISMA política de contenido (CSP) que va a poner Vercel: si algo
 * del front choca con ella (un script en línea, una fuente externa), falla
 * acá y no en producción.
 */
type ConfigVercel = { headers: { source: string; headers: { key: string; value: string }[] }[] };
const vercel = JSON.parse(
  readFileSync(new URL('../../vercel.json', import.meta.url), 'utf8'),
) as ConfigVercel;
const cabecerasDeProduccion = Object.fromEntries(
  (vercel.headers.find((regla) => regla.source === '/(.*)')?.headers ?? []).map((h) => [
    h.key,
    h.value,
  ]),
);

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // `vite preview` sirve el build de producción (dist/). Lo usan las pruebas
  // de Playwright, con las cabeceras de producción y el mismo proxy de /api.
  preview: {
    port: 5174,
    headers: cabecerasDeProduccion,
    proxy: {
      '/api': { target: process.env['API_URL'] ?? 'http://localhost:3000', changeOrigin: true },
    },
  },
  server: {
    port: 5173,
    proxy: {
      /**
       * PROXY DE DESARROLLO.
       *
       * El navegador pide http://localhost:5173/api/health y Vite reenvía
       * ese pedido a http://localhost:3000/api/health.
       *
       * ¿Por qué? Por CORS: el navegador bloquea los pedidos de una página
       * servida en el puerto 5173 hacia otro origen (el puerto 3000 es otro
       * origen). Con el proxy, para el navegador TODO viene del 5173, así que
       * CORS no se activa y no hay nada que configurar en el backend.
       *
       * En producción no hace falta: front y API van a estar en el mismo dominio.
       */
      //
      // El destino se puede cambiar con API_URL: las pruebas de Playwright
      // levantan OTRA API (puerto 3100, con su propia base) y otro Vite que
      // apunta a ella, sin chocar con el `pnpm dev` que tengas abierto.
      '/api': {
        target: process.env['API_URL'] ?? 'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },
});
