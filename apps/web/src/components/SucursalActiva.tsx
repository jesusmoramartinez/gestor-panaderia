import type { SucursalResumen } from '@panaderia/shared';
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';

/**
 * La sucursal en la que el usuario está trabajando ahora.
 *
 * Casi todo el sistema que viene (stock, consumos, mermas, conteos) ocurre EN
 * una sucursal, así que esta elección acompaña al usuario por toda la
 * aplicación. Se guarda en localStorage para que no tenga que elegirla cada
 * vez que abre el sistema.
 *
 * Ojo: esto es una COMODIDAD, no seguridad. El servidor vuelve a verificar en
 * cada pedido que el usuario pueda operar en la sucursal que mande.
 */
const CLAVE_ALMACENAMIENTO = 'panaderia.sucursalActiva';

type ValorContexto = {
  sucursales: readonly SucursalResumen[];
  activa: SucursalResumen | null;
  cambiar: (sucursalId: string) => void;
};

const Contexto = createContext<ValorContexto | null>(null);

/** localStorage puede fallar (modo privado, permisos): nunca sin try/catch. */
function leerGuardada(): string | null {
  try {
    return localStorage.getItem(CLAVE_ALMACENAMIENTO);
  } catch {
    return null;
  }
}

function guardar(sucursalId: string): void {
  try {
    localStorage.setItem(CLAVE_ALMACENAMIENTO, sucursalId);
  } catch {
    // Si no se puede guardar, la elección vale solo para esta visita.
  }
}

export function ProveedorSucursalActiva({
  sucursales,
  children,
}: {
  sucursales: readonly SucursalResumen[];
  children: ReactNode;
}) {
  const [elegida, setElegida] = useState<string | null>(leerGuardada);

  const activa = useMemo(() => {
    // La guardada puede haber dejado de estar disponible: el dueño le quitó la
    // sucursal al usuario, o la desactivó. En ese caso caemos a la primera.
    const guardada = sucursales.find((sucursal) => sucursal.id === elegida);
    return guardada ?? sucursales[0] ?? null;
  }, [sucursales, elegida]);

  // Si lo que terminamos usando no es lo que estaba guardado, lo sincronizamos.
  useEffect(() => {
    if (activa && activa.id !== elegida) {
      setElegida(activa.id);
      guardar(activa.id);
    }
  }, [activa, elegida]);

  const cambiar = useCallback((sucursalId: string) => {
    setElegida(sucursalId);
    guardar(sucursalId);
  }, []);

  const valor = useMemo<ValorContexto>(
    () => ({ sucursales, activa, cambiar }),
    [sucursales, activa, cambiar],
  );

  return <Contexto.Provider value={valor}>{children}</Contexto.Provider>;
}

export function useSucursalActiva(): ValorContexto {
  const valor = useContext(Contexto);
  if (!valor) {
    throw new Error('useSucursalActiva se usó fuera de ProveedorSucursalActiva');
  }
  return valor;
}
