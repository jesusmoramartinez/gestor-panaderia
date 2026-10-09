// Configuración "flat" de ESLint (el formato actual, desde ESLint 9).
// Es un array: cada objeto se aplica a los archivos que indique y los de
// abajo sobrescriben a los de arriba.
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettierConfig from 'eslint-config-prettier/flat';

export default tseslint.config(
  // 1. Lo que ESLint ni mira
  {
    ignores: [
      '**/dist/**',
      '**/coverage/**',
      '**/node_modules/**',
      // Código generado por Prisma: no lo escribimos nosotros.
      '**/src/generated/**',
      // Lo que genera Playwright en cada corrida (informe HTML, trazas).
      'e2e/informe/**',
      'e2e/resultados/**',
    ],
  },

  // 2. Reglas básicas de JavaScript
  js.configs.recommended,

  // 3. Reglas de TypeScript CON información de tipos.
  //    Esto habilita reglas que sin tipos son imposibles, como
  //    no-floating-promises: avisa cuando te olvidás un `await`, que en un
  //    sistema de stock significa "la transacción siguió sin esperar a la base".
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },

  // 4. Ajustes propios del proyecto.
  {
    rules: {
      // Un parámetro que empieza con "_" se considera intencionalmente sin usar.
      // Hace falta porque Express reconoce el middleware de errores por tener
      // CUATRO parámetros: si borrás `next` para que no sobre, Express deja de
      // tratarlo como manejador de errores. TypeScript ya usa esta convención
      // (noUnusedParameters ignora los "_"); acá la replicamos en ESLint.
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],
    },
  },

  // 5. Los archivos .js de configuración no están en ningún tsconfig,
  //    así que para ellos apagamos las reglas que necesitan tipos.
  {
    files: ['**/*.{js,mjs,cjs}'],
    extends: [tseslint.configs.disableTypeChecked],
  },

  // 6. El script del tema corre en el NAVEGADOR, antes que React (ver
  //    apps/web/public/tema-inicial.js): ahí existen estas variables globales.
  {
    files: ['apps/web/public/**/*.js'],
    languageOptions: {
      globals: { window: 'readonly', document: 'readonly', localStorage: 'readonly' },
    },
  },

  // 7. Va ÚLTIMO: apaga las reglas de ESLint que pelean con Prettier.
  prettierConfig,
);
