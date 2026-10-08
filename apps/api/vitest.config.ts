import { defineConfig } from 'vitest/config';

/**
 * Los tests de integración NO corren contra la base de desarrollo: usan una
 * base aparte (`panaderia_test`) que se borra y se vuelve a crear en cada
 * corrida. Si usaran la misma, un test borraría los datos con los que estás
 * trabajando.
 */
try {
  process.loadEnvFile('../../.env');
} catch {
  // Sin .env los tests de integración no pueden correr, y preparar-base.ts
  // avisa con un mensaje claro. Los tests unitarios siguen funcionando.
}

/** Devuelve la misma cadena de conexión apuntando a otra base. */
function conBase(url: string, nombre: string): string {
  const parsed = new URL(url);
  parsed.pathname = `/${nombre}`;
  return parsed.toString();
}

const urlDev = process.env['DATABASE_URL'] ?? '';
const urlPrueba = urlDev === '' ? '' : conBase(urlDev, 'panaderia_test');
// Para crear y borrar `panaderia_test` hay que estar conectado a OTRA base:
// no se puede borrar la base a la que estás conectado.
const urlAdmin = urlDev === '' ? '' : conBase(urlDev, 'postgres');

// Se leen en preparar-base.ts, que corre en este mismo proceso.
process.env['DATABASE_URL_PRUEBA'] = urlPrueba;
process.env['DATABASE_URL_ADMIN'] = urlAdmin;

export default defineConfig({
  test: {
    // Los tests reciben la base de prueba, no la de desarrollo.
    env: { DATABASE_URL: urlPrueba },
    globalSetup: ['./test/preparar-base.ts'],
    // Los tests de integración comparten una sola base: si corrieran en
    // paralelo, uno contaría usuarios mientras otro los crea.
    fileParallelism: false,
    // El hasheo con scrypt tarda ~130 ms a propósito, y el seed hace varios.
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
