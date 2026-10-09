import { expect, test } from '@playwright/test';

import {
  api,
  desplegable,
  elegir,
  entrar,
  PASSWORD,
  saldo,
  sucursales,
  vigilarErrores,
} from './ayudas.js';

/**
 * La Fase 9 con DOS personas en dos sucursales: el dueño despacha desde la
 * Central y una encargada que solo trabaja en Laferrere confirma lo que llegó.
 */
test('enviar 20 kg, llegan 18 y la diferencia queda como merma en el destino', async ({ page }) => {
  const errores = vigilarErrores(page);
  await entrar(page, 'dueno@panaderia.test');
  const { central, laferrere } = await sucursales(page);

  // Preparación por la API (no es lo que se prueba): un insumo propio de esta
  // prueba, con saldo en la Central, y una encargada solo de Laferrere.
  const unidades = await api<{ id: string; codigo: string }[]>(page, 'GET', '/unidades');
  const kg = unidades.find((u) => u.codigo === 'kg')?.id ?? '';
  const insumo = await api<{ id: string }>(page, 'POST', '/insumos', {
    nombre: 'Harina de transferencia (e2e)',
    unidadBaseId: kg,
  });
  await api(page, 'POST', '/movimientos/saldo-inicial', {
    sucursalId: central,
    lineas: [{ insumoId: insumo.id, cantidad: '50' }],
  });
  const email = `encargada-laf-${String(Date.now())}@panaderia.test`;
  await api(page, 'POST', '/usuarios', {
    email,
    nombre: 'Encargada Laferrere',
    rol: 'ENCARGADO',
    password: PASSWORD,
    sucursalIds: [laferrere],
  });

  // --- El dueño despacha.
  await page.goto('/transferencias');
  await page.getByRole('link', { name: 'Enviar a otra sucursal' }).click();
  await elegir(desplegable(page, 'Sucursal de destino'), 'Laferrere');
  await elegir(desplegable(page, 'Insumo'), 'Harina de transferencia (e2e)');
  await expect(page.getByText('Hay 50 kg en Central')).toBeVisible();
  await page.getByLabel('Cantidad').fill('20');
  await page.getByRole('button', { name: 'Enviar', exact: true }).click();

  await expect(page.getByText('en tránsito')).toBeVisible();
  // Desde el ORIGEN no se pregunta "¿qué llegó?" (bug encontrado en el navegador).
  await expect(page.getByText('¿Qué llegó?')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Anular el envío' })).toBeVisible();
  expect(await saldo(page, insumo.id, central)).toBe('30');
  expect(await saldo(page, insumo.id, laferrere)).toBe('0');

  // --- La encargada de Laferrere la confirma.
  await page.getByRole('button', { name: 'Salir' }).click();
  await entrar(page, email);
  await page.goto('/transferencias');
  await page
    .getByRole('link', { name: /desde Central/ })
    .first()
    .click();
  await expect(page.getByRole('button', { name: 'Anular el envío' })).toHaveCount(0);
  await page.getByLabel('Llegaron').fill('18');
  await expect(page.getByText('faltan 2 kg: se registra como merma')).toBeVisible();
  await page.getByRole('button', { name: 'Confirmar recepción' }).click();

  await expect(page.getByText('faltaron 2 kg (merma)')).toBeVisible();
  expect(await saldo(page, insumo.id, laferrere)).toBe('18');

  await page.goto(`/stock/${insumo.id}`);
  await expect(page.getByText('Diferencia en transferencia')).toBeVisible();

  expect(errores).toEqual([]);
});
