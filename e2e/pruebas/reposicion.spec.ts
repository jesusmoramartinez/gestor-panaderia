import { expect, test } from '@playwright/test';

import { api, desplegable, entrar, saldo, sucursales, vigilarErrores } from './ayudas.js';

/**
 * La Fase 10 desde la pantalla: el dueño abre el sistema, ve qué falta, y
 * con dos botones arma la transferencia desde la Central y la orden de compra.
 */
test('de la alerta a la transferencia y a la orden, con dos botones', async ({ page }) => {
  const errores = vigilarErrores(page);
  await entrar(page, 'dueno@panaderia.test');
  const { central, laferrere } = await sucursales(page);

  // Preparación por la API: una harina propia de la prueba, con proveedor
  // preferido que la vende en bolsas de 25 kg a $25.000.
  const unidades = await api<{ id: string; codigo: string }[]>(page, 'GET', '/unidades');
  const kg = unidades.find((u) => u.codigo === 'kg')?.id ?? '';
  const insumo = await api<{ id: string }>(page, 'POST', '/insumos', {
    nombre: 'Harina de reposición (e2e)',
    unidadBaseId: kg,
  });
  const conBolsa = await api<{ presentaciones: { id: string; nombre: string }[] }>(
    page,
    'POST',
    `/insumos/${insumo.id}/presentaciones`,
    { nombre: 'Bolsa 25 kg', cantidadBase: '25' },
  );
  const bolsa = conBolsa.presentaciones.find((p) => p.nombre === 'Bolsa 25 kg')?.id ?? '';
  const proveedor = await api<{ id: string }>(page, 'POST', '/proveedores', {
    nombre: 'Proveedor de reposición (e2e)',
  });
  await api(page, 'POST', `/proveedores/${proveedor.id}/insumos`, {
    insumoId: insumo.id,
    presentacionId: bolsa,
    ultimoPrecio: '25000',
    esPreferido: true,
  });
  // Central: hay 120, mínimo 100 → le sobran 20.
  // Laferrere: hay 10, mínimo 50, máximo 80 → faltan 70: 20 de la Central y 50 a comprar.
  await api(page, 'POST', '/movimientos/saldo-inicial', {
    sucursalId: central,
    lineas: [{ insumoId: insumo.id, cantidad: '120' }],
  });
  await api(page, 'POST', '/movimientos/saldo-inicial', {
    sucursalId: laferrere,
    lineas: [{ insumoId: insumo.id, cantidad: '10' }],
  });
  for (const [sucursalId, minimo, maximo] of [
    [central, '100', null],
    [laferrere, '50', '80'],
  ] as const) {
    const r = await page.request.put(`/api/insumos/${insumo.id}/sucursales/${sucursalId}`, {
      data: { stockMinimo: minimo, stockMaximo: maximo, activo: true },
    });
    expect(r.ok()).toBe(true);
  }

  // --- El inicio: la Central (la sucursal activa del dueño) está bien, porque
  // tiene 120 y su mínimo es 100. Lo que falta es en Laferrere.
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Hoy en Central' })).toBeVisible();

  // --- La reposición.
  await page.goto('/reposicion');
  await expect(page.getByRole('heading', { name: 'Reposición', exact: true })).toBeVisible();
  // El detalle está cerrado por defecto: se abre como lo haría una persona.
  await page.getByText('Detalle por sucursal').click();
  await expect(page.locator('details[open]')).toBeVisible();
  const detalle = page
    .locator('li', { hasText: 'Harina de reposición (e2e)' })
    .filter({ hasText: 'faltan' });
  await expect(detalle).toContainText('faltan 70 kg para llegar a 80');
  await expect(detalle).toContainText('20 desde la Central');
  await expect(detalle).toContainText('50 a comprar');

  // La tarjeta de la orden sugerida. `.last()`: la sección "Comprar" que la
  // contiene también "tiene" ese título adentro; la tarjeta es la más interna.
  const bloqueCompra = page
    .locator('section', {
      has: page.getByRole('heading', { name: /Proveedor de reposición \(e2e\) → Laferrere/ }),
    })
    .last();
  await expect(bloqueCompra).toContainText('2 × Bolsa 25 kg (50 kg)');
  await expect(bloqueCompra).toContainText('$ 50.000,00');
  // Lo que ve la tablet al abrir la pantalla, sin desplazarse.
  await page.evaluate(() => {
    window.scrollTo(0, 0);
  });
  await page.screenshot({ path: 'resultados/reposicion.png' });

  // --- Botón 1: la transferencia desde la Central, precargada.
  await page.getByRole('button', { name: 'Armar la transferencia' }).click();
  await expect(page.getByRole('heading', { name: 'Enviar desde Central' })).toBeVisible();
  await expect(desplegable(page, 'Sucursal de destino')).toHaveValue(laferrere);
  await expect(page.getByLabel('Cantidad').first()).toHaveValue('20');
  await page.getByRole('button', { name: 'Enviar', exact: true }).click();
  await expect(page.getByText('en tránsito')).toBeVisible();
  expect(await saldo(page, insumo.id, central)).toBe('100');

  // Lo que viene en camino ya no se sugiere de nuevo.
  await page.goto('/reposicion');
  // El detalle está cerrado por defecto: se abre como lo haría una persona.
  await page.getByText('Detalle por sucursal').click();
  await expect(page.locator('details[open]')).toBeVisible();
  await expect(
    page.locator('li', { hasText: 'Harina de reposición (e2e)' }).filter({ hasText: 'en camino' }),
  ).toContainText('en camino 20 kg');
  await expect(page.getByRole('button', { name: 'Armar la transferencia' })).toHaveCount(0);

  // --- Botón 2: la orden de compra, precargada.
  await bloqueCompra.getByRole('button', { name: 'Crear orden con esto' }).click();
  await expect(page.getByText('Precargada desde la reposición')).toBeVisible();
  await expect(desplegable(page, 'Proveedor')).toHaveValue(proveedor.id);
  await expect(desplegable(page, 'Sucursal que recibe')).toHaveValue(laferrere);
  await expect(page.getByLabel('Cuántas')).toHaveValue('2');
  await expect(page.getByText('$ 50.000,00')).toBeVisible();
  await page.getByRole('button', { name: 'Crear pedido' }).click();
  await expect(page.getByText('Pedida', { exact: true })).toBeVisible();

  // Con la orden pedida, ya no hay nada que comprar para este insumo.
  await page.goto('/reposicion');
  // El detalle está cerrado por defecto: se abre como lo haría una persona.
  await page.getByText('Detalle por sucursal').click();
  await expect(page.locator('details[open]')).toBeVisible();
  await expect(
    page.locator('li', { hasText: 'Harina de reposición (e2e)' }).filter({ hasText: 'ya pedido' }),
  ).toContainText('cubierto con lo que ya viene');

  expect(errores).toEqual([]);
});
