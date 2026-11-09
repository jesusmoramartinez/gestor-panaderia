import { expect, test } from '@playwright/test';

import { desplegable, elegir, entrar, vigilarErrores } from './ayudas.js';

/**
 * INSUMOS: el modal de "Nuevo insumo" con su ícono, y la barra de categorías
 * (como las historias de Instagram) para filtrar por una o varias.
 *
 * Corre en el celular y en la PC (proyectos de playwright.config.ts).
 */

test('crea un insumo con ícono desde el modal y lo encuentra filtrando por su categoría', async ({
  page,
}, info) => {
  const errores = vigilarErrores(page);
  await entrar(page, 'dueno@panaderia.test');
  await page.goto('/insumos');

  // --- El modal: se abre encima de la lista, con su propia URL.
  await page.getByRole('link', { name: 'Nuevo insumo' }).click();
  const modal = page.getByRole('dialog', { name: 'Nuevo insumo' });
  await expect(modal).toBeVisible();
  await expect(page).toHaveURL(/\/insumos\/nuevo$/);

  const nombre = `Membrillo e2e ${info.project.name} ${String(Date.now())}`;
  await modal.getByRole('textbox', { name: 'Nombre' }).fill(nombre);
  await elegir(desplegable(page, 'Categoría'), 'Rellenos y coberturas');
  await elegir(desplegable(page, 'Se lleva en'), 'Kilogramo');

  // Sin ícono propio, el botón muestra (apagado) el de la categoría.
  await expect(modal.getByRole('button', { name: 'Elegir ícono' })).toContainText('🍯');
  await modal.getByRole('button', { name: 'Elegir ícono' }).click();
  await page.getByRole('button', { name: 'Frutilla, mermelada' }).click();
  await expect(modal.getByRole('button', { name: /Ícono: 🍓/ })).toBeVisible();
  await page.screenshot({ path: info.outputPath('modal-nuevo-insumo.png') });

  await modal.getByRole('button', { name: 'Crear insumo' }).click();

  // --- Va a su ficha (ahí se cargan las presentaciones), con el ícono.
  await expect(page.getByRole('heading', { name: nombre })).toBeVisible();
  await expect(page.getByRole('button', { name: /Ícono: 🍓/ })).toBeVisible();

  // --- La barra de categorías: marcar una filtra; marcar otra suma.
  // La lista existe dos veces (tarjetas en el celular, tabla en la PC) y una
  // de las dos está oculta: se busca solo lo que se ve.
  const visible = (texto: string) =>
    page.getByText(texto, { exact: true }).filter({ visible: true }).first();
  await page.goto('/insumos');
  const barra = page.getByRole('group', { name: 'Filtrar por categoría' });
  const todas = barra.getByRole('button', { name: 'Todas' });
  const rellenos = barra.getByRole('button', { name: 'Rellenos y coberturas' });
  const harinas = barra.getByRole('button', { name: 'Harinas' });
  await expect(todas).toHaveAttribute('aria-pressed', 'true');

  await rellenos.click();
  await expect(rellenos).toHaveAttribute('aria-pressed', 'true');
  await expect(todas).toHaveAttribute('aria-pressed', 'false');
  await expect(visible(nombre)).toBeVisible();
  await expect(page.getByText('Harina 000', { exact: true })).toHaveCount(0);

  await harinas.click(); // la segunda: ahora son dos
  await expect(visible('Harina 000')).toBeVisible();
  await expect(visible(nombre)).toBeVisible();
  await page.screenshot({ path: info.outputPath('insumos-filtrados.png') });

  await rellenos.click(); // desmarcar una deja la otra
  await expect(page.getByText(nombre)).toHaveCount(0);
  await todas.click(); // "Todas" limpia
  await expect(harinas).toHaveAttribute('aria-pressed', 'false');

  expect(errores).toEqual([]);
});
