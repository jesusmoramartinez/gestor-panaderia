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
  /**
   * Cargar el saldo inicial de un insumo en una sucursal.
   *
   * No lo tiene el empleado: es el punto de partida de todo el kardex, y
   * cargarlo mal desvía el stock desde el día uno.
   */
  'stock:cargar-inicial',
  /** Registrar el consumo de producción. El empleado del turno lo necesita. */
  'consumo:crear',
  /** Registrar una merma, siempre con motivo. También la carga el empleado. */
  'merma:crear',
  /**
   * Anular un movimiento con una reversa (contra-asiento).
   *
   * Uno de los dos permisos PELIGROSOS del sistema. Supuesto de la pregunta
   * C-24 de PLAN.md: lo tienen el dueño y el encargado.
   */
  'movimiento:anular',
  /**
   * Dejar el stock en negativo a propósito.
   *
   * El otro permiso peligroso. No es un capricho: si el sistema dice 12 kg y
   * en el depósito hay 20 porque falta cargar una compra, trabar al panadero
   * no arregla nada. Pero cada vez que se usa queda registrado en la
   * auditoría con el nombre de quien lo hizo.
   */
  'stock:forzar',
  /**
   * Ajustar el stock a lo contado.
   *
   * El tercer permiso delicado: cambia el saldo sin que haya pasado nada
   * físico, así que es la forma más fácil de tapar un faltante. Por eso lleva
   * motivo obligatorio, queda en el historial como cualquier movimiento, y no
   * lo tiene el empleado.
   */
  'ajuste:crear',
  /**
   * VER órdenes de compra, recepciones, plantillas y el costo promedio.
   *
   * Lleva permiso por la misma razón que `proveedor:ver`: son precios.
   */
  'compra:ver',
  /**
   * PEDIR: crear, editar, pedir, cancelar y cerrar órdenes de compra, y
   * administrar las plantillas de pedidos recurrentes.
   *
   * Solo el dueño: respuesta C-13 del cliente ("solo el dueño compra").
   */
  'compra:pedir',
  /**
   * RECIBIR: registrar la llegada de mercadería, con orden o sin ella.
   *
   * Lo tiene también el encargado, en SU sucursal: el camión llega aunque el
   * dueño no esté, y si nadie más puede cargarlo el stock queda mal hasta que
   * vuelva. Decisión del cliente al arrancar la Fase 8.
   */
  'compra:recibir',
  /**
   * Anular una recepción. Solo el dueño: además del stock de una sucursal,
   * cambia el costo promedio de TODA la empresa.
   */
  'compra:anular',
  /**
   * ENVIAR insumos a otra sucursal, y anular un envío que todavía no llegó.
   * Se exige poder operar en la sucursal de ORIGEN.
   */
  'transferencia:enviar',
  /**
   * CONFIRMAR que llegó una transferencia (C-19: "el que recibe confirma").
   * Se exige poder operar en la sucursal de DESTINO. Decisión del cliente al
   * arrancar la Fase 9: el dueño y el encargado, no el empleado.
   */
  'transferencia:recibir',
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
  ENCARGADO: [
    'usuario:ver',
    'insumo:editar',
    'proveedor:ver',
    'proveedor:editar',
    'stock:cargar-inicial',
    'consumo:crear',
    'merma:crear',
    'movimiento:anular',
    'stock:forzar',
    'ajuste:crear',
    'compra:ver',
    'compra:recibir',
    'transferencia:enviar',
    'transferencia:recibir',
  ],
  // El empleado del turno carga lo que PASÓ en su sucursal: lo que usó y lo
  // que se perdió. No configura el catálogo, no ve precios, no anula nada y no
  // puede dejar el stock en negativo. Ver el stock y el historial no lleva
  // permiso: son cantidades, no plata.
  EMPLEADO: ['consumo:crear', 'merma:crear'],
};

export function tienePermiso(rol: Rol, permiso: Permiso): boolean {
  return PERMISOS_POR_ROL[rol].includes(permiso);
}

export function permisosDe(rol: Rol): readonly Permiso[] {
  return PERMISOS_POR_ROL[rol];
}
