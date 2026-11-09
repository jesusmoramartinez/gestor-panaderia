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
 *   http://localhost:3100: la API sirviendo también el BUILD de producción
 *   de la web, como en el VPS (mismo proceso, mismas cabeceras de seguridad,
 *   CSP incluida). Con su propia base `panaderia_e2e`, que se borra y se
 *   vuelve a sembrar en cada corrida.
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
    baseURL: 'http://localhost:3100',
    // La tablet del depósito, en vertical.
    viewport: { width: 768, height: 1024 },
    locale: 'es-AR',
    timezoneId: 'America/Argentina/Buenos_Aires',
    // Si algo falla, queda la traza (cada paso, con captura y red) para verla.
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },

  // Las pruebas de la etapa de stock corren en la tablet del depósito. Las
  // del MVP de compras (Etapa 2, C-27: "PC y celular") corren en los dos
  // tamaños en que las usa Marcelo: el celular, con pantalla táctil, y la PC.
  projects: [
    {
      name: 'tablet',
      testMatch: /(compras|transferencias|reposicion)\.spec\.ts/,
      use: { ...devices['Desktop Chrome'], viewport: { width: 768, height: 1024 } },
    },
    {
      name: 'celular',
      testMatch: /mvp-.*\.spec\.ts/,
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 390, height: 844 },
        isMobile: true,
        hasTouch: true,
        deviceScaleFactor: 2,
      },
    },
    {
      name: 'pc',
      testMatch: /mvp-.*\.spec\.ts/,
      use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 } },
    },
  ],

  // La web se compila ANTES (script `test:e2e` del package.json), junto con
  // el paquete compartido: la API la sirve desde apps/web/dist. Lo encontró
  // el CI: en una máquina limpia el dist/ todavía no existía (en la mía, siempre).
  webServer: {
    // Prepara la base panaderia_e2e y recién después arranca la API.
    command: 'pnpm --filter @panaderia/api e2e:servidor',
    // Playwright espera a que esta URL conteste: la pantalla de login.
    url: 'http://localhost:3100/login',
    cwd: '..',
    reuseExistingServer: false,
    timeout: 120_000,
    stdout: 'pipe',
  },
});
