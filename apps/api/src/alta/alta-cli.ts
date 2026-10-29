/**
 * Alta de producción por línea de comandos. Ver docs/operacion.md.
 *
 *   ALTA_PASSWORD='...' pnpm --filter @panaderia/api alta empresa ruta/empresa.json
 *   ALTA_PASSWORD='...' pnpm --filter @panaderia/api alta usuario ruta/usuario.json
 *
 * La base es la de DATABASE_URL (o DIRECT_URL, si está). Hay ejemplos de los
 * JSON en docs/ejemplos/.
 */
import { readFileSync } from 'node:fs';

import { cerrarConexiones, prisma } from '../src/lib/db.js';
import { darDeAltaEmpresa, darDeAltaUsuario } from './alta.js';

const [que, archivo] = process.argv.slice(2);

async function main(): Promise<void> {
  if ((que !== 'empresa' && que !== 'usuario') || archivo === undefined) {
    throw new Error('Uso: alta empresa|usuario <archivo.json>  (contraseña en ALTA_PASSWORD)');
  }
  const datos: unknown = JSON.parse(readFileSync(archivo, 'utf8'));
  const password = process.env['ALTA_PASSWORD'];

  if (que === 'empresa') {
    const r = await darDeAltaEmpresa(
      prisma,
      datos as Parameters<typeof darDeAltaEmpresa>[1],
      password,
    );
    console.log(`[alta] empresa creada: ${r.empresaId}`);
    console.log('[alta] guardá ese id: hace falta para dar de alta los demás usuarios.');
  } else {
    const r = await darDeAltaUsuario(
      prisma,
      datos as Parameters<typeof darDeAltaUsuario>[1],
      password,
    );
    console.log(`[alta] usuario creado: ${r.usuarioId}`);
  }
}

main()
  .catch((error: unknown) => {
    console.error(`[alta] ERROR: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  })
  .finally(() => cerrarConexiones());
