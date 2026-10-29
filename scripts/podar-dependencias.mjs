// Borra de una carpeta armada por `pnpm deploy` los paquetes que la app no
// puede alcanzar. Lo corre el Dockerfile:
//
//   node scripts/podar-dependencias.mjs /salida
//
// ¿Por qué hace falta? @prisma/client declara a `prisma` (la CLI) y a
// `typescript` como dependencias "peer" OPCIONALES, y pnpm las enlaza igual.
// Con ellas viajaban ~200 MB que la app nunca carga: Prisma Studio, una base
// embebida (PGlite), los motores de migración. Las migraciones las aplica
// src/migraciones/migrador.ts, sin la CLI.
//
// Cómo: en node_modules/.pnpm cada paquete tiene su propio node_modules con
// enlaces a sus dependencias. Se recorren esos enlaces desde las dependencias
// directas de la app, SIN seguir los peers opcionales de abajo, y lo que no se
// alcanzó se borra. Si un día la app necesitara algo borrado, la prueba de la
// imagen (que importa la app y corre consultas) falla al armarla.
import { existsSync, readdirSync, realpathSync, rmSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import process from 'node:process';

const PEERS_QUE_NO_SE_SIGUEN = new Set(['prisma', 'typescript']);

const raiz = process.argv[2];
if (raiz === undefined)
  throw new Error('Uso: node podar-dependencias.mjs <carpeta de pnpm deploy>');
const almacen = join(raiz, 'node_modules', '.pnpm');

/** Los enlaces a dependencias dentro de una carpeta node_modules (con @scope/). */
function dependenciasEn(carpeta) {
  if (!existsSync(carpeta)) return [];
  const nombres = [];
  for (const entrada of readdirSync(carpeta)) {
    if (entrada === '.pnpm' || entrada === '.bin') continue;
    if (entrada.startsWith('@')) {
      for (const sub of readdirSync(join(carpeta, entrada))) nombres.push(`${entrada}/${sub}`);
    } else {
      nombres.push(entrada);
    }
  }
  return nombres;
}

/** La carpeta de .pnpm a la que pertenece un paquete ya resuelto (".pnpm/<id>"). */
function idEnAlmacen(rutaReal) {
  const relativa = relative(almacen, rutaReal);
  return relativa.startsWith('..') ? undefined : relativa.split(sep)[0];
}

const alcanzados = new Set();
const porVisitar = dependenciasEn(join(raiz, 'node_modules')).map((n) =>
  realpathSync(join(raiz, 'node_modules', n)),
);

while (porVisitar.length > 0) {
  const paquete = porVisitar.pop();
  const id = idEnAlmacen(paquete);
  if (id === undefined || alcanzados.has(id)) continue;
  alcanzados.add(id);
  // Las dependencias de un paquete son sus HERMANOS en .pnpm/<id>/node_modules.
  const hermanos = join(almacen, id, 'node_modules');
  for (const nombre of dependenciasEn(hermanos)) {
    if (PEERS_QUE_NO_SE_SIGUEN.has(nombre)) continue;
    porVisitar.push(realpathSync(join(hermanos, nombre)));
  }
}

let borrados = 0;
for (const id of readdirSync(almacen)) {
  const ruta = join(almacen, id);
  if (alcanzados.has(id) || !statSync(ruta).isDirectory() || id === 'node_modules') continue;
  rmSync(ruta, { recursive: true, force: true });
  borrados += 1;
}
// Los enlaces a los peers borrados quedarían colgando.
for (const id of alcanzados) {
  for (const peer of PEERS_QUE_NO_SE_SIGUEN) {
    rmSync(join(almacen, id, 'node_modules', peer), { force: true });
  }
}
process.stdout.write(
  `[podar] ${String(alcanzados.size)} paquetes quedan, ${String(borrados)} borrados\n`,
);
