import { validarEnv } from './env.schema.js';

/**
 * La configuración ya validada. Se calcula UNA vez, al importar este módulo.
 * Si algo está mal, esto lanza y el proceso no llega a escuchar en el puerto.
 *
 * A partir de acá, `env.PORT` es un number y `env.DATABASE_URL` es un string
 * garantizado: el resto del código no necesita volver a chequear nada.
 */
export const env = validarEnv(process.env);
