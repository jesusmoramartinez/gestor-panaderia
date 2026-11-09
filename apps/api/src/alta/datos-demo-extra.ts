/**
 * MÁS DATOS DE EJEMPLO, encima de los de datos-demo.ts.
 *
 * Para que en la demo "se marque todo lo posible": el inicio con stock en los
 * tres estados (ok, bajo, sin stock), un acopio con varias compras
 * pendientes, consumos de varias semanas, mermas, "se terminó", un ajuste por
 * conteo, una entrega sin compra cargada y plantillas de pedido. Y muchos
 * insumos con su ícono, para que la barra de categorías tenga de todo.
 *
 * Igual que la base: todo pasa por los SERVICIOS de verdad (reglas, candados
 * y auditoría) y después solo se corren las fechas de las compras hacia atrás.
 *
 * Protecciones:
 *   - solo corre si la empresa YA tiene los datos de ejemplo base (el
 *     proveedor "Molino Santa Rosa (ejemplo)"), y una sola vez;
 *   - los consumos no son cantidades fijas: se calculan para LLEGAR a un
 *     saldo, partiendo del que haya. Si alguien ya descontó algo probando la
 *     demo, la carga igual cierra (y nunca deja un saldo negativo);
 *   - todo lleva "Ejemplo" en sus notas o "(ejemplo)" en su nombre.
 */
import {
  aDecimal,
  ActualizarInsumoSchema,
  AgotarStockSchema,
  AjustarStockSchema,
  CargarConsumoSchema,
  CargarMermaSchema,
  CrearInsumoSchema,
  CrearOrdenSchema,
  CrearPresentacionSchema,
  CrearProveedorInsumoSchema,
  CrearProveedorSchema,
  GuardarPlantillaSchema,
  type MedioPago,
  ParametrosSucursalSchema,
  permisosDe,
  RecepcionDeOrdenSchema,
  RecepcionDirectaSchema,
  RegistrarPagoSchema,
} from '@panaderia/shared';
import { randomUUID } from 'node:crypto';

import type { Contexto } from '../lib/contexto.js';
import { prisma } from '../lib/db.js';
import { agregarNota } from '../modules/acopio/historial.js';
import * as compras from '../modules/compras/service.js';
import * as insumos from '../modules/insumos/service.js';
import * as movimientos from '../modules/movimientos/service.js';
import { registrarPago } from '../modules/pagos/service.js';
import * as plantillas from '../modules/plantillas/service.js';
import * as proveedores from '../modules/proveedores/service.js';
import { DatosDemoError } from './datos-demo.js';

/** Un día de hace `dias` días, a la hora de Argentina indicada. */
function haceDias(dias: number, hora = 12): Date {
  const fecha = new Date();
  fecha.setUTCDate(fecha.getUTCDate() - dias);
  fecha.setUTCHours(hora + 3, 0, 0, 0);
  return fecha;
}

type Imagenes = { transferencia?: string; mercadoPago?: string; remito?: string };

/** [nombre de la presentación, cuántas unidades base trae]. */
type Pres = readonly [string, string];
type DefInsumo = {
  nombre: string;
  icono: string;
  cat: string;
  u: string;
  pres: readonly Pres[];
};

/** Los insumos nuevos: un poco de cada categoría. */
const NUEVOS: readonly DefInsumo[] = [
  // Lácteos
  { nombre: 'Leche entera', icono: '🥛', cat: 'Lácteos', u: 'l', pres: [['Caja 12 l', '12']] },
  { nombre: 'Crema de leche', icono: '🍦', cat: 'Lácteos', u: 'l', pres: [['Caja 12 l', '12']] },
  { nombre: 'Manteca', icono: '🧈', cat: 'Lácteos', u: 'kg', pres: [['Caja 10 kg', '10']] },
  { nombre: 'Queso crema', icono: '🧀', cat: 'Lácteos', u: 'kg', pres: [['Pote 3,6 kg', '3.6']] },
  // Dulces, chocolates y frutas
  {
    nombre: 'Chocolate cobertura semiamargo',
    icono: '🍫',
    cat: 'Chocolates y cacao',
    u: 'kg',
    pres: [['Caja 5 kg', '5']],
  },
  {
    nombre: 'Cacao amargo',
    icono: '🍫',
    cat: 'Chocolates y cacao',
    u: 'kg',
    pres: [['Bolsa 5 kg', '5']],
  },
  {
    nombre: 'Dulce de membrillo',
    icono: '🍯',
    cat: 'Rellenos y coberturas',
    u: 'kg',
    pres: [['Caja 5 kg', '5']],
  },
  {
    nombre: 'Dulce de batata',
    icono: '🍠',
    cat: 'Rellenos y coberturas',
    u: 'kg',
    pres: [['Caja 5 kg', '5']],
  },
  {
    nombre: 'Grana de colores',
    icono: '✨',
    cat: 'Rellenos y coberturas',
    u: 'kg',
    pres: [['Bolsa 1 kg', '1']],
  },
  {
    nombre: 'Esencia de vainilla',
    icono: '🧪',
    cat: 'Esencias y aditivos',
    u: 'l',
    pres: [['Botella 1 l', '1']],
  },
  {
    nombre: 'Frutas abrillantadas',
    icono: '🍒',
    cat: 'Frutas y abrillantados',
    u: 'kg',
    pres: [['Caja 5 kg', '5']],
  },
  {
    nombre: 'Pasas de uva',
    icono: '🍇',
    cat: 'Frutas y abrillantados',
    u: 'kg',
    pres: [['Caja 10 kg', '10']],
  },
  // Almacén
  {
    nombre: 'Sal fina',
    icono: '🧂',
    cat: 'Sal y condimentos',
    u: 'kg',
    pres: [['Bolsa 25 kg', '25']],
  },
  {
    nombre: 'Aceite de girasol',
    icono: '🌻',
    cat: 'Grasas y aceites',
    u: 'l',
    pres: [['Bidón 5 l', '5']],
  },
  {
    nombre: 'Azúcar impalpable',
    icono: '🍬',
    cat: 'Azúcares',
    u: 'kg',
    pres: [['Bolsa 10 kg', '10']],
  },
  {
    nombre: 'Polvo de hornear',
    icono: '🧪',
    cat: 'Levaduras y mejoradores',
    u: 'kg',
    pres: [['Bolsa 5 kg', '5']],
  },
  {
    nombre: 'Semillas de sésamo',
    icono: '🌱',
    cat: 'Semillas y frutos secos',
    u: 'kg',
    pres: [['Bolsa 5 kg', '5']],
  },
  {
    nombre: 'Nuez mariposa',
    icono: '🌰',
    cat: 'Semillas y frutos secos',
    u: 'kg',
    pres: [['Bolsa 1 kg', '1']],
  },
  // Fiambres y salsas (pizzas, sándwiches de miga)
  {
    nombre: 'Jamón cocido',
    icono: '🥓',
    cat: 'Fiambres y quesos',
    u: 'kg',
    pres: [['Pieza 4 kg', '4']],
  },
  {
    nombre: 'Queso de máquina',
    icono: '🧀',
    cat: 'Fiambres y quesos',
    u: 'kg',
    pres: [['Barra 3,5 kg', '3.5']],
  },
  {
    nombre: 'Muzzarella',
    icono: '🧀',
    cat: 'Fiambres y quesos',
    u: 'kg',
    pres: [['Horma 10 kg', '10']],
  },
  {
    nombre: 'Aceitunas verdes',
    icono: '🫒',
    cat: 'Verduras y salsas',
    u: 'kg',
    pres: [['Balde 5 kg', '5']],
  },
  {
    nombre: 'Puré de tomate',
    icono: '🍅',
    cat: 'Verduras y salsas',
    u: 'kg',
    pres: [['Caja 12 bricks', '6.24']],
  },
  // Envases y limpieza
  {
    nombre: 'Bolsa de papel kraft',
    icono: '🛍️',
    cat: 'Envases y descartables',
    u: 'u',
    pres: [['Paquete 500 u', '500']],
  },
  {
    nombre: 'Caja para torta',
    icono: '📦',
    cat: 'Envases y descartables',
    u: 'u',
    pres: [['Paquete 50 u', '50']],
  },
  {
    nombre: 'Bandeja de cartón',
    icono: '🥡',
    cat: 'Envases y descartables',
    u: 'u',
    pres: [['Paquete 100 u', '100']],
  },
  {
    nombre: 'Pirotines',
    icono: '🥡',
    cat: 'Envases y descartables',
    u: 'u',
    pres: [['Paquete 1000 u', '1000']],
  },
  {
    nombre: 'Guantes descartables',
    icono: '🧤',
    cat: 'Envases y descartables',
    u: 'u',
    pres: [['Caja 100 u', '100']],
  },
  { nombre: 'Lavandina', icono: '🧴', cat: 'Limpieza', u: 'l', pres: [['Bidón 5 l', '5']] },
  { nombre: 'Detergente', icono: '🧴', cat: 'Limpieza', u: 'l', pres: [['Bidón 5 l', '5']] },
];

export async function cargarDatosDemoExtra(
  empresaId: string,
  imagenes: Imagenes = {},
): Promise<{ insumos: number; compras: number; movimientos: number }> {
  const empresa = await prisma.empresa.findUnique({
    where: { id: empresaId },
    select: {
      sucursales: { select: { id: true, codigo: true, esCentral: true } },
      usuarios: { where: { rol: 'DUENO', activo: true }, select: { id: true }, take: 1 },
      unidades: { select: { id: true, codigo: true } },
      categorias: { select: { id: true, nombre: true } },
      motivos: { select: { id: true, nombre: true, tipoAplicable: true } },
      proveedores: { select: { id: true, nombre: true } },
      insumos: {
        select: { id: true, nombre: true, presentaciones: { select: { id: true, nombre: true } } },
      },
    },
  });
  if (!empresa) throw new DatosDemoError('Esa empresa no existe.');

  const proveedorId = (nombre: string): string => {
    const encontrado = empresa.proveedores.find((p) => p.nombre === nombre);
    if (!encontrado) {
      throw new DatosDemoError(
        `Falta el proveedor "${nombre}": estos datos van ENCIMA de los de ejemplo base (datos-demo-cli).`,
      );
    }
    return encontrado.id;
  };
  const molino = proveedorId('Molino Santa Rosa (ejemplo)');
  const trebol = proveedorId('Distribuidora El Trébol (ejemplo)');
  const mayorista = proveedorId('Mayorista Central (ejemplo)');
  if (empresa.proveedores.some((p) => p.nombre === 'Lácteos del Sur (ejemplo)')) {
    throw new DatosDemoError('Los datos de ejemplo extra ya están cargados en esta empresa.');
  }

  const dueno = empresa.usuarios[0];
  if (!dueno) throw new DatosDemoError('La empresa no tiene un dueño activo.');
  const central = empresa.sucursales.find((s) => s.esCentral) ?? empresa.sucursales[0];
  const otra = empresa.sucursales.find((s) => s.id !== central?.id) ?? central;
  if (!central || !otra) throw new DatosDemoError('La empresa no tiene sucursales.');

  const ctx: Contexto = {
    usuarioId: dueno.id,
    empresaId,
    rol: 'DUENO',
    permisos: permisosDe('DUENO'),
    sucursalesPermitidas: empresa.sucursales.map((s) => s.id),
    sesionId: randomUUID(),
    ip: 'datos-de-ejemplo',
  };

  const unidad = (codigo: string): string => {
    const encontrada = empresa.unidades.find((u) => u.codigo === codigo);
    if (!encontrada) throw new DatosDemoError(`Falta la unidad ${codigo}.`);
    return encontrada.id;
  };
  const categoria = (nombre: string) =>
    empresa.categorias.find((c) => c.nombre === nombre)?.id ?? null;
  const motivo = (nombre: string, tipo: 'MERMA' | 'AJUSTE'): string => {
    const encontrado = empresa.motivos.find((m) => m.nombre === nombre && m.tipoAplicable === tipo);
    if (!encontrado) throw new DatosDemoError(`Falta el motivo "${nombre}".`);
    return encontrado.id;
  };

  // --- Insumos: los de la base (ya existen) y los nuevos ---------------------
  /** nombre del insumo → { id, presentaciones por nombre } */
  const porNombre = new Map<string, { id: string; pres: Map<string, string> }>();
  for (const fila of empresa.insumos) {
    porNombre.set(fila.nombre, {
      id: fila.id,
      pres: new Map(fila.presentaciones.map((p) => [p.nombre, p.id])),
    });
  }
  const insumoId = (nombre: string): string => {
    const encontrado = porNombre.get(nombre);
    if (!encontrado) throw new DatosDemoError(`Falta el insumo "${nombre}".`);
    return encontrado.id;
  };
  const de = (nombre: string, presentacion: string) => {
    const presentacionId = porNombre.get(nombre)?.pres.get(presentacion);
    if (presentacionId === undefined) {
      throw new DatosDemoError(`Falta "${nombre}" en "${presentacion}".`);
    }
    return { insumoId: insumoId(nombre), presentacionId };
  };

  // Un ícono más preciso para uno de la base (los demás usan el de su categoría).
  await insumos.actualizar(
    ctx,
    insumoId('Grasa vacuna'),
    ActualizarInsumoSchema.parse({ icono: '🐄' }),
  );

  for (const def of NUEVOS) {
    if (porNombre.has(def.nombre)) continue; // ya lo cargó Marcelo: se respeta
    const creado = await insumos.crear(
      ctx,
      CrearInsumoSchema.parse({
        nombre: def.nombre,
        icono: def.icono,
        codigo: null,
        categoriaId: categoria(def.cat),
        unidadBaseId: unidad(def.u),
      }),
    );
    let detalle = creado;
    for (const [indice, [nombre, cantidadBase]] of def.pres.entries()) {
      detalle = await insumos.crearPresentacion(
        ctx,
        creado.id,
        CrearPresentacionSchema.parse({ nombre, cantidadBase, esDefault: indice === 0 }),
      );
    }
    porNombre.set(def.nombre, {
      id: creado.id,
      pres: new Map(detalle.presentaciones.map((p) => [p.nombre, p.id])),
    });
  }

  // --- Proveedores nuevos ------------------------------------------------------
  const proveedor = async (nombre: string, extra: Record<string, unknown>, vende: Pres[]) => {
    const creado = await proveedores.crear(
      ctx,
      CrearProveedorSchema.parse({ nombre, notas: 'Proveedor de ejemplo', ...extra }),
    );
    for (const [insumo, presentacion] of vende) {
      await proveedores.crearAsociacion(
        ctx,
        creado.id,
        CrearProveedorInsumoSchema.parse({ ...de(insumo, presentacion), esPreferido: false }),
      );
    }
    return creado.id;
  };
  const lacteos = await proveedor(
    'Lácteos del Sur (ejemplo)',
    { contactoNombre: 'Pedidos', diasEntrega: '2' },
    [
      ['Leche entera', 'Caja 12 l'],
      ['Crema de leche', 'Caja 12 l'],
      ['Manteca', 'Caja 10 kg'],
      ['Queso crema', 'Pote 3,6 kg'],
    ],
  );
  const dulceHogar = await proveedor(
    'Distribuidora Dulce Hogar (ejemplo)',
    { contactoNombre: 'Rubén', diasEntrega: '5' },
    [
      ['Chocolate cobertura semiamargo', 'Caja 5 kg'],
      ['Frutas abrillantadas', 'Caja 5 kg'],
      ['Pasas de uva', 'Caja 10 kg'],
      ['Dulce de membrillo', 'Caja 5 kg'],
    ],
  );
  const fiambreria = await proveedor('Fiambrería Don Pepe (ejemplo)', { diasEntrega: '1' }, [
    ['Jamón cocido', 'Pieza 4 kg'],
    ['Queso de máquina', 'Barra 3,5 kg'],
    ['Muzzarella', 'Horma 10 kg'],
  ]);
  const descartables = await proveedor('Descartables Oeste (ejemplo)', { diasEntrega: '3' }, [
    ['Bolsa de papel kraft', 'Paquete 500 u'],
    ['Caja para torta', 'Paquete 50 u'],
    ['Lavandina', 'Bidón 5 l'],
  ]);

  // --- Compras ------------------------------------------------------------------
  type Renglon = [insumo: string, presentacion: string, cantidad: string, precio: string];
  let cantidadCompras = 0;

  const comprar = async (
    dias: number,
    proveedorDeCompra: string,
    renglones: Renglon[],
    opciones: { sucursalId?: string; notas?: string } = {},
  ) => {
    const orden = await compras.crearOrden(
      ctx,
      CrearOrdenSchema.parse({
        sucursalId: opciones.sucursalId ?? central.id,
        proveedorId: proveedorDeCompra,
        pedir: true,
        notas: opciones.notas ?? 'Compra de ejemplo',
        lineas: renglones.map(([insumo, presentacion, cantidad, precioUnitario]) => ({
          ...de(insumo, presentacion),
          cantidad,
          precioUnitario,
        })),
      }),
    );
    const fecha = haceDias(dias, 10);
    await prisma.ordenCompra.update({
      where: { id: orden.id },
      data: { createdAt: fecha, pedidaAt: fecha },
    });
    cantidadCompras += 1;
    return orden;
  };

  const pagar = async (
    ordenId: string,
    dias: number,
    monto: string,
    medio: MedioPago,
    imagen?: string,
  ) => {
    await registrarPago(
      ctx,
      ordenId,
      RegistrarPagoSchema.parse({
        fecha: haceDias(dias, 11).toISOString(),
        monto,
        medio,
        nota: null,
        comprobantes: imagen === undefined ? [] : [{ datos: imagen }],
      }),
    );
  };

  const entregar = async (
    orden: Awaited<ReturnType<typeof comprar>>,
    dias: number,
    sucursalId: string,
    llegaron: [insumo: string, cantidad: string][],
    remito?: string,
  ) => {
    await compras.recibirDeOrden(
      ctx,
      orden.id,
      RecepcionDeOrdenSchema.parse({
        fecha: haceDias(dias, 9).toISOString(),
        sucursalId,
        numeroRemito: remito ?? null,
        notas: null,
        comprobantes:
          remito !== undefined && imagenes.remito !== undefined ? [{ datos: imagenes.remito }] : [],
        lineas: llegaron.map(([insumo, cantidad]) => {
          const linea = orden.lineas.find((l) => l.insumo.nombre === insumo);
          return {
            lineaOrdenId: linea?.id,
            cantidad,
            precioUnitario: linea?.precioUnitario ?? '0',
          };
        }),
      }),
    );
  };

  // 1. Lácteos: pagada y entregada entera.
  const l1 = await comprar(60, lacteos, [
    ['Leche entera', 'Caja 12 l', '10', '12000'],
    ['Crema de leche', 'Caja 12 l', '4', '30000'],
    ['Manteca', 'Caja 10 kg', '5', '85000'],
    ['Queso crema', 'Pote 3,6 kg', '6', '15000'],
  ]);
  await pagar(l1.id, 60, '755000', 'TRANSFERENCIA', imagenes.transferencia);
  await entregar(
    l1,
    59,
    central.id,
    [
      ['Leche entera', '10'],
      ['Crema de leche', '4'],
      ['Manteca', '5'],
      ['Queso crema', '6'],
    ],
    '0007-00002210',
  );

  // 2. El acopio del pan dulce: pagado entero, se retira de a poco.
  const d1 = await comprar(
    45,
    dulceHogar,
    [
      ['Chocolate cobertura semiamargo', 'Caja 5 kg', '20', '60000'],
      ['Frutas abrillantadas', 'Caja 5 kg', '30', '40000'],
      ['Pasas de uva', 'Caja 10 kg', '10', '70000'],
      ['Dulce de membrillo', 'Caja 5 kg', '10', '18000'],
    ],
    { notas: 'Ejemplo: acopio para el pan dulce de fin de año' },
  );
  await pagar(d1.id, 45, '3280000', 'MERCADO_PAGO', imagenes.mercadoPago);
  await entregar(d1, 44, central.id, [
    ['Chocolate cobertura semiamargo', '5'],
    ['Dulce de membrillo', '10'],
  ]);
  await entregar(d1, 30, central.id, [['Frutas abrillantadas', '10']], '0012-00000877');
  await entregar(d1, 20, otra.id, [['Chocolate cobertura semiamargo', '5']]);
  await entregar(d1, 10, central.id, [['Frutas abrillantadas', '10']]);
  await agregarNota(ctx, d1.id, {
    texto: 'Ejemplo: las pasas y lo que falta de frutas las retiramos en diciembre',
  });

  // 3. Fiambrería: llegó todo, se pagó una parte (queda saldo).
  const f1 = await comprar(40, fiambreria, [
    ['Jamón cocido', 'Pieza 4 kg', '6', '32000'],
    ['Queso de máquina', 'Barra 3,5 kg', '6', '28000'],
    ['Muzzarella', 'Horma 10 kg', '3', '65000'],
  ]);
  await entregar(f1, 39, central.id, [
    ['Jamón cocido', '6'],
    ['Queso de máquina', '6'],
    ['Muzzarella', '3'],
  ]);
  await pagar(f1.id, 39, '200000', 'EFECTIVO');

  // 4. Descartables: sin pagar, llegó una parte.
  const e1 = await comprar(28, descartables, [
    ['Bolsa de papel kraft', 'Paquete 500 u', '10', '25000'],
    ['Caja para torta', 'Paquete 50 u', '6', '18000'],
    ['Lavandina', 'Bidón 5 l', '6', '4500'],
  ]);
  await entregar(e1, 27, central.id, [
    ['Bolsa de papel kraft', '6'],
    ['Caja para torta', '6'],
    ['Lavandina', '6'],
  ]);

  // 5. Almacén al Trébol (insumos nuevos): pagado, llegó todo en dos sucursales.
  const asociar = async (prov: string, vende: Pres[]) => {
    for (const [insumo, presentacion] of vende) {
      await proveedores.crearAsociacion(
        ctx,
        prov,
        CrearProveedorInsumoSchema.parse({ ...de(insumo, presentacion), esPreferido: false }),
      );
    }
  };
  await asociar(trebol, [
    ['Sal fina', 'Bolsa 25 kg'],
    ['Aceite de girasol', 'Bidón 5 l'],
    ['Azúcar impalpable', 'Bolsa 10 kg'],
  ]);
  const t1 = await comprar(21, trebol, [
    ['Sal fina', 'Bolsa 25 kg', '10', '9000'],
    ['Aceite de girasol', 'Bidón 5 l', '10', '14000'],
    ['Azúcar impalpable', 'Bolsa 10 kg', '5', '16000'],
    ['Polvo de hornear', 'Bolsa 5 kg', '4', '21000'],
    ['Semillas de sésamo', 'Bolsa 5 kg', '4', '24000'],
    ['Nuez mariposa', 'Bolsa 1 kg', '5', '19000'],
  ]);
  await pagar(t1.id, 21, '549000', 'TRANSFERENCIA', imagenes.transferencia);
  await entregar(
    t1,
    20,
    central.id,
    [
      ['Sal fina', '6'],
      ['Aceite de girasol', '10'],
      ['Azúcar impalpable', '5'],
      ['Polvo de hornear', '4'],
      ['Semillas de sésamo', '4'],
      ['Nuez mariposa', '5'],
    ],
    '0003-00005102',
  );
  await entregar(t1, 14, otra.id, [['Sal fina', '4']]);

  // 6. Lácteos otra vez: pagada, llegó la mitad (la manteca no llegó).
  const l2 = await comprar(14, lacteos, [
    ['Leche entera', 'Caja 12 l', '10', '12500'],
    ['Manteca', 'Caja 10 kg', '5', '88000'],
  ]);
  await pagar(l2.id, 14, '565000', 'MERCADO_PAGO', imagenes.mercadoPago);
  await entregar(l2, 13, central.id, [['Leche entera', '5']]);

  // 7. Acopio de Harina 0000 para Laferrere: pagado a medias, van llegando.
  const m1 = await comprar(8, molino, [['Harina 0000', 'Bolsa 25 kg', '60', '23000']], {
    sucursalId: otra.id,
  });
  await pagar(m1.id, 8, '690000', 'TRANSFERENCIA', imagenes.transferencia);
  await entregar(m1, 4, otra.id, [['Harina 0000', '15']], '0001-00011498');

  // 8. Pedido de ayer: nada llegó todavía, sin pagar.
  await asociar(dulceHogar, [
    ['Grana de colores', 'Bolsa 1 kg'],
    ['Esencia de vainilla', 'Botella 1 l'],
    ['Cacao amargo', 'Bolsa 5 kg'],
    ['Dulce de batata', 'Caja 5 kg'],
  ]);
  await comprar(1, dulceHogar, [
    ['Grana de colores', 'Bolsa 1 kg', '5', '8000'],
    ['Esencia de vainilla', 'Botella 1 l', '3', '9000'],
    ['Cacao amargo', 'Bolsa 5 kg', '2', '35000'],
    ['Dulce de batata', 'Caja 5 kg', '4', '17000'],
  ]);

  // 9. Llegó sin compra cargada (la compra por teléfono): el resto de los descartables.
  await compras.recibirDirecta(
    ctx,
    RecepcionDirectaSchema.parse({
      fecha: haceDias(6, 9).toISOString(),
      sucursalId: central.id,
      proveedorId: descartables,
      numeroRemito: '0002-00000318',
      notas: 'Ejemplo: lo trajo el repartidor sin pedido previo',
      lineas: [
        { ...de('Bandeja de cartón', 'Paquete 100 u'), cantidad: '10', precioUnitario: '9000' },
        { ...de('Pirotines', 'Paquete 1000 u'), cantidad: '3', precioUnitario: '12000' },
        { ...de('Guantes descartables', 'Caja 100 u'), cantidad: '4', precioUnitario: '7000' },
        { ...de('Detergente', 'Bidón 5 l'), cantidad: '6', precioUnitario: '6000' },
      ],
    }),
  );

  // 10. Una compra directa al mayorista en Laferrere, también sin compra cargada.
  await compras.recibirDirecta(
    ctx,
    RecepcionDirectaSchema.parse({
      fecha: haceDias(9, 9).toISOString(),
      sucursalId: otra.id,
      proveedorId: mayorista,
      numeroRemito: null,
      notas: 'Ejemplo: faltaba harina y se compró al paso',
      lineas: [{ ...de('Harina 000', 'Bolsa 25 kg'), cantidad: '8', precioUnitario: '21000' }],
    }),
  );

  // --- Plantillas de pedido (compras que se repiten) ---------------------------
  await plantillas.crear(
    ctx,
    GuardarPlantillaSchema.parse({
      nombre: 'Pedido semanal Molino (ejemplo)',
      proveedorId: molino,
      sucursalId: central.id,
      notas: null,
      lineas: [
        { ...de('Harina 000', 'Bolsa 25 kg'), cantidad: '40' },
        { ...de('Harina 0000', 'Bolsa 25 kg'), cantidad: '10' },
      ],
    }),
  );
  await plantillas.crear(
    ctx,
    GuardarPlantillaSchema.parse({
      nombre: 'Lácteos de la quincena (ejemplo)',
      proveedorId: lacteos,
      sucursalId: central.id,
      notas: null,
      lineas: [
        { ...de('Leche entera', 'Caja 12 l'), cantidad: '10' },
        { ...de('Crema de leche', 'Caja 12 l'), cantidad: '4' },
        { ...de('Manteca', 'Caja 10 kg'), cantidad: '5' },
      ],
    }),
  );

  // --- Stock: mermas, consumos, "se terminó", un ajuste y los mínimos -----------
  let cantidadMovimientos = 0;

  const saldo = async (insumo: string, sucursalId: string) => {
    const agregado = await prisma.movimientoStock.aggregate({
      where: { empresaId, sucursalId, insumoId: insumoId(insumo) },
      _sum: { cantidadBase: true },
    });
    return aDecimal(agregado._sum.cantidadBase?.toString() ?? '0');
  };

  const mermar = async (
    dias: number,
    sucursalId: string,
    insumo: string,
    cantidad: string,
    porque: string,
  ) => {
    if ((await saldo(insumo, sucursalId)).lessThan(cantidad)) return;
    await movimientos.cargarMerma(
      ctx,
      CargarMermaSchema.parse({
        sucursalId,
        motivoId: motivo(porque, 'MERMA'),
        fecha: haceDias(dias, 18).toISOString(),
        notas: 'Ejemplo',
        lineas: [{ insumoId: insumoId(insumo), cantidad }],
      }),
    );
    cantidadMovimientos += 1;
  };
  await mermar(25, central.id, 'Levadura fresca', '2', 'Vencido');
  await mermar(16, central.id, 'Huevos', '12', 'Roto / derramado');
  await mermar(11, central.id, 'Leche entera', '6', 'Vencido');
  await mermar(33, otra.id, 'Harina 000', '25', 'Plaga o humedad');

  /**
   * Lleva el saldo de un insumo a `objetivo` con TRES consumos (como tres
   * semanas de trabajo), partiendo del saldo que haya. Si ya está por debajo
   * del objetivo, no hace nada.
   */
  const dejarEn = async (sucursalId: string, insumo: string, objetivo: string) => {
    const diferencia = (await saldo(insumo, sucursalId)).minus(objetivo);
    if (diferencia.lessThanOrEqualTo(0)) return;
    const partes = [
      [19, diferencia.times('0.4').toDecimalPlaces(2)],
      [12, diferencia.times('0.35').toDecimalPlaces(2)],
    ] as const;
    const ultima = diferencia.minus(partes[0][1]).minus(partes[1][1]);
    for (const [dias, cantidad] of [...partes, [5, ultima] as const]) {
      if (cantidad.lessThanOrEqualTo(0)) continue;
      await movimientos.cargarConsumo(
        ctx,
        CargarConsumoSchema.parse({
          sucursalId,
          fecha: haceDias(dias, 20).toISOString(),
          notas: 'Ejemplo: producción de la semana',
          lineas: [{ insumoId: insumoId(insumo), cantidad: cantidad.toString() }],
        }),
      );
      cantidadMovimientos += 1;
    }
  };

  /** [insumo, sucursal, saldo al que llega, stock mínimo]. Los estados salen de ahí. */
  const objetivos: [string, string, string, string][] = [
    ['Harina 000', central.id, '825', '1000'], // bajo
    ['Harina 000', otra.id, '875', '500'],
    ['Harina 0000', central.id, '120', '100'],
    ['Azúcar', central.id, '250', '200'],
    ['Margarina', central.id, '15', '30'], // bajo
    ['Grasa vacuna', otra.id, '80', '40'],
    ['Levadura fresca', central.id, '6', '10'], // bajo
    ['Levadura fresca', otra.id, '12', '5'],
    ['Huevos', central.id, '48', '90'], // bajo
    ['Dulce de leche repostero', central.id, '30', '20'],
    ['Leche entera', central.id, '30', '40'], // bajo
    ['Crema de leche', central.id, '8', '12'], // bajo
    ['Queso crema', central.id, '11.6', '7.2'],
    ['Chocolate cobertura semiamargo', central.id, '7', '10'], // bajo
    ['Chocolate cobertura semiamargo', otra.id, '20', '5'],
    ['Dulce de membrillo', central.id, '20', '10'],
    ['Frutas abrillantadas', central.id, '90', '20'],
    ['Jamón cocido', central.id, '4', '8'], // bajo
    ['Queso de máquina', central.id, '6', '7'], // bajo
    ['Muzzarella', central.id, '8', '10'], // bajo
    ['Sal fina', central.id, '60', '25'],
    ['Sal fina', otra.id, '60', '25'],
    ['Aceite de girasol', central.id, '15', '10'],
    ['Azúcar impalpable', central.id, '30', '10'],
    ['Polvo de hornear', central.id, '14', '5'],
    ['Semillas de sésamo', central.id, '12', '5'],
    ['Bolsa de papel kraft', central.id, '400', '1000'], // bajo
    ['Caja para torta', central.id, '120', '50'],
    ['Bandeja de cartón', central.id, '700', '200'],
    ['Lavandina', central.id, '8', '10'], // bajo
    ['Detergente', central.id, '10', '10'],
  ];
  for (const [insumo, sucursalId, objetivo] of objetivos) {
    await dejarEn(sucursalId, insumo, objetivo);
  }

  // "Se terminó": quedan en cero, y como tienen mínimo, aparecen "sin stock".
  const terminar = async (dias: number, sucursalId: string, insumo: string) => {
    if ((await saldo(insumo, sucursalId)).lessThanOrEqualTo(0)) return;
    await movimientos.agotar(
      ctx,
      AgotarStockSchema.parse({
        sucursalId,
        insumoId: insumoId(insumo),
        fecha: haceDias(dias, 19).toISOString(),
        notas: 'Ejemplo: se terminó',
      }),
    );
    cantidadMovimientos += 1;
  };
  await terminar(3, central.id, 'Manteca');
  await terminar(2, central.id, 'Nuez mariposa');
  await terminar(1, otra.id, 'Harina 0000');

  // Un conteo: el sistema decía 250 kg de azúcar y había 240.
  const azucar = await saldo('Azúcar', central.id);
  if (azucar.greaterThan(10)) {
    await movimientos.ajustar(
      ctx,
      AjustarStockSchema.parse({
        sucursalId: central.id,
        motivoId: motivo('Diferencia de conteo', 'AJUSTE'),
        fecha: haceDias(2, 8).toISOString(),
        notas: 'Ejemplo: conteo del depósito',
        lineas: [{ insumoId: insumoId('Azúcar'), cantidadContada: azucar.minus(10).toString() }],
      }),
    );
    cantidadMovimientos += 1;
  }

  const minimos: [string, string, string][] = [
    ...objetivos.map(
      ([insumo, sucursalId, , minimo]) => [insumo, sucursalId, minimo] as [string, string, string],
    ),
    ['Manteca', central.id, '10'],
    ['Nuez mariposa', central.id, '2'],
    ['Harina 0000', otra.id, '50'],
  ];
  for (const [insumo, sucursalId, stockMinimo] of minimos) {
    await insumos.definirParametrosSucursal(
      ctx,
      insumoId(insumo),
      sucursalId,
      ParametrosSucursalSchema.parse({ stockMinimo }),
    );
  }

  return { insumos: porNombre.size, compras: cantidadCompras, movimientos: cantidadMovimientos };
}
