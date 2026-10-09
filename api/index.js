/**
 * LA API EN VERCEL: una "función" (serverless).
 *
 * Vercel convierte cada archivo de la carpeta /api en una función: no hay un
 * servidor prendido todo el tiempo, sino un proceso que se levanta cuando
 * llega un pedido (y se reusa mientras haya tráfico). Una app de Express es,
 * en el fondo, una función (req, res): por eso alcanza con exportarla.
 *
 * Importa el código COMPILADO (apps/api/dist), que arma el buildCommand de
 * vercel.json. Todos los pedidos a /api/* llegan acá por el `rewrite` de
 * vercel.json, y Express los reparte entre sus rutas como siempre.
 *
 * No hay `listen`: de escuchar se encarga Vercel. Es exactamente la razón por
 * la que desde la Fase 0 crearApp() arma la app sin ponerla a escuchar.
 */
import { crearApp } from '../apps/api/dist/app.js';

export default crearApp();
