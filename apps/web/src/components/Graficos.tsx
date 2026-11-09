/**
 * GRÁFICOS HECHOS A MANO, en SVG (Fase 12d, decisión C-29: sin librería).
 *
 * SVG es un formato de dibujo que el navegador entiende directo: rectángulos,
 * líneas y textos con coordenadas. Dos gráficos alcanzan para los reportes:
 *
 *   - BARRAS HORIZONTALES: el nombre a la izquierda, la barra, y el VALOR
 *     ESCRITO a la derecha. Horizontales y no verticales porque en el celular
 *     los nombres largos ("Distribuidora La Esquina") entran, y porque el
 *     número se lee sin tener que adivinarlo por la altura de la barra.
 *   - LÍNEA: para la evolución del precio, con el primero, el último, el más
 *     bajo y el más alto marcados con su valor.
 *
 * Los números se pasan a `number` SOLO para dibujar (el ancho de una barra);
 * los textos que se leen son los de la API, formateados. La plata nunca se
 * calcula con number (regla 2).
 */

export type SerieBarras = {
  nombre: string;
  /** Clases de Tailwind para el relleno (fill-...). */
  color: string;
  valores: readonly number[];
  textos: readonly string[];
};

/**
 * Cada fila: arriba el nombre y el valor escrito; abajo, la barra a todo el
 * ancho. Con dos series (comprado y pagado), dos barras finitas por fila.
 */
export function GraficoBarras({
  titulo,
  etiquetas,
  series,
}: {
  titulo: string;
  etiquetas: readonly string[];
  series: readonly SerieBarras[];
}) {
  const maximo = Math.max(1, ...series.flatMap((serie) => serie.valores));
  const grosor = series.length === 1 ? 10 : 7;
  const alto = series.length * (grosor + 3);

  return (
    <figure className="w-full">
      <figcaption className="sr-only">{titulo}</figcaption>
      {series.length > 1 && (
        <ul className="mb-3 flex flex-wrap gap-4 text-sm text-slate-700 dark:text-slate-300">
          {series.map((serie) => (
            <li key={serie.nombre} className="flex items-center gap-2">
              <svg width="12" height="12" aria-hidden="true">
                <rect width="12" height="12" rx="2" className={serie.color} />
              </svg>
              {serie.nombre}
            </li>
          ))}
        </ul>
      )}
      <ul className="space-y-3">
        {etiquetas.map((etiqueta, fila) => (
          <li key={`${etiqueta}-${String(fila)}`}>
            <div className="flex flex-wrap items-baseline justify-between gap-x-3 text-sm">
              <span className="min-w-0 truncate text-slate-700 dark:text-slate-300">
                {etiqueta}
              </span>
              <span className="flex gap-3 font-semibold text-slate-900 tabular-nums dark:text-slate-50">
                {series.map((serie) => (
                  <span key={serie.nombre}>{serie.textos[fila]}</span>
                ))}
              </span>
            </div>
            {/* Un lienzo de 100 de ancho que se estira al contenedor: el ancho
                de cada barra es directamente su porcentaje del máximo. */}
            <svg
              role="img"
              aria-label={`${etiqueta}: ${series.map((serie) => `${serie.nombre} ${serie.textos[fila] ?? ''}`).join(', ')}`}
              viewBox={`0 0 100 ${String(alto)}`}
              preserveAspectRatio="none"
              className="mt-1 w-full"
              style={{ height: `${String(alto)}px` }}
            >
              <rect
                width="100"
                height={alto}
                rx="2"
                className="fill-slate-100 dark:fill-slate-800"
              />
              {series.map((serie, indice) => {
                const valor = serie.valores[fila] ?? 0;
                return (
                  <rect
                    key={serie.nombre}
                    y={indice * (grosor + 3) + 1.5}
                    width={valor <= 0 ? 0 : Math.max(0.8, (valor / maximo) * 100)}
                    height={grosor}
                    rx="1.5"
                    className={serie.color}
                  />
                );
              })}
            </svg>
          </li>
        ))}
      </ul>
    </figure>
  );
}

export type PuntoLinea = { etiqueta: string; valor: number; texto: string };

/** La evolución de un valor (un precio) en el tiempo. */
export function GraficoLinea({
  titulo,
  puntos,
}: {
  titulo: string;
  puntos: readonly PuntoLinea[];
}) {
  if (puntos.length === 0) return null;
  const ancho = 320;
  const alto = 170;
  const margen = { izq: 12, der: 12, arriba: 26, abajo: 30 };
  const valores = puntos.map((punto) => punto.valor);
  const minimo = Math.min(...valores);
  const maximo = Math.max(...valores);
  const rango = maximo - minimo || 1;
  const x = (i: number) =>
    puntos.length === 1
      ? ancho / 2
      : margen.izq + (i / (puntos.length - 1)) * (ancho - margen.izq - margen.der);
  // Si todos los precios son iguales (o hay uno solo), la línea va por el medio.
  const y = (valor: number) =>
    maximo === minimo
      ? (margen.arriba + alto - margen.abajo) / 2
      : margen.arriba + (1 - (valor - minimo) / rango) * (alto - margen.arriba - margen.abajo);

  // Se escriben solo los valores que importan: el primero, el último, el
  // más bajo y el más alto. Todos juntos serían ilegibles en un celular.
  const indiceMin = valores.indexOf(minimo);
  const indiceMax = valores.indexOf(maximo);
  const conTexto = new Set([0, puntos.length - 1, indiceMin, indiceMax]);

  return (
    <figure className="w-full">
      <svg
        role="img"
        aria-label={`${titulo}: de ${puntos[0]?.texto ?? ''} a ${puntos.at(-1)?.texto ?? ''}`}
        viewBox={`0 0 ${String(ancho)} ${String(alto)}`}
        className="h-auto w-full"
      >
        <line
          x1={margen.izq}
          x2={ancho - margen.der}
          y1={alto - margen.abajo}
          y2={alto - margen.abajo}
          className="stroke-slate-300 dark:stroke-slate-600"
        />
        <polyline
          fill="none"
          strokeWidth="2.5"
          strokeLinejoin="round"
          className="stroke-corteza dark:stroke-corteza-claro"
          points={puntos.map((punto, i) => `${String(x(i))},${String(y(punto.valor))}`).join(' ')}
        />
        {puntos.map((punto, i) => (
          <g key={`${punto.etiqueta}-${String(i)}`}>
            <circle
              cx={x(i)}
              cy={y(punto.valor)}
              r="4"
              className="fill-white stroke-corteza dark:fill-slate-900 dark:stroke-corteza-claro"
              strokeWidth="2"
            />
            {conTexto.has(i) && (
              <text
                x={x(i)}
                y={y(punto.valor) - 9}
                textAnchor={i === 0 ? 'start' : i === puntos.length - 1 ? 'end' : 'middle'}
                className="fill-slate-900 text-[11px] font-semibold dark:fill-slate-50"
              >
                {punto.texto}
              </text>
            )}
          </g>
        ))}
        <text
          x={margen.izq}
          y={alto - 10}
          className="fill-slate-600 text-[10px] dark:fill-slate-400"
        >
          {puntos[0]?.etiqueta}
        </text>
        {puntos.length > 1 && (
          <text
            x={ancho - margen.der}
            y={alto - 10}
            textAnchor="end"
            className="fill-slate-600 text-[10px] dark:fill-slate-400"
          >
            {puntos.at(-1)?.etiqueta}
          </text>
        )}
      </svg>
    </figure>
  );
}
