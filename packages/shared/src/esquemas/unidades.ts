import { z } from 'zod';

import { DIMENSIONES } from '../dominio/unidades.js';

export const DimensionSchema = z.enum(DIMENSIONES);

/**
 * Una unidad de medida tal como la devuelve la API.
 *
 * Ojo con `factorABase`: viaja como TEXTO, no como número. JSON no tiene tipo
 * decimal, así que si lo mandáramos como number el navegador lo parsearía como
 * float y perderíamos exactitud justo en el factor del que depende todo el
 * stock. Ver docs/aprendizaje/04-dinero-y-cantidades-decimal.md
 *
 * Esta forma cumple el tipo UnidadConversion del dominio, así que el frontend
 * puede usar convertir() con lo que recibe, sin transformar nada.
 */
export const UnidadMedidaSchema = z.object({
  id: z.uuid(),
  codigo: z.string(),
  nombre: z.string(),
  dimension: DimensionSchema,
  factorABase: z.string(),
  esBase: z.boolean(),
});
export type UnidadMedida = z.infer<typeof UnidadMedidaSchema>;

export const ListaUnidadesSchema = z.array(UnidadMedidaSchema);
