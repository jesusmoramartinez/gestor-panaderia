/**
 * DATOS DE EJEMPLO para una empresa recién dada de alta.
 *
 * Para que el dueño vea el sistema funcionando antes de cargar lo suyo:
 * insumos, proveedores, y cuatro meses de compras en acopio con pagos
 * (algunos con comprobante), entregas por tandas a las dos sucursales, notas,
 * una compra cerrada con faltante (plata a favor), una sin pagar, una pagada
 * en parte, una cancelada y un borrador. Así cada reporte tiene algo.
 *
 * Todo pasa por los SERVICIOS de verdad (las mismas reglas, candados y
 * auditoría que la web); después solo se corren las FECHAS hacia atrás,
 * porque la API, a propósito, no deja inventar cuándo se pidió algo.
 *
 * Protecciones (lo corre una persona, a mano, en el servidor):
 *   - solo sobre una empresa SIN insumos ni compras (recién dada de alta);
 *   - cada dato lleva "ejemplo" en sus notas;
 *   - el CLI exige escribir --confirmo-datos-de-prueba.
 */
import {
  CrearInsumoSchema,
  CrearOrdenSchema,
  CrearPresentacionSchema,
  CrearProveedorInsumoSchema,
  CrearProveedorSchema,
  type MedioPago,
  permisosDe,
  RecepcionDeOrdenSchema,
  RegistrarPagoSchema,
} from '@panaderia/shared';
import { randomUUID } from 'node:crypto';

import type { Contexto } from '../lib/contexto.js';
import { prisma } from '../lib/db.js';
import { agregarNota } from '../modules/acopio/historial.js';
import * as compras from '../modules/compras/service.js';
import * as insumos from '../modules/insumos/service.js';
import { registrarPago, anularPago } from '../modules/pagos/service.js';
import * as proveedores from '../modules/proveedores/service.js';

export class DatosDemoError extends Error {
  override readonly name = 'DatosDemoError';
}

/** Un día de hace `dias` días, al mediodía de Argentina (15:00 UTC). */
function haceDias(dias: number, hora = 12): Date {
  const fecha = new Date();
  fecha.setUTCDate(fecha.getUTCDate() - dias);
  fecha.setUTCHours(hora + 3, 0, 0, 0);
  return fecha;
}

type Imagenes = { transferencia?: string; mercadoPago?: string; remito?: string };

export async function cargarDatosDemo(
  empresaId: string,
  imagenes: Imagenes = {},
): Promise<{ insumos: number; proveedores: number; compras: number }> {
  const empresa = await prisma.empresa.findUnique({
    where: { id: empresaId },
    select: {
      id: true,
      sucursales: { select: { id: true, codigo: true, esCentral: true } },
      usuarios: { where: { rol: 'DUENO', activo: true }, select: { id: true }, take: 1 },
      unidades: { select: { id: true, codigo: true } },
      categorias: { select: { id: true, nombre: true } },
      _count: { select: { insumos: true, ordenes: true } },
    },
  });
  if (!empresa) throw new DatosDemoError('Esa empresa no existe.');
  if (empresa._count.insumos > 0 || empresa._count.ordenes > 0) {
    throw new DatosDemoError(
      `La empresa ya tiene ${String(empresa._count.insumos)} insumos y ${String(empresa._count.ordenes)} compras: ` +
        'los datos de ejemplo solo se cargan en una empresa recién dada de alta.',
    );
  }
  const dueno = empresa.usuarios[0];
  if (!dueno) throw new DatosDemoError('La empresa no tiene un dueño activo.');

  const central = empresa.sucursales.find((s) => s.esCentral) ?? empresa.sucursales[0];
  const otra = empresa.sucursales.find((s) => s.id !== central?.id) ?? central;
  if (!central || !otra) throw new DatosDemoError('La empresa no tiene sucursales.');

  // El "como si fuera el dueño": los servicios piden un contexto de sesión.
  const ctx: Contexto = {
    usuarioId: dueno.id,
    empresaId,
    rol: 'DUENO',
    permisos: permisosDe('DUENO'),
    sucursalesPermitidas: empresa.sucursales.map((s) => s.id),
    sesionId: randomUUID(),
    ip: 'datos-de-ejemplo',
  };

  const unidad = (codigo: string) => {
    const encontrada = empresa.unidades.find((u) => u.codigo === codigo);
    if (!encontrada) throw new DatosDemoError(`Falta la unidad ${codigo}.`);
    return encontrada.id;
  };
  const categoria = (nombre: string) =>
    empresa.categorias.find((c) => c.nombre === nombre)?.id ?? null;

  // --- Insumos y sus presentaciones -----------------------------------------
  const presentaciones = new Map<string, { insumoId: string; presentacionId: string }>();
  const definiciones = [
    {
      nombre: 'Harina 000',
      cat: 'Harinas',
      u: 'kg',
      pres: [
        ['Bolsa 25 kg', '25'],
        ['Bolsa 50 kg', '50'],
      ],
    },
    { nombre: 'Harina 0000', cat: 'Harinas', u: 'kg', pres: [['Bolsa 25 kg', '25']] },
    { nombre: 'Azúcar', cat: 'Azúcares', u: 'kg', pres: [['Bolsa 50 kg', '50']] },
    { nombre: 'Margarina', cat: 'Grasas y aceites', u: 'kg', pres: [['Caja 10 kg', '10']] },
    { nombre: 'Grasa vacuna', cat: 'Grasas y aceites', u: 'kg', pres: [['Caja 20 kg', '20']] },
    {
      nombre: 'Levadura fresca',
      cat: 'Levaduras y mejoradores',
      u: 'kg',
      pres: [
        ['Caja 10 kg', '10'],
        ['Pan 500 g', '0.5'],
      ],
    },
    { nombre: 'Huevos', cat: 'Huevos', u: 'u', pres: [['Maple 30 u', '30']] },
    {
      nombre: 'Dulce de leche repostero',
      cat: 'Rellenos y coberturas',
      u: 'kg',
      pres: [['Balde 10 kg', '10']],
    },
  ] as const;

  for (const def of definiciones) {
    const insumo = await insumos.crear(
      ctx,
      CrearInsumoSchema.parse({
        nombre: def.nombre,
        codigo: null,
        categoriaId: categoria(def.cat),
        unidadBaseId: unidad(def.u),
      }),
    );
    for (const [indice, [nombre, cantidadBase]] of def.pres.entries()) {
      const detalle = await insumos.crearPresentacion(
        ctx,
        insumo.id,
        CrearPresentacionSchema.parse({ nombre, cantidadBase, esDefault: indice === 0 }),
      );
      const presentacion = detalle.presentaciones.find((p) => p.nombre === nombre);
      if (presentacion) {
        presentaciones.set(`${def.nombre}|${nombre}`, {
          insumoId: insumo.id,
          presentacionId: presentacion.id,
        });
      }
    }
  }
  const de = (insumo: string, presentacion: string) => {
    const encontrada = presentaciones.get(`${insumo}|${presentacion}`);
    if (!encontrada) throw new DatosDemoError(`Falta ${insumo} en ${presentacion}.`);
    return encontrada;
  };

  // --- Proveedores ----------------------------------------------------------
  const proveedor = async (
    nombre: string,
    extra: Record<string, unknown>,
    vende: [string, string][],
  ) => {
    const creado = await proveedores.crear(
      ctx,
      CrearProveedorSchema.parse({ nombre, notas: 'Proveedor de ejemplo', ...extra }),
    );
    for (const [insumo, presentacion] of vende) {
      const { insumoId, presentacionId } = de(insumo, presentacion);
      await proveedores.crearAsociacion(
        ctx,
        creado.id,
        CrearProveedorInsumoSchema.parse({ insumoId, presentacionId, esPreferido: false }),
      );
    }
    return creado.id;
  };
  const molino = await proveedor(
    'Molino Santa Rosa (ejemplo)',
    { contactoNombre: 'Ventas', diasEntrega: '7' },
    [
      ['Harina 000', 'Bolsa 25 kg'],
      ['Harina 0000', 'Bolsa 25 kg'],
    ],
  );
  const trebol = await proveedor(
    'Distribuidora El Trébol (ejemplo)',
    { contactoNombre: 'Marisa', diasEntrega: '3' },
    [
      ['Azúcar', 'Bolsa 50 kg'],
      ['Margarina', 'Caja 10 kg'],
      ['Grasa vacuna', 'Caja 20 kg'],
      ['Dulce de leche repostero', 'Balde 10 kg'],
    ],
  );
  const levaduras = await proveedor('Levaduras del Oeste (ejemplo)', { diasEntrega: '1' }, [
    ['Levadura fresca', 'Caja 10 kg'],
  ]);
  const granja = await proveedor('Granja Los Álamos (ejemplo)', { diasEntrega: '1' }, [
    ['Huevos', 'Maple 30 u'],
  ]);
  const mayorista = await proveedor('Mayorista Central (ejemplo)', { diasEntrega: '0' }, [
    ['Harina 000', 'Bolsa 25 kg'],
  ]);

  // --- Compras --------------------------------------------------------------
  type Renglon = [insumo: string, presentacion: string, cantidad: string, precio: string];
  let cantidadCompras = 0;

  const comprar = async (
    dias: number,
    proveedorId: string,
    renglones: Renglon[],
    opciones: { pedir?: boolean; sucursalId?: string } = {},
  ) => {
    const orden = await compras.crearOrden(
      ctx,
      CrearOrdenSchema.parse({
        sucursalId: opciones.sucursalId ?? central.id,
        proveedorId,
        pedir: opciones.pedir ?? true,
        notas: 'Compra de ejemplo',
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
      data: { createdAt: fecha, pedidaAt: opciones.pedir === false ? null : fecha },
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
    nota?: string,
  ) => {
    const orden = await registrarPago(
      ctx,
      ordenId,
      RegistrarPagoSchema.parse({
        fecha: haceDias(dias, 11).toISOString(),
        monto,
        medio,
        nota: nota ?? null,
        comprobantes: imagen === undefined ? [] : [{ datos: imagen }],
      }),
    );
    return orden.pagos.at(-1)?.id ?? '';
  };

  /** Una entrega: [renglón de la compra (por insumo), cantidad]. */
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

  const anotar = async (ordenId: string, dias: number, texto: string) => {
    await agregarNota(ctx, ordenId, { texto });
    const nota = await prisma.notaCompra.findFirst({
      where: { ordenCompraId: ordenId },
      orderBy: { createdAt: 'desc' },
      select: { id: true },
    });
    if (nota) {
      await prisma.notaCompra.update({
        where: { id: nota.id },
        data: { createdAt: haceDias(dias, 16) },
      });
    }
  };

  const fechaDeCierre = async (ordenId: string, dias: number) => {
    await prisma.ordenCompra.update({
      where: { id: ordenId },
      data: { cerradaAt: haceDias(dias, 17) },
    });
  };

  // 1. Hace 4 meses: 100 bolsas al molino, pagadas, entregadas en 4 tandas.
  const c1 = await comprar(121, molino, [['Harina 000', 'Bolsa 25 kg', '100', '18000']]);
  await pagar(c1.id, 121, '1800000', 'TRANSFERENCIA', imagenes.transferencia);
  await entregar(c1, 116, central.id, [['Harina 000', '25']], '0001-00010231');
  await entregar(c1, 109, otra.id, [['Harina 000', '25']]);
  await entregar(c1, 102, central.id, [['Harina 000', '25']], '0001-00010388');
  await entregar(c1, 95, central.id, [['Harina 000', '25']]);

  // 2. Azúcar y margarina, pagado en efectivo, llegó todo junto.
  const c2 = await comprar(111, trebol, [
    ['Azúcar', 'Bolsa 50 kg', '20', '32000'],
    ['Margarina', 'Caja 10 kg', '10', '45000'],
  ]);
  await pagar(c2.id, 111, '1090000', 'EFECTIVO');
  await entregar(
    c2,
    107,
    central.id,
    [
      ['Azúcar', '20'],
      ['Margarina', '10'],
    ],
    '0003-00004410',
  );

  // 3. Harina al mayorista (para comparar precios con el molino).
  const c3 = await comprar(89, mayorista, [['Harina 000', 'Bolsa 25 kg', '20', '19500']]);
  await pagar(c3.id, 89, '390000', 'MERCADO_PAGO', imagenes.mercadoPago);
  await entregar(c3, 89, otra.id, [['Harina 000', '20']]);

  // 4. Huevos: se paga al recibir.
  const c4 = await comprar(81, granja, [['Huevos', 'Maple 30 u', '10', '6500']]);
  await entregar(c4, 80, central.id, [['Huevos', '10']]);
  await pagar(c4.id, 80, '65000', 'EFECTIVO');

  // 5. Cancelada antes de que llegue nada (sin pago).
  const c5 = await comprar(76, trebol, [['Grasa vacuna', 'Caja 20 kg', '5', '50000']]);
  await compras.cancelarOrden(ctx, c5.id, { nota: 'Ejemplo: nos pasaron un precio equivocado' });
  await fechaDeCierre(c5.id, 75);

  // 6. Acopio grande al molino que se CERRÓ CON FALTANTE: queda plata a favor.
  const c6 = await comprar(69, molino, [
    ['Harina 000', 'Bolsa 25 kg', '150', '19000'],
    ['Harina 0000', 'Bolsa 25 kg', '50', '21000'],
  ]);
  await pagar(c6.id, 69, '3900000', 'TRANSFERENCIA', imagenes.transferencia);
  await entregar(
    c6,
    62,
    central.id,
    [
      ['Harina 000', '30'],
      ['Harina 0000', '10'],
    ],
    '0001-00010702',
  );
  await entregar(c6, 55, otra.id, [
    ['Harina 000', '30'],
    ['Harina 0000', '10'],
  ]);
  await entregar(
    c6,
    48,
    central.id,
    [
      ['Harina 000', '30'],
      ['Harina 0000', '10'],
    ],
    '0001-00010915',
  );
  await anotar(c6.id, 45, 'Ejemplo: dicen que el resto viene la semana que viene');
  await entregar(c6, 41, central.id, [['Harina 000', '30']]);
  await compras.cerrarOrden(ctx, c6.id, { nota: 'Ejemplo: el molino cortó las entregas' });
  await fechaDeCierre(c6.id, 30);

  // 7. Levadura: pagada por Mercado Pago, cuatro tandas semanales.
  const c7 = await comprar(52, levaduras, [['Levadura fresca', 'Caja 10 kg', '20', '38000']]);
  await pagar(c7.id, 52, '760000', 'MERCADO_PAGO', imagenes.mercadoPago);
  for (const [dias, sucursal] of [
    [51, central.id],
    [44, otra.id],
    [37, central.id],
    [30, otra.id],
  ] as const) {
    await entregar(c7, dias, sucursal, [['Levadura fresca', '5']]);
  }

  // 8. Varios insumos, pagada en dos veces, llegó una parte.
  const c8 = await comprar(35, trebol, [
    ['Azúcar', 'Bolsa 50 kg', '30', '35000'],
    ['Dulce de leche repostero', 'Balde 10 kg', '20', '28000'],
    ['Grasa vacuna', 'Caja 20 kg', '10', '52000'],
  ]);
  await pagar(c8.id, 35, '1000000', 'TRANSFERENCIA', imagenes.transferencia, 'Ejemplo: adelanto');
  await entregar(
    c8,
    32,
    central.id,
    [
      ['Azúcar', '15'],
      ['Dulce de leche repostero', '10'],
    ],
    '0003-00004871',
  );
  await pagar(c8.id, 20, '1130000', 'EFECTIVO', undefined, 'Ejemplo: saldo');
  await entregar(c8, 18, otra.id, [['Grasa vacuna', '10']]);

  // 9. Mayorista: pagada, llegó un tercio.
  const c9 = await comprar(25, mayorista, [['Harina 000', 'Bolsa 25 kg', '30', '21500']]);
  await pagar(c9.id, 25, '645000', 'MERCADO_PAGO', imagenes.mercadoPago);
  await entregar(c9, 15, otra.id, [['Harina 000', '10']]);

  // 10. El acopio grande de ahora: 200 bolsas pagadas, van llegando.
  const c10 = await comprar(12, molino, [['Harina 000', 'Bolsa 25 kg', '200', '22000']]);
  await pagar(c10.id, 12, '4400000', 'TRANSFERENCIA', imagenes.transferencia);
  await entregar(c10, 6, central.id, [['Harina 000', '40']], '0001-00011320');
  await entregar(c10, 3, otra.id, [['Harina 000', '30']]);
  await anotar(c10.id, 2, 'Ejemplo: la próxima entrega es el martes');

  // 11. Huevos pedidos, sin pagar (se pagan al recibir).
  await comprar(5, granja, [['Huevos', 'Maple 30 u', '15', '7200']], { sucursalId: otra.id });

  // 12. Levadura pagada en parte; un pago anulado (cargado en la compra equivocada).
  const c12 = await comprar(3, levaduras, [['Levadura fresca', 'Caja 10 kg', '10', '41000']]);
  await pagar(c12.id, 3, '200000', 'EFECTIVO');
  const equivocado = await pagar(c12.id, 2, '50000', 'EFECTIVO');
  await anularPago(ctx, equivocado, { motivo: 'Ejemplo: lo cargué en la compra equivocada' });

  // 13. Un borrador (todavía no se pidió: no cuenta en los reportes).
  await comprar(1, trebol, [['Margarina', 'Caja 10 kg', '10', '0']], { pedir: false });

  return { insumos: definiciones.length, proveedores: 5, compras: cantidadCompras };
}
