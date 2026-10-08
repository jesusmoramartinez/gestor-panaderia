/**
 * Proveedores de prueba.
 *
 * Los nombres y los CUIT son INVENTADOS a propósito: son datos de desarrollo,
 * no los proveedores reales de la panadería. Cuando el cliente dé su lista, se
 * reemplaza este archivo.
 *
 * Lo que sí es realista es la FORMA de los datos, que es lo que el sistema
 * tiene que soportar:
 *   - "Harina 000" la venden DOS proveedores, uno preferido y otro de respaldo
 *     (es el caso de la pregunta C-6 de PLAN.md, y lo que justifica la marca
 *     de preferido y la comparación de precios);
 *   - cada proveedor vende en una presentación distinta (bolsa de 25 o de 50);
 *   - hay un proveedor que entrega en el día (diasEntrega: 0) y otro que tarda
 *     tres días: cero y null NO son lo mismo.
 */

export type DefinicionProveedorInsumo = {
  /** Nombre del insumo, tal como está en semilla-insumos.ts. */
  insumo: string;
  /** Nombre de la presentación. Si falta, lo vende en la unidad base. */
  presentacion?: string;
  codigoProveedor?: string;
  /** Precio de la presentación. Texto, nunca number. */
  ultimoPrecio?: string;
  esPreferido?: boolean;
};

export type DefinicionProveedor = {
  nombre: string;
  razonSocial?: string;
  /** Sin guiones, como lo normaliza el esquema Zod. */
  cuit?: string;
  email?: string;
  telefono?: string;
  direccion?: string;
  contactoNombre?: string;
  diasEntrega?: number;
  notas?: string;
  insumos: readonly DefinicionProveedorInsumo[];
};

export const PROVEEDORES_LAFERRERE: readonly DefinicionProveedor[] = [
  {
    nombre: 'Molino San Jorge',
    razonSocial: 'Molino San Jorge S.A.',
    cuit: '30712345678',
    email: 'ventas@molinosanjorge.test',
    telefono: '11 4567-8900',
    direccion: 'Ruta 3 km 32, Laferrere',
    contactoNombre: 'Jorge (ventas)',
    diasEntrega: 2,
    notas: 'Entrega con camión propio. Pedido mínimo: 20 bolsas.',
    insumos: [
      {
        insumo: 'Harina 000',
        presentacion: 'Bolsa 25 kg',
        codigoProveedor: 'H000-25',
        ultimoPrecio: '18500.0000',
        esPreferido: true,
      },
      {
        insumo: 'Harina 0000',
        presentacion: 'Bolsa 25 kg',
        codigoProveedor: 'H0000-25',
        ultimoPrecio: '19200.0000',
        esPreferido: true,
      },
      {
        insumo: 'Harina integral',
        presentacion: 'Bolsa 25 kg',
        ultimoPrecio: '21000.0000',
        esPreferido: true,
      },
      { insumo: 'Sal fina', presentacion: 'Bolsa 25 kg', ultimoPrecio: '9800.0000' },
    ],
  },
  {
    // El segundo proveedor de harina: más caro y en bolsa de 50, pero entrega
    // en el día. Existe para que la comparación de precios tenga sentido.
    nombre: 'Distribuidora La Esquina',
    cuit: '30798765432',
    telefono: '11 2233-4455',
    contactoNombre: 'Marisa',
    diasEntrega: 0,
    notas: 'Más caro pero entrega en el día. Para cuando nos quedamos cortos.',
    insumos: [
      {
        insumo: 'Harina 000',
        presentacion: 'Bolsa 50 kg',
        codigoProveedor: '4412',
        ultimoPrecio: '39500.0000',
      },
      {
        insumo: 'Azúcar',
        presentacion: 'Bolsa 50 kg',
        ultimoPrecio: '44000.0000',
        esPreferido: true,
      },
      {
        insumo: 'Levadura fresca',
        presentacion: 'Caja 10 kg',
        ultimoPrecio: '23000.0000',
        esPreferido: true,
      },
      {
        insumo: 'Aceite de girasol',
        presentacion: 'Bidón 10 l',
        ultimoPrecio: '26500.0000',
        esPreferido: true,
      },
    ],
  },
  {
    nombre: 'Lácteos del Oeste',
    razonSocial: 'Lácteos del Oeste S.R.L.',
    cuit: '30755554444',
    email: 'pedidos@lacteosdeloeste.test',
    diasEntrega: 1,
    insumos: [
      {
        insumo: 'Manteca',
        presentacion: 'Pan 5 kg',
        ultimoPrecio: '48000.0000',
        esPreferido: true,
      },
      {
        insumo: 'Leche entera',
        presentacion: 'Sachet 1 l',
        ultimoPrecio: '1450.0000',
        esPreferido: true,
      },
      { insumo: 'Crema de leche', ultimoPrecio: '5200.0000', esPreferido: true },
      // Sin precio todavía: se acaba de agregar y nadie le preguntó cuánto
      // sale. `ultimoPrecio` queda en null, que NO es lo mismo que cero.
      { insumo: 'Huevo fresco', presentacion: 'Maple 30 u' },
    ],
  },
  {
    nombre: 'Envases Rápidos',
    telefono: '11 6677-8899',
    // Sin diasEntrega: null significa "no sabemos cuánto tarda", distinto del
    // cero de La Esquina.
    insumos: [
      {
        insumo: 'Bolsa de papel kraft',
        presentacion: 'Paquete 500 u',
        codigoProveedor: 'KRAFT-500',
        ultimoPrecio: '12500.0000',
        esPreferido: true,
      },
      {
        insumo: 'Caja para torta 25 cm',
        presentacion: 'Paquete 50 u',
        ultimoPrecio: '8900.0000',
        esPreferido: true,
      },
    ],
  },
];

/** La otra empresa tiene su propio proveedor: nunca comparten datos. */
export const PROVEEDORES_VECINA: readonly DefinicionProveedor[] = [
  {
    nombre: 'Molino San Jorge',
    // MISMO nombre y MISMO CUIT que el de la otra empresa, a propósito: en la
    // realidad dos panaderías le compran al mismo molino, y el sistema tiene
    // que dejarlas cargarlo por separado sin que una vea la ficha de la otra.
    cuit: '30712345678',
    diasEntrega: 3,
    insumos: [
      {
        insumo: 'Harina 000',
        presentacion: 'Bolsa 25 kg',
        ultimoPrecio: '18900.0000',
        esPreferido: true,
      },
    ],
  },
];
