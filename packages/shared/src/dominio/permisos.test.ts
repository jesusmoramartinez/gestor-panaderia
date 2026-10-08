import { describe, expect, it } from 'vitest';

import { PERMISOS, PERMISOS_POR_ROL, permisosDe, tienePermiso } from './permisos.js';

describe('matriz de permisos', () => {
  it('el dueño tiene todos los permisos', () => {
    for (const permiso of PERMISOS) {
      expect(tienePermiso('DUENO', permiso)).toBe(true);
    }
  });

  it('el encargado puede ver usuarios pero no crearlos', () => {
    expect(tienePermiso('ENCARGADO', 'usuario:ver')).toBe(true);
    expect(tienePermiso('ENCARGADO', 'usuario:crear')).toBe(false);
  });

  it('el empleado carga consumo y mermas: es su trabajo', () => {
    expect(tienePermiso('EMPLEADO', 'consumo:crear')).toBe(true);
    expect(tienePermiso('EMPLEADO', 'merma:crear')).toBe(true);
  });

  it('los dos permisos PELIGROSOS son del dueño y del encargado', () => {
    // Supuesto de la pregunta C-24 de PLAN.md. Anular un movimiento, dejar el
    // stock en negativo y ajustarlo a mano son las tres cosas que pueden tapar
    // un problema real.
    for (const permiso of ['movimiento:anular', 'stock:forzar', 'ajuste:crear'] as const) {
      expect(tienePermiso('DUENO', permiso), permiso).toBe(true);
      expect(tienePermiso('ENCARGADO', permiso), permiso).toBe(true);
      expect(tienePermiso('EMPLEADO', permiso), permiso).toBe(false);
    }
  });

  it('el empleado no carga el saldo inicial: es el punto de partida del kardex', () => {
    expect(tienePermiso('EMPLEADO', 'stock:cargar-inicial')).toBe(false);
    expect(tienePermiso('ENCARGADO', 'stock:cargar-inicial')).toBe(true);
  });

  it('el empleado no puede ver usuarios ni la auditoría', () => {
    expect(tienePermiso('EMPLEADO', 'usuario:ver')).toBe(false);
    expect(tienePermiso('EMPLEADO', 'auditoria:ver')).toBe(false);
  });

  it('solo el dueño ve la auditoría', () => {
    const conAcceso = (['DUENO', 'ENCARGADO', 'EMPLEADO'] as const).filter((rol) =>
      tienePermiso(rol, 'auditoria:ver'),
    );
    expect(conAcceso).toEqual(['DUENO']);
  });

  it('los tres roles están en la matriz (si se agrega uno, este test falla)', () => {
    expect(Object.keys(PERMISOS_POR_ROL).sort()).toEqual(['DUENO', 'EMPLEADO', 'ENCARGADO']);
  });

  it('ningún rol tiene permisos que no estén en el catálogo', () => {
    for (const permisos of Object.values(PERMISOS_POR_ROL)) {
      for (const permiso of permisos) {
        expect(PERMISOS).toContain(permiso);
      }
    }
  });

  it('permisosDe devuelve la lista del rol', () => {
    expect(permisosDe('EMPLEADO')).toEqual(['consumo:crear', 'merma:crear']);
    expect(permisosDe('ENCARGADO')).toEqual([
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
    ]);
  });

  it('las transferencias las mueven el dueño y el encargado, no el empleado (Fase 9)', () => {
    for (const permiso of ['transferencia:enviar', 'transferencia:recibir'] as const) {
      expect(tienePermiso('ENCARGADO', permiso), permiso).toBe(true);
      expect(tienePermiso('EMPLEADO', permiso), permiso).toBe(false);
    }
  });

  it('pedir y anular compras es solo del dueño; recibir, también del encargado (C-13)', () => {
    expect(tienePermiso('ENCARGADO', 'compra:pedir')).toBe(false);
    expect(tienePermiso('ENCARGADO', 'compra:anular')).toBe(false);
    expect(tienePermiso('ENCARGADO', 'compra:recibir')).toBe(true);
    // El empleado no ve precios: ni órdenes ni recepciones.
    for (const permiso of [
      'compra:ver',
      'compra:pedir',
      'compra:recibir',
      'compra:anular',
    ] as const) {
      expect(tienePermiso('EMPLEADO', permiso), permiso).toBe(false);
    }
  });

  it('el encargado puede administrar el catálogo de insumos', () => {
    // Es quien se da cuenta de que falta dar de alta un insumo.
    expect(tienePermiso('ENCARGADO', 'insumo:editar')).toBe(true);
  });

  it('el empleado puede VER el catálogo pero no modificarlo', () => {
    // Ver el catálogo no lleva permiso: cualquiera que cargue un consumo
    // necesita elegir el insumo. Modificarlo sí.
    expect(tienePermiso('EMPLEADO', 'insumo:editar')).toBe(false);
  });

  it('el empleado NO ve proveedores, porque ahí hay precios', () => {
    // Es la diferencia con los demás catálogos: la relación proveedor-insumo
    // lleva el último precio de compra. Supuesto de la pregunta C-23 de
    // PLAN.md: el empleado ve cantidades, no precios.
    expect(tienePermiso('EMPLEADO', 'proveedor:ver')).toBe(false);
    expect(tienePermiso('EMPLEADO', 'proveedor:editar')).toBe(false);
  });

  it('quien puede editar proveedores también puede verlos', () => {
    // Un rol que pudiera editar sin ver no tendría forma de usar la pantalla.
    for (const rol of ['DUENO', 'ENCARGADO', 'EMPLEADO'] as const) {
      if (tienePermiso(rol, 'proveedor:editar')) {
        expect(tienePermiso(rol, 'proveedor:ver')).toBe(true);
      }
    }
  });
});
