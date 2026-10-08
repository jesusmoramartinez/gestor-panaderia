/**
 * Catálogo de insumos de prueba, con datos realistas de una panadería
 * argentina: las presentaciones son las que se compran de verdad (bolsa de
 * 25 kg de harina, maple de 30 huevos, bidón de 10 litros de aceite) y los
 * mínimos son distintos en la central y en la sucursal, que es justo lo que
 * pidió el cliente.
 *
 * `cantidadBase` está SIEMPRE en la unidad base del insumo. Un "Pan 500 g" de
 * levadura, que se lleva en kg, trae 0.5.
 */

export type DefinicionPresentacion = {
  nombre: string;
  /** Cuántas unidades base trae. Texto, nunca number. */
  cantidadBase: string;
  esDefault?: boolean;
};

export type DefinicionInsumo = {
  nombre: string;
  codigo?: string;
  /** Nombre de la categoría; se crea si no existe. */
  categoria: string;
  /** Código de la unidad base: kg, g, l, ml, u. */
  unidad: string;
  presentaciones: readonly DefinicionPresentacion[];
  /** Stock mínimo por código de sucursal. */
  minimos: Readonly<Record<string, string>>;
};

export const CATEGORIAS = [
  'Harinas',
  'Levaduras y mejoradores',
  'Sal y condimentos',
  'Azúcares',
  'Grasas y aceites',
  'Lácteos',
  'Huevos',
  'Rellenos y coberturas',
  'Semillas y frutos secos',
  'Envases y descartables',
] as const;

export const INSUMOS_LAFERRERE: readonly DefinicionInsumo[] = [
  // --- Harinas
  {
    nombre: 'Harina 000',
    codigo: 'HAR-000',
    categoria: 'Harinas',
    unidad: 'kg',
    presentaciones: [
      { nombre: 'Bolsa 25 kg', cantidadBase: '25', esDefault: true },
      { nombre: 'Bolsa 50 kg', cantidadBase: '50' },
    ],
    minimos: { CEN: '300', LAF: '50' },
  },
  {
    nombre: 'Harina 0000',
    codigo: 'HAR-0000',
    categoria: 'Harinas',
    unidad: 'kg',
    presentaciones: [{ nombre: 'Bolsa 25 kg', cantidadBase: '25', esDefault: true }],
    minimos: { CEN: '150', LAF: '30' },
  },
  {
    nombre: 'Harina integral',
    categoria: 'Harinas',
    unidad: 'kg',
    presentaciones: [{ nombre: 'Bolsa 25 kg', cantidadBase: '25', esDefault: true }],
    minimos: { CEN: '50', LAF: '10' },
  },
  // --- Levaduras
  {
    nombre: 'Levadura fresca',
    categoria: 'Levaduras y mejoradores',
    unidad: 'kg',
    presentaciones: [
      { nombre: 'Caja 10 kg', cantidadBase: '10', esDefault: true },
      // Se lleva en kg, así que medio kilo es 0.5: el ejemplo típico de por
      // qué las cantidades necesitan decimales exactos.
      { nombre: 'Pan 500 g', cantidadBase: '0.5' },
    ],
    minimos: { CEN: '10', LAF: '2' },
  },
  {
    nombre: 'Levadura seca',
    categoria: 'Levaduras y mejoradores',
    unidad: 'kg',
    presentaciones: [{ nombre: 'Sobre 500 g', cantidadBase: '0.5', esDefault: true }],
    minimos: { CEN: '2', LAF: '0.5' },
  },
  {
    nombre: 'Mejorador de masa',
    categoria: 'Levaduras y mejoradores',
    unidad: 'kg',
    presentaciones: [{ nombre: 'Bolsa 5 kg', cantidadBase: '5', esDefault: true }],
    minimos: { CEN: '10', LAF: '2' },
  },
  // --- Sal
  {
    nombre: 'Sal fina',
    categoria: 'Sal y condimentos',
    unidad: 'kg',
    presentaciones: [{ nombre: 'Bolsa 25 kg', cantidadBase: '25', esDefault: true }],
    minimos: { CEN: '25', LAF: '5' },
  },
  {
    nombre: 'Sal gruesa',
    categoria: 'Sal y condimentos',
    unidad: 'kg',
    presentaciones: [{ nombre: 'Bolsa 25 kg', cantidadBase: '25', esDefault: true }],
    minimos: { CEN: '25', LAF: '5' },
  },
  // --- Azúcares
  {
    nombre: 'Azúcar',
    codigo: 'AZU-COM',
    categoria: 'Azúcares',
    unidad: 'kg',
    presentaciones: [
      { nombre: 'Bolsa 50 kg', cantidadBase: '50', esDefault: true },
      { nombre: 'Bolsa 25 kg', cantidadBase: '25' },
    ],
    minimos: { CEN: '100', LAF: '25' },
  },
  {
    nombre: 'Azúcar impalpable',
    categoria: 'Azúcares',
    unidad: 'kg',
    presentaciones: [{ nombre: 'Bolsa 10 kg', cantidadBase: '10', esDefault: true }],
    minimos: { CEN: '20', LAF: '5' },
  },
  // --- Grasas y aceites
  {
    nombre: 'Manteca',
    categoria: 'Grasas y aceites',
    unidad: 'kg',
    presentaciones: [
      { nombre: 'Pan 5 kg', cantidadBase: '5', esDefault: true },
      { nombre: 'Pan 1 kg', cantidadBase: '1' },
    ],
    minimos: { CEN: '40', LAF: '10' },
  },
  {
    nombre: 'Margarina de hojaldre',
    categoria: 'Grasas y aceites',
    unidad: 'kg',
    presentaciones: [{ nombre: 'Caja 10 kg', cantidadBase: '10', esDefault: true }],
    minimos: { CEN: '30', LAF: '5' },
  },
  {
    nombre: 'Grasa vacuna',
    categoria: 'Grasas y aceites',
    unidad: 'kg',
    presentaciones: [{ nombre: 'Caja 10 kg', cantidadBase: '10', esDefault: true }],
    minimos: { CEN: '20', LAF: '5' },
  },
  {
    nombre: 'Aceite de girasol',
    categoria: 'Grasas y aceites',
    unidad: 'l',
    presentaciones: [
      { nombre: 'Bidón 10 l', cantidadBase: '10', esDefault: true },
      { nombre: 'Botella 900 ml', cantidadBase: '0.9' },
    ],
    minimos: { CEN: '30', LAF: '10' },
  },
  // --- Lácteos y huevos
  {
    nombre: 'Leche entera',
    categoria: 'Lácteos',
    unidad: 'l',
    presentaciones: [
      { nombre: 'Sachet 1 l', cantidadBase: '1', esDefault: true },
      { nombre: 'Bidón 10 l', cantidadBase: '10' },
    ],
    minimos: { CEN: '50', LAF: '20' },
  },
  {
    nombre: 'Crema de leche',
    categoria: 'Lácteos',
    unidad: 'l',
    presentaciones: [{ nombre: 'Sachet 1 l', cantidadBase: '1', esDefault: true }],
    minimos: { CEN: '20', LAF: '8' },
  },
  {
    nombre: 'Huevo fresco',
    codigo: 'HUE-FRE',
    categoria: 'Huevos',
    unidad: 'u',
    presentaciones: [
      { nombre: 'Maple 30 u', cantidadBase: '30', esDefault: true },
      { nombre: 'Caja 360 u', cantidadBase: '360' },
    ],
    minimos: { CEN: '360', LAF: '90' },
  },
  // --- Rellenos y coberturas
  {
    nombre: 'Dulce de leche repostero',
    categoria: 'Rellenos y coberturas',
    unidad: 'kg',
    presentaciones: [{ nombre: 'Balde 10 kg', cantidadBase: '10', esDefault: true }],
    minimos: { CEN: '40', LAF: '10' },
  },
  {
    nombre: 'Chocolate cobertura semiamargo',
    categoria: 'Rellenos y coberturas',
    unidad: 'kg',
    presentaciones: [{ nombre: 'Caja 5 kg', cantidadBase: '5', esDefault: true }],
    minimos: { CEN: '15', LAF: '5' },
  },
  {
    nombre: 'Cacao amargo',
    categoria: 'Rellenos y coberturas',
    unidad: 'kg',
    presentaciones: [{ nombre: 'Bolsa 1 kg', cantidadBase: '1', esDefault: true }],
    minimos: { CEN: '5', LAF: '2' },
  },
  {
    nombre: 'Membrillo en pan',
    categoria: 'Rellenos y coberturas',
    unidad: 'kg',
    presentaciones: [{ nombre: 'Caja 5 kg', cantidadBase: '5', esDefault: true }],
    minimos: { CEN: '10', LAF: '3' },
  },
  {
    nombre: 'Esencia de vainilla',
    categoria: 'Rellenos y coberturas',
    unidad: 'l',
    presentaciones: [
      { nombre: 'Botella 1 l', cantidadBase: '1', esDefault: true },
      { nombre: 'Botella 100 ml', cantidadBase: '0.1' },
    ],
    minimos: { CEN: '2', LAF: '1' },
  },
  // --- Semillas
  {
    nombre: 'Semillas de sésamo',
    categoria: 'Semillas y frutos secos',
    unidad: 'kg',
    presentaciones: [{ nombre: 'Bolsa 5 kg', cantidadBase: '5', esDefault: true }],
    minimos: { CEN: '10', LAF: '3' },
  },
  {
    nombre: 'Semillas de girasol',
    categoria: 'Semillas y frutos secos',
    unidad: 'kg',
    presentaciones: [{ nombre: 'Bolsa 5 kg', cantidadBase: '5', esDefault: true }],
    minimos: { CEN: '10', LAF: '3' },
  },
  {
    nombre: 'Nuez mariposa',
    categoria: 'Semillas y frutos secos',
    unidad: 'kg',
    presentaciones: [{ nombre: 'Bolsa 1 kg', cantidadBase: '1', esDefault: true }],
    minimos: { CEN: '5', LAF: '2' },
  },
  // --- Envases
  {
    nombre: 'Bolsa de papel kraft',
    categoria: 'Envases y descartables',
    unidad: 'u',
    presentaciones: [{ nombre: 'Paquete 500 u', cantidadBase: '500', esDefault: true }],
    minimos: { CEN: '2000', LAF: '1000' },
  },
  {
    nombre: 'Caja para torta 25 cm',
    categoria: 'Envases y descartables',
    unidad: 'u',
    presentaciones: [{ nombre: 'Paquete 50 u', cantidadBase: '50', esDefault: true }],
    minimos: { CEN: '200', LAF: '100' },
  },
  {
    nombre: 'Film de cocina',
    categoria: 'Envases y descartables',
    unidad: 'u',
    presentaciones: [{ nombre: 'Rollo', cantidadBase: '1', esDefault: true }],
    minimos: { CEN: '10', LAF: '5' },
  },
];

/**
 * La segunda empresa tiene POCOS insumos, y dos con el MISMO nombre que los de
 * la primera. No es casualidad: es lo que demuestra que el nombre es único por
 * empresa y no global, y que un listado nunca mezcla las dos.
 */
export const INSUMOS_VECINA: readonly DefinicionInsumo[] = [
  {
    nombre: 'Harina 000',
    categoria: 'Harinas',
    unidad: 'kg',
    presentaciones: [{ nombre: 'Bolsa 25 kg', cantidadBase: '25', esDefault: true }],
    minimos: { UNI: '80' },
  },
  {
    nombre: 'Azúcar',
    categoria: 'Azúcares',
    unidad: 'kg',
    presentaciones: [{ nombre: 'Bolsa 50 kg', cantidadBase: '50', esDefault: true }],
    minimos: { UNI: '40' },
  },
];
