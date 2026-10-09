import { defineConfig, devices } from '@playwright/test';

/**
 * PRUEBAS DE PUNTA A PUNTA (end-to-end, "e2e").
 *
 * Un navegador de verdad usa la aplicación de verdad: el front de Vite, la
 * API de Express y una base PostgreSQL. Es la única clase de prueba que ve
 * lo que ve una persona (nota 17: la lista de insumos vacía que ningún test
 * de la API podía ver).
 *
 * Playwright levanta TODO solo (`webServer`), en puertos distintos de los de
 * desarrollo, así se puede correr con `pnpm dev` abierto:
 *
 *   API  → http://localhost:3100, con su propia base `panaderia_e2e`, que se
 *          borra y se vuelve a sembrar en cada corrida
 *   web  → http://localhost:5174: el BUILD de producción (vite preview), con
 *          las cabeceras de seguridad de vercel.json y el proxy a esa API
 *
 * Correr:  pnpm test:e2e            (desde la raíz)
 * Ver el informe con capturas y trazas de lo que falló:
 *          pnpm --filter @panaderia/e2e exec playwright show-report informe
 */
export default defineConfig({
  testDir: './pruebas',
  // UNA prueba a la vez: comparten la base (la harina de la semilla), y dos
  // pruebas moviendo el mismo stock al mismo tiempo se pisarían.
  fullyParallel: false,
  workers: 1,
  // En una máquina lenta, la primera carga de Vite tarda.
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'informe' }]],
  outputDir: 'resultados',

  use: {
    baseURL: 'http://localhost:5174',
    // La tablet del depósito, en vertical.
    viewport: { width: 768, height: 1024 },
    locale: 'es-AR',
    timezoneId: 'America/Argentina/Buenos_Aires',
    // Si algo falla, queda la traza (cada paso, con captura y red) para verla.
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },

  projects: [
    {
      name: 'tablet',
      use: { ...devices['Desktop Chrome'], viewport: { width: 768, height: 1024 } },
    },
  ],

  // Los dos servidores arrancan EN PARALELO, y los dos necesitan el paquete
  // compartido compilado. Por eso se compila UNA vez antes, en el script
  // `test:e2e` del package.json. Lo encontró el CI: en una máquina limpia el
  // dist/ todavía no existía cuando arrancaba la API (en la mía, siempre).
  webServer: [
    {
      // Prepara la base panaderia_e2e y recién después arranca la API.
      command: 'pnpm --filter @panaderia/api e2e:servidor',
      // Playwright espera a que esta URL conteste. 401 vale: la API está viva.
      url: 'http://localhost:3100/api/sucursales',
      cwd: '..',
      reuseExistingServer: false,
      timeout: 120_000,
      stdout: 'pipe',
    },
    {
      // El BUILD DE PRODUCCIÓN servido con `vite preview`, que aplica las
      // mismas cabeceras de seguridad (CSP incluida) que pone Vercel: se
      // prueba lo que se va a desplegar, no el servidor de desarrollo.
      command:
        'pnpm --filter @panaderia/web build && pnpm --filter @panaderia/web exec vite preview --port 5174 --strictPort',
      url: 'http://localhost:5174',
      cwd: '..',
      env: { API_URL: 'http://localhost:3100' },
      reuseExistingServer: false,
      timeout: 120_000,
    },
  ],
});
