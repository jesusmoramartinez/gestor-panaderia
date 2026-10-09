import { expect, test } from '@playwright/test';

import {
  desplegable,
  elegir,
  entrar,
  saldo,
  sucursales,
  textoElegido,
  vigilarErrores,
} from './ayudas.js';

/**
 * El recorrido de la Fase 8 desde la pantalla, como lo haría el dueño.
 *
 * Cada `expect` de abajo que dice "lo que se VE" es algo que los tests de la
 * API no pueden comprobar, y dos de ellos fueron bugs reales (nota 17).
 */
test('pedir 10 bolsas, recibir 4 y después el resto', async ({ page }) => {
  const errores = vigilarErrores(page);
  await entrar(page, 'dueno@panaderia.test');
  const { central } = await sucursales(page);

  // --- La orden: al elegir el insumo se precargan presentación y precio.
  await page.goto('/compras/nueva');
  await elegir(desplegable(page, 'Proveedor'), 'Molino San Jorge');
  const insumo = desplegable(page, 'Insumo');
  // Bug de la Fase 8: esta lista llegaba VACÍA (el front pedía limite=200).
  await expect(insumo.locator('option')).not.toHaveCount(1);
  await elegir(insumo, 'Harina 000');
  await expect(page.getByLabel('Precio c/u')).toHaveValue('18500');
  // Bug de la Fase 8: el desplegable MOSTRABA "Suelto, en kg" con la bolsa adentro.
  await expect.poll(() => textoElegido(desplegable(page, 'Presentación'))).toBe('Bolsa 25 kg');

  await page.getByLabel('Cuántas').fill('10');
  await expect(page.getByText('= 250 kg')).toBeVisible();
  await expect(page.getByText('$ 185.000,00')).toBeVisible();
  await page.getByRole('button', { name: 'Crear pedido' }).click();

  await expect(page.getByText('Pedida', { exact: true })).toBeVisible();
  const urlOrden = page.url();
  const harinaId = await page.evaluate(async () => {
    const r = await fetch('/api/insumos?busqueda=Harina%20000');
    const datos = (await r.json()) as { items: { id: string }[] };
    return datos.items[0]?.id ?? '';
  });
  // Pedir no suma stock.
  expect(await saldo(page, harinaId, central)).toBe('0');

  // --- Llegan 4 de 10.
  await page.getByRole('link', { name: 'Recibir mercadería' }).click();
  await page.getByLabel('Llegaron').fill('4');
  await page.getByLabel('Número de remito').fill('0001-00004567');
  await page.getByRole('button', { name: 'Registrar recepción' }).click();
  await expect(page.getByRole('heading', { name: /Recepción \d+/ })).toBeVisible();
  await expect(page.getByText('$ 740,00 por kg').first()).toBeVisible();
  expect(await saldo(page, harinaId, central)).toBe('100');

  await page.goto(urlOrden);
  await expect(page.getByText('Llegó una parte')).toBeVisible();
  await expect(page.getByText('faltan 6 × Bolsa 25 kg')).toBeVisible();
  await expect(page.getByText('llegaron 4 × Bolsa 25 kg')).toBeVisible();

  // --- Llega el resto, con "Llegó todo".
  await page.getByRole('link', { name: 'Recibir mercadería' }).click();
  await page.getByRole('button', { name: 'Llegó todo' }).click();
  await expect(page.getByLabel('Llegaron')).toHaveValue('6');
  await page.getByRole('button', { name: 'Registrar recepción' }).click();
  await expect(page.getByRole('heading', { name: /Recepción \d+/ })).toBeVisible();

  await page.goto(urlOrden);
  await expect(page.getByText('Recibida', { exact: true })).toBeVisible();
  await expect(page.getByText('completo')).toBeVisible();
  expect(await saldo(page, harinaId, central)).toBe('250');

  // --- El historial muestra la compra con su remito.
  await page.goto(`/stock/${harinaId}`);
  await expect(
    page.getByText(/Recepción \d+ · Molino San Jorge · remito 0001-00004567/),
  ).toBeVisible();

  expect(errores).toEqual([]);
});

test('las pantallas de carga muestran los insumos (el bug de limite=200)', async ({ page }) => {
  const errores = vigilarErrores(page);
  await entrar(page, 'dueno@panaderia.test');

  for (const ruta of ['/stock/consumo', '/stock/merma', '/recepciones/nueva']) {
    await page.goto(ruta);
    const opciones = desplegable(page, 'Insumo').first().locator('option');
    // 28 insumos de la semilla + "Elegí un insumo".
    await expect(opciones, ruta).toHaveCount(29);
  }
  expect(errores).toEqual([]);
});
