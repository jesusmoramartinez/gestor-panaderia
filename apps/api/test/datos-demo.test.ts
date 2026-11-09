import { afterAll, describe, expect, it } from 'vitest';

import { darDeAltaEmpresa } from '../src/alta/alta.js';
import { cargarDatosDemo, DatosDemoError } from '../src/alta/datos-demo.js';
import { cargarDatosDemoExtra } from '../src/alta/datos-demo-extra.js';
import * as movimientos from '../src/modules/movimientos/service.js';
import { cerrarConexiones, prisma } from '../src/lib/db.js';
import { loQueMeDeben } from '../src/modules/acopio/service.js';
import { reportes } from '../src/modules/reportes/service.js';
import type { Contexto } from '../src/lib/contexto.js';
import { permisosDe } from '@panaderia/shared';

/**
 * LOS DATOS DE EJEMPLO (src/alta/datos-demo.ts): se cargan en una empresa
 * recién dada de alta y dejan cada pantalla y cada reporte con algo.
 */

afterAll(async () => {
  await cerrarConexiones();
});

const PNG =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

async function empresaNueva() {
  const email = `demo-${String(Date.now())}-${String(Math.floor(Math.random() * 1e6))}@panaderia.test`;
  const { empresaId, duenoId } = await darDeAltaEmpresa(
    prisma,
    {
      empresa: { nombre: `Panadería demo ${email}` },
      sucursales: [
        { codigo: 'CAT', nombre: 'Catán', esCentral: true },
        { codigo: 'LAF', nombre: 'Laferrere' },
      ],
      dueno: { email, nombre: 'Dueño demo' },
    },
    'clave-de-prueba-1',
  );
  const sucursales = await prisma.sucursal.findMany({ where: { empresaId }, select: { id: true } });
  const ctx: Contexto = {
    usuarioId: duenoId,
    empresaId,
    rol: 'DUENO',
    permisos: permisosDe('DUENO'),
    sucursalesPermitidas: sucursales.map((s) => s.id),
    sesionId: '00000000-0000-4000-8000-000000000000',
    ip: undefined,
  };
  return { empresaId, ctx };
}

describe('datos de ejemplo', () => {
  it('✅ cargan compras, pagos, entregas y notas, y las cuentas dan lo que tienen que dar', async () => {
    const { empresaId, ctx } = await empresaNueva();
    const resultado = await cargarDatosDemo(empresaId, {
      transferencia: PNG,
      mercadoPago: PNG,
      remito: PNG,
    });
    expect(resultado).toEqual({ insumos: 8, proveedores: 5, compras: 13 });

    // Estados variados, como en la vida real.
    const estados = await prisma.ordenCompra.groupBy({
      by: ['estado'],
      where: { empresaId },
      _count: true,
    });
    const porEstado = Object.fromEntries(estados.map((e) => [e.estado, e._count]));
    expect(porEstado).toEqual({
      RECIBIDA: 5,
      PARCIAL: 3,
      PEDIDA: 2,
      CERRADA: 1,
      CANCELADA: 1,
      BORRADOR: 1,
    });

    // Lo que me deben: 130 bolsas del acopio grande (a $22.000), lo que falta
    // de El Trébol, del mayorista, los huevos y la levadura sin entregar.
    const deudas = await loQueMeDeben(ctx);
    const molino = deudas.proveedores.find((d) => d.proveedor.nombre.startsWith('Molino'));
    expect(molino?.valorPendiente).toBe('2860000');
    // La compra cerrada con faltante: pagó 3.900.000 y llegó por 2.910.000.
    expect(deudas.aFavor.map((a) => a.monto)).toEqual(['990000']);

    // Los reportes de los últimos 12 meses tienen al menos 4 meses con compras.
    const r = await reportes(ctx, {});
    expect(r.gastoPorMes.filter((m) => m.comprado !== '0').length).toBeGreaterThanOrEqual(4);
    expect(r.pagosPorMedio.totales.every((t) => t.pagos > 0)).toBe(true);
    const harina = r.comparacion.find((c) => c.insumo.nombre === 'Harina 000');
    expect(harina?.proveedores.some((p) => p.masBarato)).toBe(true);

    // Comprobantes, notas y un pago anulado.
    expect(await prisma.comprobante.count({ where: { empresaId } })).toBeGreaterThan(5);
    expect(await prisma.notaCompra.count({ where: { empresaId } })).toBe(2);
    expect(await prisma.pago.count({ where: { empresaId, anuladoAt: { not: null } } })).toBe(1);
  });

  it('se niega en una empresa que ya tiene datos: no se puede cargar dos veces ni en una en uso', async () => {
    const { empresaId } = await empresaNueva();
    await cargarDatosDemo(empresaId);
    await expect(cargarDatosDemo(empresaId)).rejects.toBeInstanceOf(DatosDemoError);
  });

  it('EXTRA: encima de la base, el stock queda en los tres estados y el acopio crece', async () => {
    const { empresaId, ctx } = await empresaNueva();
    await cargarDatosDemo(empresaId, { transferencia: PNG, mercadoPago: PNG, remito: PNG });
    const antes = await loQueMeDeben(ctx);

    const r = await cargarDatosDemoExtra(empresaId, { transferencia: PNG, remito: PNG });
    expect(r.insumos).toBe(38); // 8 de la base + 30 nuevos
    expect(r.compras).toBe(8);
    expect(r.movimientos).toBeGreaterThan(50);

    // El stock de la Central tiene de todo: ok, bajo y sin stock.
    const central = await prisma.sucursal.findFirstOrThrow({ where: { empresaId, codigo: 'CAT' } });
    const stock = await movimientos.obtenerStock(ctx, {
      sucursalId: central.id,
      soloAlertas: false,
    });
    const estado = (nombre: string) => stock.items.find((i) => i.nombre === nombre);
    expect(estado('Harina 000')).toMatchObject({ saldo: '825', estado: 'BAJO' });
    expect(estado('Manteca')).toMatchObject({ saldo: '0', estado: 'CRITICO', stockMinimo: '10' });
    expect(estado('Frutas abrillantadas')).toMatchObject({ saldo: '90', estado: 'OK' });
    // El ajuste por conteo: 250 → 240.
    expect(estado('Azúcar')?.saldo).toBe('240');
    // Con su ícono, para la lista del inicio.
    expect(estado('Jamón cocido')?.icono).toBe('🥓');

    // El acopio creció (pan dulce, lácteos, harina para Laferrere...).
    const despues = await loQueMeDeben(ctx);
    expect(Number(despues.valorPendiente)).toBeGreaterThan(Number(antes.valorPendiente));
    expect(despues.proveedores.map((p) => p.proveedor.nombre)).toContain(
      'Distribuidora Dulce Hogar (ejemplo)',
    );

    // Hay mermas, consumos, "se terminó" y un ajuste.
    const tipos = await prisma.movimientoStock.groupBy({
      by: ['tipo'],
      where: { empresaId },
      _count: true,
    });
    expect(tipos.map((t) => t.tipo).sort()).toEqual(['AJUSTE', 'COMPRA', 'CONSUMO', 'MERMA']);
    expect(await prisma.plantillaPedido.count({ where: { empresaId } })).toBe(2);

    // Una sola vez.
    await expect(cargarDatosDemoExtra(empresaId)).rejects.toBeInstanceOf(DatosDemoError);
  });

  it('EXTRA: sin los datos de ejemplo base, se niega', async () => {
    const { empresaId } = await empresaNueva();
    await expect(cargarDatosDemoExtra(empresaId)).rejects.toThrow(/Molino Santa Rosa/);
  });

  it('EXTRA: si alguien ya descontó stock probando la demo, la carga igual cierra', async () => {
    // Los consumos se calculan para LLEGAR a un saldo, no son cantidades fijas.
    const { empresaId, ctx } = await empresaNueva();
    await cargarDatosDemo(empresaId);
    const central = await prisma.sucursal.findFirstOrThrow({ where: { empresaId, codigo: 'CAT' } });
    const margarina = await prisma.insumo.findFirstOrThrow({
      where: { empresaId, nombre: 'Margarina' },
    });
    // Marcelo tocó "Se terminó" en la margarina durante la demo.
    await movimientos.agotar(ctx, {
      sucursalId: central.id,
      insumoId: margarina.id,
      fecha: null,
      notas: null,
    });

    await cargarDatosDemoExtra(empresaId);

    const stock = await movimientos.obtenerStock(ctx, {
      sucursalId: central.id,
      soloAlertas: false,
    });
    expect(stock.items.find((i) => i.nombre === 'Margarina')?.saldo).toBe('0');
    expect(stock.items.every((i) => !i.saldo.startsWith('-'))).toBe(true);
  });
});
