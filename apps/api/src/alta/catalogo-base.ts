/**
 * El catálogo base: lo que cualquier panadería necesita para arrancar y que
 * no depende de ella (unidades de medida, motivos de movimiento, categorías).
 *
 * Lo cargan las DOS puertas de entrada de una empresa: el alta de producción
 * (alta.ts) y la semilla de desarrollo (prisma/semilla.ts). Vive en src/ y no
 * en prisma/ para que entre en la imagen de producción SIN la semilla: la
 * imagen lleva solo lo compilado de src/ (ver el Dockerfile).
 */

/**
 * Las unidades de medida básicas. Son iguales para toda panadería, así que no
 * forman parte de la definición de cada empresa: se cargan para todas.
 *
 * `factorABase` va como TEXTO, nunca como number: es el factor del que
 * depende cada conversión del sistema.
 */
export const UNIDADES = [
  { codigo: 'kg', nombre: 'Kilogramo', dimension: 'PESO', factorABase: '1', esBase: true },
  { codigo: 'g', nombre: 'Gramo', dimension: 'PESO', factorABase: '0.001', esBase: false },
  { codigo: 'l', nombre: 'Litro', dimension: 'VOLUMEN', factorABase: '1', esBase: true },
  { codigo: 'ml', nombre: 'Mililitro', dimension: 'VOLUMEN', factorABase: '0.001', esBase: false },
  { codigo: 'u', nombre: 'Unidad', dimension: 'UNIDAD', factorABase: '1', esBase: true },
] as const;

/**
 * Los motivos de movimiento. Como las unidades, son iguales para cualquier
 * panadería, así que se cargan para todas las empresas.
 *
 * `tipoAplicable` dice a qué clase de movimiento se le puede poner cada uno:
 * "Diferencia de conteo" no tiene sentido en una merma, y "Vencido" no tiene
 * sentido en un ajuste. Que el motivo sea una tabla y no texto libre es lo que
 * permite responder "¿cuánta plata perdimos por vencimiento este mes?".
 */
export const MOTIVOS = [
  { tipoAplicable: 'MERMA', nombre: 'Vencido' },
  { tipoAplicable: 'MERMA', nombre: 'Roto / derramado' },
  { tipoAplicable: 'MERMA', nombre: 'Plaga o humedad' },
  { tipoAplicable: 'MERMA', nombre: 'Error de carga' },
  // La usa sola la recepción de una transferencia cuando llega menos de lo que
  // salió (Fase 9): la diferencia se registra como merma en el destino.
  { tipoAplicable: 'MERMA', nombre: 'Diferencia en transferencia' },
  { tipoAplicable: 'AJUSTE', nombre: 'Diferencia de conteo' },
  { tipoAplicable: 'AJUSTE', nombre: 'Diferencia en transferencia' },
  { tipoAplicable: 'AJUSTE', nombre: 'Error de carga' },
  { tipoAplicable: 'CONSUMO', nombre: 'Producción del turno' },
  { tipoAplicable: 'CONSUMO', nombre: 'Prueba / degustación' },
] as const;

/**
 * Las categorías con las que arranca el catálogo de insumos, con su ícono
 * (un emoji: ver apps/web/src/components/iconosInsumo.tsx). El ícono es lo
 * que se ve en la barra de filtros de Insumos, y el que usa un insumo que
 * no tiene uno propio.
 */
export const CATEGORIAS = [
  { nombre: 'Harinas', icono: '🌾' },
  { nombre: 'Levaduras y mejoradores', icono: '🫧' },
  { nombre: 'Azúcares', icono: '🍬' },
  { nombre: 'Grasas y aceites', icono: '🧈' },
  { nombre: 'Lácteos', icono: '🥛' },
  { nombre: 'Huevos', icono: '🥚' },
  { nombre: 'Sal y condimentos', icono: '🧂' },
  { nombre: 'Rellenos y coberturas', icono: '🍯' },
  { nombre: 'Chocolates y cacao', icono: '🍫' },
  { nombre: 'Frutas y abrillantados', icono: '🍒' },
  { nombre: 'Semillas y frutos secos', icono: '🌰' },
  { nombre: 'Esencias y aditivos', icono: '🧪' },
  { nombre: 'Fiambres y quesos', icono: '🧀' },
  { nombre: 'Verduras y salsas', icono: '🍅' },
  { nombre: 'Envases y descartables', icono: '📦' },
  { nombre: 'Limpieza', icono: '🧽' },
] as const;
