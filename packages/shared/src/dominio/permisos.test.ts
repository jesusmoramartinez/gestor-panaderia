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
    expect(permisosDe('EMPLEADO')).toEqual([]);
    expect(permisosDe('ENCARGADO')).toEqual(['usuario:ver']);
  });
});
