import type { ReactNode, SVGProps } from 'react';

/**
 * Los íconos del menú, dibujados a mano en SVG (sin librería: son pocos).
 *
 * Todos comparten la misma "grilla": un cuadrado de 24×24 y trazos de 1,75
 * con puntas redondeadas. Eso es lo que hace que se vean de la misma familia.
 * El color sale de `currentColor`, o sea del color del texto que los rodea:
 * el ícono de la pestaña activa se pinta solo, igual que su texto.
 *
 * `aria-hidden`: el ícono acompaña a un texto que ya dice lo mismo. Si el
 * lector de pantalla los leyera, diría todo dos veces.
 */
function Icono({ children, ...props }: SVGProps<SVGSVGElement> & { children: ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className="size-6 shrink-0"
      {...props}
    >
      {children}
    </svg>
  );
}

export const IconoInicio = () => (
  <Icono>
    <path d="M3 10.5 12 3l9 7.5" />
    <path d="M5 9v11a1 1 0 0 0 1 1h4v-6h4v6h4a1 1 0 0 0 1-1V9" />
  </Icono>
);

/** Un galpón con cajas: la mercadería pagada que espera en el proveedor. */
export const IconoAcopio = () => (
  <Icono>
    <path d="M3 21V8.5L12 4l9 4.5V21" />
    <path d="M7 21v-8h10v8" />
    <path d="M7 17h10" />
  </Icono>
);

export const IconoCompras = () => (
  <Icono>
    <path d="M2.5 3.5h2.6l2.4 11a1.5 1.5 0 0 0 1.5 1.2h8.4a1.5 1.5 0 0 0 1.5-1.1L20.5 7.5H5.9" />
    <circle cx="9.5" cy="20" r="1.25" />
    <circle cx="17" cy="20" r="1.25" />
  </Icono>
);

export const IconoProveedores = () => (
  <Icono>
    <path d="M2.5 5.5h10.5v10H2.5z" />
    <path d="M13 9h4l3.5 3.5v3H13" />
    <circle cx="6.5" cy="17.5" r="2" />
    <circle cx="17" cy="17.5" r="2" />
  </Icono>
);

/** Una bolsa atada, como la de harina. */
export const IconoInsumos = () => (
  <Icono>
    <path d="M9 3h6l-1.2 3c3 1.4 4.7 4.8 4.7 8.6A6.4 6.4 0 0 1 12.1 21h-.2a6.4 6.4 0 0 1-6.4-6.4c0-3.8 1.7-7.2 4.7-8.6z" />
    <path d="M10 6h4" />
  </Icono>
);

export const IconoReportes = () => (
  <Icono>
    <path d="M3.5 3.5v17h17" />
    <path d="M8 16.5v-4" />
    <path d="M12.5 16.5v-8" />
    <path d="M17 16.5v-6" />
  </Icono>
);

export const IconoCuenta = () => (
  <Icono>
    <circle cx="12" cy="8" r="4" />
    <path d="M4.5 21a7.5 7.5 0 0 1 15 0" />
  </Icono>
);

export const IconoSalir = () => (
  <Icono>
    <path d="M9.5 20.5h-4a2 2 0 0 1-2-2v-13a2 2 0 0 1 2-2h4" />
    <path d="m15.5 16.5 4.5-4.5-4.5-4.5" />
    <path d="M20 12H9.5" />
  </Icono>
);

/**
 * El logo provisorio: un pan redondo con tres cortes. Lleva sus propios
 * colores (no `currentColor`) porque es una marca, no un ícono de texto.
 */
export function LogoPan({ className = 'size-12' }: { className?: string }) {
  return (
    <svg viewBox="0 0 48 48" className={className} role="img" aria-label="Logo">
      {/* La base, más oscura: la parte que apoya en la bandeja. */}
      <path
        d="M4 33c0-12.5 9-21.5 20-21.5S44 20.5 44 33c0 2.8-2 4.5-4.6 4.5H8.6C6 37.5 4 35.8 4 33z"
        fill="#9c5c24"
      />
      {/* La corteza dorada de arriba. */}
      <path
        d="M6.5 31.5C6.5 21 14.5 13.5 24 13.5S41.5 21 41.5 31.5c0 1.9-1.3 3-3.2 3H9.7c-1.9 0-3.2-1.1-3.2-3z"
        fill="#d9964a"
      />
      {/* Un brillo arriba, para que se lea redondo. */}
      <path
        d="M14 20.5c2.6-2.6 6-4 10-4"
        stroke="#eab676"
        strokeWidth="2"
        strokeLinecap="round"
        fill="none"
      />
      {/* Los cortes del panadero, color miga. */}
      <path
        d="m14 24 4.5 6.5M21.5 21.5 26 29M29 23l4.5 6.5"
        stroke="#f8e7c6"
        strokeWidth="2.8"
        strokeLinecap="round"
        fill="none"
      />
    </svg>
  );
}
