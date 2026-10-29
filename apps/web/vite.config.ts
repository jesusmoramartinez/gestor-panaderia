import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
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
       * En producción no hace falta: la API sirve también las pantallas, así
       * que todo sale del mismo dominio.
       */
      //
      // El destino se puede cambiar con API_URL (por ejemplo, para apuntar
      // el front de desarrollo a otra API).
      '/api': {
        target: process.env['API_URL'] ?? 'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },
});
