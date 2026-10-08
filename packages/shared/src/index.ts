// Punto de entrada único del paquete compartido.
// api y web importan desde '@panaderia/shared', nunca desde rutas internas.
//
// Nota sobre los '.js': en módulos ESM de Node los imports relativos llevan
// la extensión del archivo COMPILADO (.js), aunque el archivo fuente sea .ts.
// TypeScript lo entiende y resuelve al .ts correspondiente.
export * from './constantes.js';
export * from './dominio/fecha.js';
export * from './dominio/permisos.js';
export * from './esquemas/auth.js';
export * from './esquemas/salud.js';
