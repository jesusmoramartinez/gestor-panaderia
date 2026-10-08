/**
 * Matriz de permisos.
 *
 * Vive en el paquete compartido porque la necesitan los DOS lados:
 *   - el backend, para RECHAZAR lo que no corresponde (es la única defensa real);
 *   - el frontend, para no mostrar botones que van a dar 403.
 *
 * Ojo con eso: esconder un botón NO es seguridad. El frontend corre en la
 * máquina del usuario y se puede modificar. La matriz del front es comodidad;
 * la que importa es la que chequea el servidor.
 *
 * Esta lista CRECE en cada fase. Hoy solo están los permisos que algún
 * endpoint usa de verdad: un permiso declarado y no usado es código muerto que
 * confunde.
 */
import type { Rol } from '../esquemas/auth.js';

export const PERMISOS = [
  'usuario:ver',
  'usuario:crear',
  'auditoria:ver',
  /** Crear, editar y desactivar insumos, categorías, presentaciones y mínimos. */
  'insumo:editar',
  /**
   * VER proveedores y qué insumo provee cada uno.
   *
   * Este sí lleva permiso, al contrario de los otros catálogos, y la razón es
   * el PRECIO: la relación proveedor–insumo incluye el último precio de compra,
   * y el supuesto de la pregunta C-23 de PLAN.md es que el empleado ve
   * cantidades, no precios. Esconderlo en la pantalla no alcanzaría: el dato no
   * tiene que salir del servidor.
   */
  'proveedor:ver',
  /** Crear, editar y desactivar proveedores y sus asociaciones con insumos. */
  'proveedor:editar',
] as const;

export type Permiso = (typeof PERMISOS)[number];

/**
 * Qué puede hacer cada rol.
 *
 * El DUEÑO tiene todo: no por comodidad, sino porque es el dueño del negocio y
 * no tiene sentido ocultarle sus propios datos.
 */
export const PERMISOS_POR_ROL: Record<Rol, readonly Permiso[]> = {
  DUENO: PERMISOS,
  // El encargado administra el catálogo: es quien se da cuenta de que falta
  // dar de alta un insumo. VER los catálogos no lleva permiso (lo necesita
  // cualquiera que cargue stock), solo modificarlos. La excepción es el de
  // proveedores: es quien llama al molino cuando falta harina, y para eso
  // necesita ver y corregir precios y códigos de artículo.
  ENCARGADO: ['usuario:ver', 'insumo:editar', 'proveedor:ver', 'proveedor:editar'],
  EMPLEADO: [],
};

export function tienePermiso(rol: Rol, permiso: Permiso): boolean {
  return PERMISOS_POR_ROL[rol].includes(permiso);
}

export function permisosDe(rol: Rol): readonly Permiso[] {
  return PERMISOS_POR_ROL[rol];
}
