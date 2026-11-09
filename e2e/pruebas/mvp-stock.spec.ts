import { expect, test } from '@playwright/test';

import { api, entrar, saldo, sucursales, vigilarErrores } from './ayudas.js';

/**
 * EL INICIO: el stock y el acopio lado a lado, y descontar desde el stock sin
 * ir a otra pantalla ("Usé…" y "Se terminó").
 *
 * Corre en el celular y en la PC (proyectos de playwright.config.ts).
 */

test('desde el inicio: usé 2,5 kg y después se terminó', async ({ page }, info) => {
  const errores = vigilarErrores(page);
  await entrar(page, 'dueno@panaderia.test');
  const { central } = await sucursales(page);

  // Un insumo propio de esta prueba, con 10 kg en la Central.
  const kg = (await api<{ id: string; codigo: string }[]>(page, 'GET', '/unidades')).find(
    (u) => u.codigo === 'kg',
  );
  const nombre = `Harina stock e2e ${info.project.name} ${String(Date.now())}`;
  const insumo = await api<{ id: string }>(page, 'POST', '/insumos', {
    nombre,
    icono: '🌾',
    unidadBaseId: kg?.id,
  });
  await api(page, 'POST', '/movimientos/saldo-inicial', {
    sucursalId: central,
    lineas: [{ insumoId: insumo.id, cantidad: '10' }],
  });

  // --- El inicio: las dos secciones.
  await page.goto('/');
  await page
    .getByRole('group', { name: 'Sucursal' })
    .getByRole('button', { name: 'Central' })
    .click();
  await expect(page.getByRole('heading', { name: 'Stock' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Acopio' })).toBeVisible();

  const fila = page.getByRole('listitem').filter({ hasText: nombre });
  await expect(fila).toContainText('10 kg');

  // --- "Usé…": se escribe cuánto, con coma, como se escribe acá.
  await fila.getByRole('button', { name: 'Usé…' }).click();
  await fila.getByLabel(`Cuánto usaste de ${nombre}`).fill('2,5');
  await fila.getByRole('button', { name: 'Descontar' }).click();
  await expect(fila).toContainText('7,5 kg');
  expect(await saldo(page, insumo.id, central)).toBe('7.5');
  await page.screenshot({ path: info.outputPath('inicio-stock.png'), fullPage: true });

  // --- "Se terminó": pide confirmación y deja el stock en cero.
  await fila.getByRole('button', { name: 'Se terminó' }).click();
  const dialogo = page.getByRole('dialog');
  await expect(dialogo).toContainText('7,5 kg');
  await dialogo.getByRole('button', { name: 'Sí, se terminó' }).click();

  // Sin stock, deja de aparecer en la lista (muestra solo lo que hay).
  await expect(fila).toHaveCount(0);
  expect(await saldo(page, insumo.id, central)).toBe('0');

  // Y quedó como CONSUMO en el historial, que es lo que pasó.
  const historial = await api<{ items: { tipo: string; notas: string | null }[] }>(
    page,
    'GET',
    `/insumos/${insumo.id}/movimientos?sucursalId=${central}`,
  );
  expect(historial.items.map((m) => m.tipo)).toEqual(['CONSUMO', 'CONSUMO', 'SALDO_INICIAL']);
  expect(historial.items[0]?.notas).toBe('Se terminó');

  expect(errores).toEqual([]);
});
