import { expect, type Page, test, type TestInfo } from '@playwright/test';

import { api, desplegable, elegir, entrar, sucursales, vigilarErrores } from './ayudas.js';

/**
 * EL MVP DE COMPRAS (Etapa 2, Fase 12a), en el celular y en la PC.
 *
 * Corre dos veces (proyectos "celular" y "pc" de playwright.config.ts). Lo
 * que más importa del celular no lo ve ningún test de la API: que nada se
 * salga de la pantalla y que los botones se puedan tocar.
 */

/** Cuánto se pasa el contenido del ancho de la pantalla (0 = entra justo). */
async function desborde(page: Page): Promise<number> {
  return page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
}

async function captura(page: Page, info: TestInfo, nombre: string): Promise<void> {
  await page.screenshot({ path: info.outputPath(`${nombre}.png`), fullPage: true });
}

test('compra 100 bolsas, le entregan 20 en Laferrere y 20 en Catán: le deben 60', async ({
  page,
}, info) => {
  const errores = vigilarErrores(page);
  await entrar(page, 'dueno@panaderia.test');
  const { laferrere } = await sucursales(page);

  // --- La compra, desde el botón de la pantalla principal.
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Lo que me deben' })).toBeVisible();
  await page.getByRole('link', { name: 'Nueva compra' }).click();
  await elegir(desplegable(page, 'Proveedor'), 'Molino San Jorge');
  await elegir(desplegable(page, 'Insumo'), 'Harina 0000');
  await page.getByLabel('Cuántas').fill('100');
  await page.getByLabel('Precio c/u').fill('20000');
  await page.getByRole('button', { name: 'Crear pedido' }).click();
  await expect(page.getByText('Pedida', { exact: true })).toBeVisible();
  const numero = (await page.getByRole('heading', { level: 1 }).textContent())?.match(
    /Compra (\d+)/,
  )?.[1];
  expect(numero).toBeDefined();
  const urlCompra = page.url();

  // --- Primera tanda: 20 bolsas, a Laferrere (C-28).
  await page.getByRole('link', { name: 'Registrar entrega' }).click();
  // El precio de la compra NO se vuelve a pedir (C-22): se muestra.
  await expect(page.getByLabel('Precio c/u')).toHaveCount(0);
  await expect(page.getByText('a $ 20.000,00 c/u')).toBeVisible();
  await desplegable(page, 'Sucursal').selectOption(laferrere);
  await page.getByLabel('Llegaron').fill('20');
  await captura(page, info, 'recibir');
  expect(await desborde(page)).toBe(0);
  await page.getByRole('button', { name: 'Registrar entrega' }).click();
  await expect(page.getByRole('heading', { name: /Entrega \d+/ })).toBeVisible();
  await expect(page.getByText('Laferrere').first()).toBeVisible();

  // --- Segunda tanda: 20 más, a la sucursal de la compra.
  await page.goto(urlCompra);
  await page.getByRole('link', { name: 'Registrar entrega' }).click();
  await page.getByLabel('Llegaron').fill('20');
  await page.getByRole('button', { name: 'Registrar entrega' }).click();
  await expect(page.getByRole('heading', { name: /Entrega \d+/ })).toBeVisible();

  // --- Lo que me deben: 60 bolsas de esa compra, $1.200.000.
  await page.getByRole('link', { name: 'Me deben' }).click();
  const renglon = page.getByRole('link', { name: new RegExp(`Compra ${numero ?? ''} ·`) });
  await expect(renglon.getByText('faltan 60 × Bolsa 25 kg')).toBeVisible();
  await expect(renglon.getByText('$ 1.200.000,00')).toBeVisible();
  // Y en las compras abiertas, con su avance: llegó 800.000 de 2.000.000.
  await expect(page.getByText('Llegó $ 800.000,00 de $ 2.000.000,00 (40%)').first()).toBeVisible();
  await captura(page, info, 'me-deben');
  expect(await desborde(page)).toBe(0);

  expect(errores).toEqual([]);
});

test('mi cuenta: cambia la contraseña y el email', async ({ page }, info) => {
  const errores = vigilarErrores(page);
  await entrar(page, 'dueno@panaderia.test');
  const { central } = await sucursales(page);
  const email = `cuenta-${String(Date.now())}-${info.project.name}@panaderia.test`;
  await api(page, 'POST', '/usuarios', {
    email,
    nombre: 'Cuenta e2e',
    rol: 'ENCARGADO',
    password: 'clave-inicial-1',
    sucursalIds: [central],
  });
  await page.getByRole('button', { name: 'Salir' }).click();
  // Esperar a ESTAR en el login: Mi cuenta también tiene campos de contraseña.
  await expect(page.getByRole('button', { name: 'Entrar' })).toBeVisible();

  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Contraseña').fill('clave-inicial-1');
  await page.getByRole('button', { name: 'Entrar' }).click();

  // El nombre del encabezado lleva a "Mi cuenta".
  await page.getByRole('link', { name: /Cuenta e2e/ }).click();
  await expect(page.getByRole('heading', { name: 'Mi cuenta' })).toBeVisible();

  // Una contraseña actual equivocada: el error aparece abajo del campo.
  await page.getByLabel('Contraseña actual').fill('no-es');
  await page.getByLabel('Contraseña nueva').fill('clave-nueva-22');
  await page.getByLabel('Repetí la nueva').fill('clave-nueva-22');
  await page.getByRole('button', { name: 'Cambiar contraseña' }).click();
  await expect(page.getByText('No es tu contraseña actual')).toBeVisible();

  await page.getByLabel('Contraseña actual').fill('clave-inicial-1');
  await page.getByRole('button', { name: 'Cambiar contraseña' }).click();
  await expect(page.getByText('Listo: la contraseña cambió.')).toBeVisible();

  const nuevo = `nuevo-${email}`;
  await page.getByLabel('Email nuevo').fill(nuevo);
  await page.getByLabel('Tu contraseña').fill('clave-nueva-22');
  await page.getByRole('button', { name: 'Cambiar email' }).click();
  await expect(page.getByText('Listo: desde ahora entrás con el email nuevo.')).toBeVisible();
  await expect(page.getByText(`entrás con ${nuevo}`)).toBeVisible();
  await captura(page, info, 'mi-cuenta');
  expect(await desborde(page)).toBe(0);

  // Y entra con lo nuevo.
  await page.getByRole('button', { name: 'Salir' }).click();
  // Esperar a ESTAR en el login: Mi cuenta también tiene campos de contraseña.
  await expect(page.getByRole('button', { name: 'Entrar' })).toBeVisible();
  await page.getByLabel('Email').fill(nuevo);
  await page.getByLabel('Contraseña').fill('clave-nueva-22');
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page.getByRole('button', { name: 'Salir' })).toBeVisible();

  // El único error esperado es el 400 de la contraseña equivocada.
  expect(errores.filter((e) => !e.includes('400 POST') && !e.includes('status of 400'))).toEqual(
    [],
  );
});

test('ninguna pantalla del MVP se sale de la pantalla', async ({ page }, info) => {
  const errores = vigilarErrores(page);
  await entrar(page, 'dueno@panaderia.test');

  // Ids reales para las pantallas de detalle.
  const ordenes = await api<{ items: { id: string }[] }>(page, 'GET', '/ordenes-compra?limite=1');
  const recepciones = await api<{ items: { id: string }[] }>(page, 'GET', '/recepciones?limite=1');
  const insumos = await api<{ items: { id: string }[] }>(page, 'GET', '/insumos?limite=1');
  const proveedores = await api<{ id: string }[]>(page, 'GET', '/proveedores');

  const rutas: [string, string][] = [
    ['inicio', '/'],
    ['compras', '/compras'],
    ['compra-nueva', '/compras/nueva'],
    ['compra', `/compras/${ordenes.items[0]?.id ?? ''}`],
    ['recepcion', `/recepciones/${recepciones.items[0]?.id ?? ''}`],
    ['plantillas', '/compras/plantillas'],
    ['proveedores', '/proveedores'],
    ['proveedor', `/proveedores/${proveedores[0]?.id ?? ''}`],
    ['proveedor-nuevo', '/proveedores/nuevo'],
    ['insumos', '/insumos'],
    ['insumo', `/insumos/${insumos.items[0]?.id ?? ''}`],
    ['insumo-nuevo', '/insumos/nuevo'],
    ['mi-cuenta', '/mi-cuenta'],
  ];

  const desbordadas: string[] = [];
  for (const [nombre, ruta] of rutas) {
    await page.goto(ruta);
    await page.waitForLoadState('networkidle');
    await captura(page, info, `pantalla-${nombre}`);
    const exceso = await desborde(page);
    if (exceso > 0) desbordadas.push(`${ruta} (+${String(exceso)} px)`);
  }
  expect(desbordadas).toEqual([]);
  expect(errores).toEqual([]);
});
