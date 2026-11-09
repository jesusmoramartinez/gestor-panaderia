import { readFile } from 'node:fs/promises';

import { expect, test } from '@playwright/test';

import { api, entrar, sucursales, vigilarErrores } from './ayudas.js';

/**
 * LOS REPORTES (Etapa 2, Fase 12d), en el celular y en la PC.
 *
 * Que los números estén bien lo prueban shared (con números conocidos) y la
 * API. Acá, lo que solo ve un navegador: que los 11 reportes se dibujan sin
 * errores ni desbordes, que el CSV que se BAJA abre bien en Excel, y que al
 * imprimir no salen el menú ni los botones.
 */
const REPORTES = [
  'Mercadería que me deben',
  'Plata adelantada y a favor',
  'Compras abiertas por antigüedad',
  'Gasto por mes',
  'Gasto por proveedor',
  'Gasto por insumo',
  'Pagos por medio',
  'Evolución del precio de un insumo',
  'Comparar proveedores por insumo',
  'Cumplimiento de los proveedores',
  'Entregas por semana',
];

test('los 11 reportes se ven, se bajan en CSV y se imprimen limpios', async ({ page }, info) => {
  const errores = vigilarErrores(page);
  await entrar(page, 'dueno@panaderia.test');
  const { central } = await sucursales(page);

  // Datos de este mes: una compra pagada por Mercado Pago, con una entrega.
  const proveedores = await api<{ id: string; nombre: string }[]>(page, 'GET', '/proveedores');
  const molino = proveedores.find((p) => p.nombre === 'Molino San Jorge');
  const insumos = await api<{ items: { id: string }[] }>(
    page,
    'GET',
    '/insumos?busqueda=Harina%20000',
  );
  const compra = await api<{ id: string; lineas: { id: string }[] }>(
    page,
    'POST',
    '/ordenes-compra',
    {
      sucursalId: central,
      proveedorId: molino?.id,
      lineas: [{ insumoId: insumos.items[0]?.id, cantidad: '10', precioUnitario: '1234.5' }],
    },
  );
  await api(page, 'POST', `/ordenes-compra/${compra.id}/pagos`, {
    monto: '12345',
    medio: 'MERCADO_PAGO',
  });
  await api(page, 'POST', `/ordenes-compra/${compra.id}/recepciones`, {
    lineas: [{ lineaOrdenId: compra.lineas[0]?.id, cantidad: '3', precioUnitario: '1234.5' }],
  });

  await page.getByRole('link', { name: 'Reportes' }).click();
  await expect(page.getByRole('heading', { name: 'Reportes', exact: true })).toBeVisible();

  // --- Los 11, uno por uno.
  const selector = page.getByRole('combobox', { name: 'Qué reporte' });
  for (const [indice, titulo] of REPORTES.entries()) {
    await selector.selectOption({ label: titulo });
    await expect(page.getByRole('heading', { name: titulo, level: 2 })).toBeVisible();
    await expect(page.getByText('Calculando...')).toHaveCount(0);
    await page.screenshot({
      path: info.outputPath(`reporte-${String(indice + 1).padStart(2, '0')}.png`),
      fullPage: true,
    });
    const desborde = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(desborde, titulo).toBe(0);
  }

  // --- El CSV de "Gasto por mes", bajado de verdad.
  await selector.selectOption({ label: 'Gasto por mes' });
  const descarga = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Descargar CSV' }).click();
  const archivo = await descarga;
  expect(archivo.suggestedFilename()).toMatch(/^gasto-por-mes-.*\.csv$/);
  const contenido = await readFile((await archivo.path()) ?? '', 'utf8');
  expect(contenido.startsWith('\uFEFF')).toBe(true); // BOM: Excel lee bien las tildes
  expect(contenido).toContain('Mes;Comprado;Pagado');
  // Coma decimal, como lo lee un Excel en español: 10 × 1234,5 = 12345.
  expect(contenido).toMatch(/;\d+(,\d+)?;\d+(,\d+)?\r\n/);

  // --- La evolución del precio: el insumo se elige y queda en la URL.
  await selector.selectOption({ label: 'Evolución del precio de un insumo' });
  await page.getByRole('combobox', { name: 'Insumo' }).selectOption({ label: 'Harina 000' });
  await expect(page).toHaveURL(/insumo=/);
  await expect(page.getByRole('img', { name: /Precio por kg de Harina 000/ })).toBeVisible();

  // --- Impreso: sin menú, sin encabezado, sin botones; con el reporte.
  await page.emulateMedia({ media: 'print' });
  await expect(page.getByRole('button', { name: 'Salir' })).toBeHidden();
  await expect(page.getByRole('button', { name: 'Descargar CSV' })).toBeHidden();
  await expect(page.getByRole('combobox', { name: 'Qué reporte' })).toBeHidden();
  await expect(
    page.getByRole('heading', { name: 'Evolución del precio de un insumo' }),
  ).toBeVisible();
  await page.screenshot({ path: info.outputPath('impreso.png'), fullPage: true });
  await page.emulateMedia({ media: 'screen' });

  expect(errores).toEqual([]);
});
