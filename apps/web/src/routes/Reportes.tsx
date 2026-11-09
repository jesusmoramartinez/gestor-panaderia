import {
  aDecimal,
  diaEnArgentina,
  ETIQUETA_MEDIO_PAGO,
  formatearCantidad,
  formatearDia,
  formatearDinero,
  formatearFechaArgentina,
  type LoQueMeDeben,
  MEDIOS_PAGO,
  type Reportes as DatosReportes,
} from '@panaderia/shared';
import { useQuery } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router';

import {
  Campo,
  CLASE_BOTON_PRIMARIO,
  CLASE_BOTON_SECUNDARIO,
  CLASE_CONTROL,
  MensajeError,
} from '../components/formulario';
import { GraficoBarras, GraficoLinea } from '../components/Graficos';
import { obtenerLoQueMeDeben } from '../lib/acopio';
import { type Celda, descargarCsv, numeroCsv } from '../lib/csv';
import { obtenerReportes } from '../lib/reportes';

/**
 * REPORTES (Fase 12d): "todo reporte que se pueda hacer de los datos" (C-26).
 *
 * Los tres primeros son una foto de HOY ("Lo que me deben"); el resto, de un
 * período. Cada uno tiene su gráfico (SVG a mano), su tabla, y se puede bajar
 * en CSV o imprimir. El reporte elegido y el período van en la URL: imprimir,
 * recargar o mandar el link deja todo igual.
 */
const REPORTES = [
  { id: 'me-deben', titulo: 'Mercadería pendiente de entrega', deHoy: true },
  { id: 'adelantado', titulo: 'Plata adelantada y a favor', deHoy: true },
  { id: 'abiertas', titulo: 'Compras abiertas por antigüedad', deHoy: true },
  { id: 'gasto-mes', titulo: 'Gasto por mes', deHoy: false },
  { id: 'gasto-proveedor', titulo: 'Gasto por proveedor', deHoy: false },
  { id: 'gasto-insumo', titulo: 'Gasto por insumo', deHoy: false },
  { id: 'pagos-medio', titulo: 'Pagos por medio', deHoy: false },
  { id: 'precio', titulo: 'Evolución del precio de un insumo', deHoy: false },
  { id: 'comparacion', titulo: 'Comparar proveedores por insumo', deHoy: false },
  { id: 'cumplimiento', titulo: 'Cumplimiento de los proveedores', deHoy: false },
  { id: 'entregas', titulo: 'Entregas por semana', deHoy: false },
] as const;
type IdReporte = (typeof REPORTES)[number]['id'];

const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
/** '2026-11' → 'nov 2026'. */
function formatearMes(mes: string): string {
  const [anio, numero] = mes.split('-');
  return `${MESES[Number(numero) - 1] ?? ''} ${anio ?? ''}`;
}

/** "+12 %" contra el mes anterior; "—" si el anterior fue cero (no hay contra qué). */
function variacion(actual: string, anterior: string | undefined): string {
  if (anterior === undefined || aDecimal(anterior).isZero()) return '—';
  const porcentaje = aDecimal(actual).minus(anterior).dividedBy(anterior).times(100);
  return `${porcentaje.greaterThanOrEqualTo(0) ? '+' : ''}${porcentaje.toFixed(0)} %`;
}

/** Para DIBUJAR una barra (nunca para calcular plata). */
const aNumero = (valor: string): number => Number(valor);

/** El primer día del mes, `meses` meses atrás. */
function haceMeses(hoy: string, meses: number): string {
  const [anio, mes] = hoy.split('-').map(Number) as [number, number];
  const total = anio * 12 + (mes - 1) - meses;
  return `${String(Math.floor(total / 12))}-${String((total % 12) + 1).padStart(2, '0')}-01`;
}

export function Reportes() {
  const [parametros, setParametros] = useSearchParams();
  const hoy = diaEnArgentina(new Date());
  const ver: IdReporte = REPORTES.find((r) => r.id === parametros.get('ver'))?.id ?? 'gasto-mes';
  const desde = parametros.get('desde') ?? haceMeses(hoy, 11);
  const hasta = parametros.get('hasta') ?? hoy;
  const reporte = REPORTES.find((r) => r.id === ver) ?? REPORTES[3];

  function cambiar(cambios: Record<string, string>): void {
    const siguientes = new URLSearchParams(parametros);
    for (const [clave, valor] of Object.entries(cambios)) siguientes.set(clave, valor);
    setParametros(siguientes, { replace: true });
  }

  const delPeriodo = useQuery({
    queryKey: ['reportes', desde, hasta],
    queryFn: () => obtenerReportes(desde, hasta),
    enabled: !reporte.deHoy && desde <= hasta,
  });
  const deHoy = useQuery({
    queryKey: ['me-deben'],
    queryFn: obtenerLoQueMeDeben,
    enabled: reporte.deHoy,
  });

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-50">Reportes</h1>

      <section className="space-y-3 rounded-2xl bg-white p-4 shadow-sm print:hidden dark:bg-slate-900">
        <Campo etiqueta="Qué reporte">
          {/* Controlado: el valor sale de la URL (regla del proyecto). */}
          <select
            value={ver}
            onChange={(evento) => {
              cambiar({ ver: evento.target.value });
            }}
            className={CLASE_CONTROL}
          >
            {REPORTES.map((opcion) => (
              <option key={opcion.id} value={opcion.id}>
                {opcion.titulo}
              </option>
            ))}
          </select>
        </Campo>
        {!reporte.deHoy && (
          <>
            <div className="grid grid-cols-2 gap-3">
              <Campo etiqueta="Desde">
                <input
                  type="date"
                  value={desde}
                  max={hasta}
                  onChange={(evento) => {
                    if (evento.target.value !== '') cambiar({ desde: evento.target.value });
                  }}
                  className={CLASE_CONTROL}
                />
              </Campo>
              <Campo etiqueta="Hasta">
                <input
                  type="date"
                  value={hasta}
                  min={desde}
                  max={hoy}
                  onChange={(evento) => {
                    if (evento.target.value !== '') cambiar({ hasta: evento.target.value });
                  }}
                  className={CLASE_CONTROL}
                />
              </Campo>
            </div>
            <div className="flex flex-wrap gap-2">
              {(
                [
                  ['Este mes', 0],
                  ['3 meses', 2],
                  ['12 meses', 11],
                ] as const
              ).map(([texto, meses]) => (
                <button
                  key={texto}
                  type="button"
                  onClick={() => {
                    cambiar({ desde: haceMeses(hoy, meses), hasta: hoy });
                  }}
                  className="min-h-11 rounded-full border border-slate-300 px-4 text-sm font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800"
                >
                  {texto}
                </button>
              ))}
            </div>
          </>
        )}
      </section>

      {reporte.deHoy ? (
        deHoy.isError ? (
          <MensajeError>{deHoy.error.message}</MensajeError>
        ) : deHoy.data === undefined ? (
          <Cargando />
        ) : (
          <ReporteDeHoy id={ver} datos={deHoy.data} titulo={reporte.titulo} />
        )
      ) : delPeriodo.isError ? (
        <MensajeError>{delPeriodo.error.message}</MensajeError>
      ) : delPeriodo.data === undefined ? (
        <Cargando />
      ) : (
        <ReporteDelPeriodo
          id={ver}
          datos={delPeriodo.data}
          titulo={reporte.titulo}
          insumoElegido={parametros.get('insumo')}
          onElegirInsumo={(insumo) => {
            cambiar({ insumo });
          }}
        />
      )}
    </div>
  );
}

function Cargando() {
  return <p className="text-sm text-slate-600 dark:text-slate-400">Calculando...</p>;
}

type Csv = { nombre: string; columnas: string[]; filas: Celda[][] };

/** El marco de cada reporte: título, período, botones de CSV e imprimir. */
function Marco({
  titulo,
  subtitulo,
  csv,
  vacio,
  children,
}: {
  titulo: string;
  subtitulo: string;
  csv: Csv;
  vacio: boolean;
  children: ReactNode;
}) {
  return (
    <section className="space-y-4 rounded-2xl bg-white p-4 shadow-sm sm:p-5 dark:bg-slate-900 print:shadow-none">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold text-slate-900 dark:text-slate-50">{titulo}</h2>
          <p className="text-sm text-slate-600 dark:text-slate-400">{subtitulo}</p>
        </div>
        {!vacio && (
          <div className="flex flex-wrap gap-2 print:hidden">
            <button
              type="button"
              onClick={() => {
                descargarCsv(csv.nombre, csv.columnas, csv.filas);
              }}
              className={CLASE_BOTON_PRIMARIO}
            >
              Descargar CSV
            </button>
            <button
              type="button"
              onClick={() => {
                window.print();
              }}
              className={CLASE_BOTON_SECUNDARIO}
            >
              Imprimir
            </button>
          </div>
        )}
      </div>
      {vacio ? (
        <p className="text-sm text-slate-600 dark:text-slate-400">
          No hay datos para mostrar en este período.
        </p>
      ) : (
        children
      )}
    </section>
  );
}

/** Una tabla simple: las columnas numéricas, a la derecha. */
function Tabla({
  columnas,
  filas,
  numericas = [],
}: {
  columnas: readonly string[];
  filas: readonly (readonly ReactNode[])[];
  numericas?: readonly number[];
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-slate-200 text-left text-slate-600 dark:border-slate-700 dark:text-slate-400">
            {columnas.map((columna, i) => (
              <th
                key={columna}
                className={`px-2 py-2 font-medium ${numericas.includes(i) ? 'text-right' : ''}`}
              >
                {columna}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {filas.map((fila, f) => (
            <tr key={f} className="border-b border-slate-100 dark:border-slate-800">
              {fila.map((valor, i) => (
                <td
                  key={i}
                  className={`px-2 py-2 ${numericas.includes(i) ? 'text-right tabular-nums' : ''}`}
                >
                  {valor}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ===========================================================================
// Los tres de hoy (salen de "Lo que me deben")
// ===========================================================================

function ReporteDeHoy({
  id,
  datos,
  titulo,
}: {
  id: IdReporte;
  datos: LoQueMeDeben;
  titulo: string;
}) {
  const subtitulo = `Al día de hoy, ${formatearFechaArgentina(new Date())}`;

  if (id === 'me-deben') {
    const renglones = datos.proveedores.flatMap((deuda) =>
      deuda.renglones.map((renglon) => ({ proveedor: deuda.proveedor.nombre, ...renglon })),
    );
    const cantidad = (r: (typeof renglones)[number]) =>
      r.presentacion === null
        ? `${formatearCantidad(r.pendiente)} ${r.insumo.unidadBaseCodigo}`
        : `${formatearCantidad(r.pendiente)} × ${r.presentacion.nombre}`;
    return (
      <Marco
        titulo={titulo}
        subtitulo={subtitulo}
        vacio={renglones.length === 0}
        csv={{
          nombre: 'mercaderia-que-me-deben',
          columnas: [
            'Proveedor',
            'Compra',
            'Insumo',
            'Falta',
            'Unidad',
            'Falta en unidad base',
            'Valor',
          ],
          filas: renglones.map((r) => [
            r.proveedor,
            r.ordenNumero,
            r.insumo.nombre,
            numeroCsv(r.pendiente),
            r.presentacion?.nombre ?? r.insumo.unidadBaseCodigo,
            numeroCsv(r.pendienteBase),
            numeroCsv(r.valorPendiente),
          ]),
        }}
      >
        <GraficoBarras
          titulo="Pendiente de entrega por proveedor"
          etiquetas={datos.proveedores.map((d) => d.proveedor.nombre)}
          series={[
            {
              nombre: 'Pendiente',
              color: 'fill-corteza dark:fill-corteza-claro',
              valores: datos.proveedores.map((d) => aNumero(d.valorPendiente)),
              textos: datos.proveedores.map((d) => formatearDinero(d.valorPendiente)),
            },
          ]}
        />
        <Tabla
          columnas={['Proveedor', 'Compra', 'Insumo', 'Falta', 'Valor']}
          numericas={[3, 4]}
          filas={renglones.map((r) => [
            r.proveedor,
            <Link key="c" to={`/compras/${r.ordenId}`} className="underline">
              {r.ordenNumero}
            </Link>,
            r.insumo.nombre,
            cantidad(r),
            r.valorPendiente === null ? 'sin precio' : formatearDinero(r.valorPendiente),
          ])}
        />
        <p className="text-right font-bold">Total: {formatearDinero(datos.valorPendiente)}</p>
      </Marco>
    );
  }

  if (id === 'adelantado') {
    const filas = [
      ...datos.proveedores
        .filter((d) => aDecimal(d.adelantadoSinEntregar).greaterThan(0))
        .map((d) => ({
          proveedor: d.proveedor.nombre,
          que: 'Pagado, falta entregar',
          monto: d.adelantadoSinEntregar,
        })),
      ...datos.aFavor.map((a) => ({
        proveedor: a.proveedor.nombre,
        que: `A favor (compra ${String(a.numero)} ${a.estado === 'CANCELADA' ? 'cancelada' : 'cerrada'})`,
        monto: a.monto,
      })),
    ];
    return (
      <Marco
        titulo={titulo}
        subtitulo={subtitulo}
        vacio={filas.length === 0}
        csv={{
          nombre: 'plata-adelantada',
          columnas: ['Proveedor', 'Qué es', 'Monto'],
          filas: filas.map((f) => [f.proveedor, f.que, numeroCsv(f.monto)]),
        }}
      >
        <GraficoBarras
          titulo="Plata tuya en cada proveedor"
          etiquetas={filas.map((f) => `${f.proveedor} · ${f.que}`)}
          series={[
            {
              nombre: 'Monto',
              color: 'fill-sky-600 dark:fill-sky-400',
              valores: filas.map((f) => aNumero(f.monto)),
              textos: filas.map((f) => formatearDinero(f.monto)),
            },
          ]}
        />
        <p className="text-right font-bold">
          Total: {formatearDinero(datos.adelantadoSinEntregar)}
        </p>
      </Marco>
    );
  }

  // Compras abiertas por antigüedad.
  return (
    <Marco
      titulo={titulo}
      subtitulo={subtitulo}
      vacio={datos.comprasAbiertas.length === 0}
      csv={{
        nombre: 'compras-abiertas',
        columnas: ['Compra', 'Proveedor', 'Sucursal', 'Pedida', 'Días', 'Total', 'Llegó', 'Falta'],
        filas: datos.comprasAbiertas.map((c) => [
          c.numero,
          c.proveedor.nombre,
          c.sucursal.nombre,
          c.pedidaAt === null ? '' : formatearFechaArgentina(new Date(c.pedidaAt)),
          c.diasAbierta,
          numeroCsv(c.total),
          numeroCsv(c.valorRecibido),
          numeroCsv(c.valorPendiente),
        ]),
      }}
    >
      <Tabla
        columnas={['Compra', 'Proveedor', 'Hace', 'Falta']}
        numericas={[2, 3]}
        filas={datos.comprasAbiertas.map((c) => [
          <Link key="c" to={`/compras/${c.id}`} className="underline">
            {c.numero}
          </Link>,
          c.proveedor.nombre,
          `${String(c.diasAbierta)} días`,
          formatearDinero(c.valorPendiente),
        ])}
      />
    </Marco>
  );
}

// ===========================================================================
// Los del período
// ===========================================================================

function ReporteDelPeriodo({
  id,
  datos,
  titulo,
  insumoElegido,
  onElegirInsumo,
}: {
  id: IdReporte;
  datos: DatosReportes;
  titulo: string;
  insumoElegido: string | null;
  onElegirInsumo: (insumoId: string) => void;
}) {
  const subtitulo = `Del ${formatearDia(datos.desde)} al ${formatearDia(datos.hasta)}`;

  if (id === 'gasto-mes') {
    // Desde el primer mes con datos: con un cliente nuevo, los 12 meses por
    // defecto eran casi todos "$ 0" (lo mostró la captura del celular). Los
    // meses vacíos DEL MEDIO sí se muestran: dicen algo.
    const primero = datos.gastoPorMes.findIndex((f) => f.comprado !== '0' || f.pagado !== '0');
    const filas = primero === -1 ? [] : datos.gastoPorMes.slice(primero);
    return (
      <Marco
        titulo={titulo}
        subtitulo={subtitulo}
        vacio={filas.length === 0}
        csv={{
          nombre: `gasto-por-mes-${datos.desde}-${datos.hasta}`,
          columnas: ['Mes', 'Comprado', 'Pagado'],
          filas: filas.map((f) => [f.mes, numeroCsv(f.comprado), numeroCsv(f.pagado)]),
        }}
      >
        <GraficoBarras
          titulo="Comprado y pagado por mes"
          etiquetas={filas.map((f) => formatearMes(f.mes))}
          series={[
            {
              nombre: 'Comprado',
              color: 'fill-corteza dark:fill-corteza-claro',
              valores: filas.map((f) => aNumero(f.comprado)),
              textos: filas.map((f) => formatearDinero(f.comprado, 0)),
            },
            {
              nombre: 'Pagado',
              color: 'fill-emerald-600 dark:fill-emerald-400',
              valores: filas.map((f) => aNumero(f.pagado)),
              textos: filas.map((f) => formatearDinero(f.pagado, 0)),
            },
          ]}
        />
        <Tabla
          columnas={['Mes', 'Comprado', 'vs. mes anterior', 'Pagado']}
          numericas={[1, 2, 3]}
          filas={filas.map((f, i) => [
            formatearMes(f.mes),
            formatearDinero(f.comprado),
            variacion(f.comprado, filas[i - 1]?.comprado),
            formatearDinero(f.pagado),
          ])}
        />
      </Marco>
    );
  }

  if (id === 'gasto-proveedor') {
    const filas = datos.gastoPorProveedor;
    return (
      <Marco
        titulo={titulo}
        subtitulo={subtitulo}
        vacio={filas.length === 0}
        csv={{
          nombre: `gasto-por-proveedor-${datos.desde}-${datos.hasta}`,
          columnas: ['Proveedor', 'Compras', 'Comprado'],
          filas: filas.map((f) => [f.proveedor.nombre, f.compras, numeroCsv(f.comprado)]),
        }}
      >
        <GraficoBarras
          titulo="Lo comprado a cada proveedor"
          etiquetas={filas.map((f) => `${f.proveedor.nombre} (${String(f.compras)})`)}
          series={[
            {
              nombre: 'Comprado',
              color: 'fill-corteza dark:fill-corteza-claro',
              valores: filas.map((f) => aNumero(f.comprado)),
              textos: filas.map((f) => formatearDinero(f.comprado)),
            },
          ]}
        />
      </Marco>
    );
  }

  if (id === 'gasto-insumo') {
    const filas = datos.gastoPorInsumo;
    return (
      <Marco
        titulo={titulo}
        subtitulo={subtitulo}
        vacio={filas.length === 0}
        csv={{
          nombre: `gasto-por-insumo-${datos.desde}-${datos.hasta}`,
          columnas: ['Insumo', 'Cantidad', 'Unidad', 'Comprado'],
          filas: filas.map((f) => [
            f.insumo.nombre,
            numeroCsv(f.cantidadBase),
            f.unidad,
            numeroCsv(f.comprado),
          ]),
        }}
      >
        <GraficoBarras
          titulo="Lo comprado de cada insumo"
          etiquetas={filas.map(
            (f) => `${f.insumo.nombre} · ${formatearCantidad(f.cantidadBase)} ${f.unidad}`,
          )}
          series={[
            {
              nombre: 'Comprado',
              color: 'fill-corteza dark:fill-corteza-claro',
              valores: filas.map((f) => aNumero(f.comprado)),
              textos: filas.map((f) => formatearDinero(f.comprado)),
            },
          ]}
        />
      </Marco>
    );
  }

  if (id === 'pagos-medio') {
    const { totales, porMes } = datos.pagosPorMedio;
    return (
      <Marco
        titulo={titulo}
        subtitulo={subtitulo}
        vacio={totales.every((t) => t.pagos === 0)}
        csv={{
          nombre: `pagos-por-medio-${datos.desde}-${datos.hasta}`,
          columnas: ['Mes', ...MEDIOS_PAGO.map((m) => ETIQUETA_MEDIO_PAGO[m])],
          filas: porMes.map((f) => [f.mes, ...MEDIOS_PAGO.map((m) => numeroCsv(f[m]))]),
        }}
      >
        <GraficoBarras
          titulo="Cuánto se pagó con cada medio"
          etiquetas={totales.map(
            (t) => `${ETIQUETA_MEDIO_PAGO[t.medio]} (${String(t.pagos)} pagos)`,
          )}
          series={[
            {
              nombre: 'Pagado',
              color: 'fill-emerald-600 dark:fill-emerald-400',
              valores: totales.map((t) => aNumero(t.total)),
              textos: totales.map((t) => formatearDinero(t.total)),
            },
          ]}
        />
        <Tabla
          columnas={['Mes', ...MEDIOS_PAGO.map((m) => ETIQUETA_MEDIO_PAGO[m])]}
          numericas={[1, 2, 3]}
          filas={porMes.map((f) => [
            formatearMes(f.mes),
            ...MEDIOS_PAGO.map((m) => formatearDinero(f[m], 0)),
          ])}
        />
      </Marco>
    );
  }

  if (id === 'precio') {
    const insumos = datos.gastoPorInsumo.map((g) => g.insumo);
    const elegido = insumos.find((i) => i.id === insumoElegido) ?? insumos[0];
    const unidad = datos.gastoPorInsumo.find((g) => g.insumo.id === elegido?.id)?.unidad ?? '';
    const precios = datos.precios.filter((p) => p.insumoId === elegido?.id);
    return (
      <Marco
        titulo={titulo}
        subtitulo={subtitulo}
        vacio={insumos.length === 0}
        csv={{
          nombre: `precio-${elegido?.nombre ?? 'insumo'}-${datos.desde}-${datos.hasta}`,
          columnas: [
            'Fecha',
            'Compra',
            'Proveedor',
            'Presentación',
            'Precio',
            `Precio por ${unidad}`,
          ],
          filas: precios.map((p) => [
            formatearFechaArgentina(new Date(p.fecha)),
            p.compraNumero,
            p.proveedor.nombre,
            p.presentacion ?? unidad,
            numeroCsv(p.precioUnitario),
            numeroCsv(p.precioPorUnidadBase),
          ]),
        }}
      >
        <div className="print:hidden">
          <Campo etiqueta="Insumo">
            <select
              value={elegido?.id ?? ''}
              onChange={(evento) => {
                onElegirInsumo(evento.target.value);
              }}
              className={CLASE_CONTROL}
            >
              {insumos.map((insumo) => (
                <option key={insumo.id} value={insumo.id}>
                  {insumo.nombre}
                </option>
              ))}
            </select>
          </Campo>
        </div>
        <p className="text-sm text-slate-600 dark:text-slate-400">
          Precio por {unidad}: así se compara una bolsa de 25 kg con una de 50.
        </p>
        <GraficoLinea
          titulo={`Precio por ${unidad} de ${elegido?.nombre ?? ''}`}
          puntos={precios.map((p) => ({
            etiqueta: formatearDia(diaEnArgentina(new Date(p.fecha))),
            valor: aNumero(p.precioPorUnidadBase),
            texto: formatearDinero(p.precioPorUnidadBase),
          }))}
        />
        {/* Tres columnas: en el celular, cuatro no entraban (lo mostró la captura). */}
        <Tabla
          columnas={['Fecha', 'Proveedor', 'Precio']}
          numericas={[2]}
          filas={precios.map((p) => [
            formatearDia(diaEnArgentina(new Date(p.fecha))),
            p.proveedor.nombre,
            <span key="precio" className="block">
              <span className="block font-semibold">
                {formatearDinero(p.precioPorUnidadBase)}/{unidad}
              </span>
              <span className="block text-xs text-slate-600 dark:text-slate-400">
                {formatearDinero(p.precioUnitario)}
                {p.presentacion === null ? '' : ` la ${p.presentacion}`}
              </span>
            </span>,
          ])}
        />
      </Marco>
    );
  }

  if (id === 'comparacion') {
    return (
      <Marco
        titulo={titulo}
        subtitulo={subtitulo}
        vacio={datos.comparacion.length === 0}
        csv={{
          nombre: `comparacion-proveedores-${datos.desde}-${datos.hasta}`,
          columnas: [
            'Insumo',
            'Unidad',
            'Proveedor',
            'Compras',
            'Cantidad',
            'Promedio',
            'Mínimo',
            'Máximo',
            'Último',
            'Más barato',
          ],
          filas: datos.comparacion.flatMap((c) =>
            c.proveedores.map((p) => [
              c.insumo.nombre,
              c.unidad,
              p.proveedor.nombre,
              p.compras,
              numeroCsv(p.cantidadBase),
              numeroCsv(p.promedio),
              numeroCsv(p.minimo),
              numeroCsv(p.maximo),
              numeroCsv(p.ultimo),
              p.masBarato ? 'sí' : '',
            ]),
          ),
        }}
      >
        <p className="text-sm text-slate-600 dark:text-slate-400">
          Precio promedio por unidad, pesado por cuánto se compró a cada precio.
        </p>
        <ul className="space-y-4">
          {datos.comparacion.map((c) => (
            <li
              key={c.insumo.id}
              className="rounded-xl border border-slate-200 p-3 dark:border-slate-700"
            >
              <h3 className="font-semibold text-slate-900 dark:text-slate-50">{c.insumo.nombre}</h3>
              <ul className="mt-2 divide-y divide-slate-100 dark:divide-slate-800">
                {c.proveedores.map((p) => (
                  <li
                    key={p.proveedor.id}
                    className="flex flex-wrap items-baseline justify-between gap-2 py-2"
                  >
                    <span>
                      <span className="font-medium">{p.proveedor.nombre}</span>
                      {p.masBarato && (
                        <span className="ml-2 rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-semibold text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300">
                          más barato
                        </span>
                      )}
                      <span className="block text-xs text-slate-600 dark:text-slate-400">
                        {p.compras} {p.compras === 1 ? 'compra' : 'compras'} ·{' '}
                        {formatearCantidad(p.cantidadBase)} {c.unidad} · entre{' '}
                        {formatearDinero(p.minimo)} y {formatearDinero(p.maximo)} · último{' '}
                        {formatearDinero(p.ultimo)}
                      </span>
                    </span>
                    <span className="font-bold tabular-nums">
                      {formatearDinero(p.promedio)}/{c.unidad}
                    </span>
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      </Marco>
    );
  }

  if (id === 'cumplimiento') {
    return (
      <Marco
        titulo={titulo}
        subtitulo={subtitulo}
        vacio={datos.cumplimiento.length === 0}
        csv={{
          nombre: `cumplimiento-${datos.desde}-${datos.hasta}`,
          columnas: [
            'Proveedor',
            'Compras',
            'Completas',
            'Cerradas con faltante',
            'Abiertas',
            'Canceladas',
            'Días promedio',
            '% entregado',
          ],
          filas: datos.cumplimiento.map((c) => [
            c.proveedor.nombre,
            c.compras,
            c.completas,
            c.cerradasConFaltante,
            c.abiertas,
            c.canceladas,
            numeroCsv(c.diasPromedio),
            c.porcentajeEntregado,
          ]),
        }}
      >
        <GraficoBarras
          titulo="Qué parte de lo comprado ya entregó cada proveedor"
          etiquetas={datos.cumplimiento.map((c) => c.proveedor.nombre)}
          series={[
            {
              nombre: 'Entregado',
              color: 'fill-emerald-600 dark:fill-emerald-400',
              valores: datos.cumplimiento.map((c) => c.porcentajeEntregado ?? 0),
              textos: datos.cumplimiento.map((c) =>
                c.porcentajeEntregado === null
                  ? '—'
                  : `${String(c.porcentajeEntregado)} % entregado`,
              ),
            },
          ]}
        />
        <Tabla
          columnas={['Proveedor', 'Compras', 'Completas', 'Con faltante', 'Días hasta completar']}
          numericas={[1, 2, 3, 4]}
          filas={datos.cumplimiento.map((c) => [
            c.proveedor.nombre,
            c.compras,
            c.completas,
            c.cerradasConFaltante,
            c.diasPromedio === null ? '—' : `${formatearCantidad(String(c.diasPromedio))} días`,
          ])}
        />
      </Marco>
    );
  }

  // Entregas por semana.
  return (
    <Marco
      titulo={titulo}
      subtitulo={subtitulo}
      vacio={datos.entregasPorSemana.length === 0}
      csv={{
        nombre: `entregas-por-semana-${datos.desde}-${datos.hasta}`,
        columnas: [
          'Semana del',
          'Fecha',
          'Entrega',
          'Compra',
          'Proveedor',
          'Sucursal',
          'Insumo',
          'Cantidad',
          'Unidad',
          'Valor',
        ],
        filas: datos.entregasPorSemana.flatMap((s) =>
          s.renglones.map((r) => [
            s.semana,
            formatearFechaArgentina(new Date(r.fecha)),
            r.entregaNumero,
            r.compraNumero,
            r.proveedor.nombre,
            r.sucursal,
            r.insumo,
            numeroCsv(r.cantidad),
            r.presentacion ?? r.unidad,
            numeroCsv(r.valor),
          ]),
        ),
      }}
    >
      <ul className="space-y-4">
        {datos.entregasPorSemana.map((semana) => (
          <li key={semana.semana}>
            <h3 className="flex flex-wrap justify-between gap-2 font-semibold text-slate-900 dark:text-slate-50">
              <span>Semana del {formatearDia(semana.semana)}</span>
              <span className="tabular-nums">
                {semana.entregas} {semana.entregas === 1 ? 'entrega' : 'entregas'} ·{' '}
                {formatearDinero(semana.valor)}
              </span>
            </h3>
            <ul className="mt-1 divide-y divide-slate-100 text-sm dark:divide-slate-800">
              {semana.renglones.map((r, i) => (
                <li
                  key={`${r.recepcionId}-${String(i)}`}
                  className="flex flex-wrap justify-between gap-2 py-2"
                >
                  <span>
                    <Link to={`/recepciones/${r.recepcionId}`} className="font-medium underline">
                      {r.insumo}
                    </Link>{' '}
                    ·{' '}
                    {r.presentacion === null
                      ? `${formatearCantidad(r.cantidad)} ${r.unidad}`
                      : `${formatearCantidad(r.cantidad)} × ${r.presentacion}`}
                    <span className="block text-xs text-slate-600 dark:text-slate-400">
                      {formatearDia(diaEnArgentina(new Date(r.fecha)))} · {r.proveedor.nombre} ·{' '}
                      {r.sucursal}
                      {r.compraNumero === null ? '' : ` · compra ${String(r.compraNumero)}`}
                    </span>
                  </span>
                  <span className="tabular-nums">{formatearDinero(r.valor)}</span>
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ul>
    </Marco>
  );
}
