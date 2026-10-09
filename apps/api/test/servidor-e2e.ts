/**
 * La API para las pruebas de punta a punta (Playwright, carpeta e2e/).
 *
 * Hace dos cosas, EN ESTE ORDEN, y por eso es un solo script:
 *
 *   1. Borra, migra y siembra la base `panaderia_e2e` (la misma preparación
 *      que usan los tests de integración, con otra base).
 *   2. Recién ahí arranca la API, apuntando a esa base y en el puerto 3100.
 *
 * Una base APARTE porque estas pruebas usan la aplicación de verdad: crean
 * compras, mandan transferencias. Si corrieran contra la base de desarrollo,
 * ensuciarían los datos con los que estás trabajando, y además dependerían de
 * lo que hayas cargado a mano (la Fase 8 tenía tests que fallaban justamente
 * por eso).
 *
 * Lo lanza Playwright (`webServer` en e2e/playwright.config.ts); a mano no
 * hace falta correrlo nunca.
 */
try {
  process.loadEnvFile('../../.env');
} catch {
  // En CI no hay .env: DATABASE_URL viene del entorno del workflow.
}

const urlDev = process.env['DATABASE_URL'] ?? '';
if (urlDev === '') throw new Error('Falta DATABASE_URL en el .env de la raíz.');

function conBase(url: string, nombre: string): string {
  const parsed = new URL(url);
  parsed.pathname = `/${nombre}`;
  return parsed.toString();
}

const urlE2e = conBase(urlDev, 'panaderia_e2e');
process.env['DATABASE_URL_PRUEBA'] = urlE2e;
process.env['DATABASE_URL_ADMIN'] = conBase(urlDev, 'postgres');

const { default: prepararBase } = await import('./preparar-base.js');
await prepararBase();
console.log('[e2e] base panaderia_e2e lista');

// Las variables se cambian ANTES de importar la API: su configuración se lee
// y se valida una sola vez, al importar config/env.ts.
process.env['DATABASE_URL'] = urlE2e;
process.env['PORT'] = process.env['PORT_E2E'] ?? '3100';
process.env['NODE_ENV'] = 'test';
process.env['LIMITE_PEDIDOS_POR_MINUTO'] = '0';
await import('../src/main.js');
