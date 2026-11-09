import { expect, type Page, test } from '@playwright/test';

import { api, entrar, sucursales, vigilarErrores } from './ayudas.js';

/**
 * PAGOS Y COMPROBANTES (Etapa 2, Fase 12b), en el celular y en la PC.
 *
 * Lo que solo ve un navegador: que la foto se achica y se manda, que la
 * miniatura CARGA (la política de seguridad de la página no la bloquea) y que
 * el visor la abre grande.
 */

/** Una "foto" de 1200×900 dibujada en un canvas, como la mandaría el teléfono. */
async function fotoDePrueba(page: Page): Promise<Buffer> {
  const base64 = await page.evaluate(() => {
    const lienzo = document.createElement('canvas');
    lienzo.width = 1200;
    lienzo.height = 900;
    const ctx = lienzo.getContext('2d');
    if (!ctx) return '';
    ctx.fillStyle = '#e0f2fe';
    ctx.fillRect(0, 0, 1200, 900);
    ctx.fillStyle = '#0c4a6e';
    ctx.font = 'bold 80px sans-serif';
    ctx.fillText('Comprobante $ 2.000.000', 60, 450);
    return lienzo.toDataURL('image/png').split(',')[1] ?? '';
  });
  return Buffer.from(base64, 'base64');
}

/** ¿La imagen se cargó de verdad? (naturalWidth 0 = no llegó o la bloquearon). */
async function cargoLaImagen(page: Page, selector: string): Promise<boolean> {
  return page
    .locator(selector)
    .first()
    .evaluate(async (img) => {
      const imagen = img as HTMLImageElement;
      if (!imagen.complete) await new Promise((listo) => imagen.addEventListener('load', listo));
      return imagen.naturalWidth > 0;
    });
}

test('paga con la captura, entrega con la foto del remito, y anula el pago', async ({
  page,
}, info) => {
  const errores = vigilarErrores(page);
  await entrar(page, 'dueno@panaderia.test');
  const { central } = await sucursales(page);

  // La compra se prepara por la API: lo que se prueba acá es el pago.
  const proveedores = await api<{ id: string; nombre: string }[]>(page, 'GET', '/proveedores');
  const molino = proveedores.find((p) => p.nombre === 'Molino San Jorge');
  const insumos = await api<{ items: { id: string; nombre: string }[] }>(
    page,
    'GET',
    '/insumos?busqueda=Harina%200000',
  );
  const compra = await api<{ id: string; numero: number }>(page, 'POST', '/ordenes-compra', {
    sucursalId: central,
    proveedorId: molino?.id,
    lineas: [{ insumoId: insumos.items[0]?.id, cantidad: '100', precioUnitario: '20000' }],
  });
  await page.goto(`/compras/${compra.id}`);
  await expect(page.getByText('Sin pagar').first()).toBeVisible();

  // --- El pago: el monto viene con lo que falta, escrito como lo escribe él.
  await page.getByRole('button', { name: 'Registrar pago' }).click();
  await expect(page.getByLabel('Monto')).toHaveValue('2.000.000');
  await page.getByText('Mercado Pago', { exact: true }).click();
  await page.getByLabel('Sacar foto o elegir captura').setInputFiles({
    name: 'captura-mp.png',
    mimeType: 'image/png',
    buffer: await fotoDePrueba(page),
  });
  await expect(page.getByRole('img', { name: 'Imagen 1' })).toBeVisible();
  await page.screenshot({ path: info.outputPath('pago-formulario.png'), fullPage: true });
  await page.getByRole('button', { name: 'Guardar pago' }).click();

  await expect(page.getByText('Pagada', { exact: true }).first()).toBeVisible();
  await expect(page.getByText(/· Mercado Pago · \d/)).toBeVisible();
  // La miniatura carga de verdad (la CSP permite las imágenes del propio sitio).
  const miniatura = page.getByRole('button', { name: 'Ver Comprobante de pago 1' });
  await expect(miniatura).toBeVisible();
  expect(await cargoLaImagen(page, 'button[aria-label="Ver Comprobante de pago 1"] img')).toBe(
    true,
  );
  await miniatura.click();
  const visor = page.getByRole('dialog', { name: 'Comprobante de pago' });
  await expect(visor).toBeVisible();
  expect(await cargoLaImagen(page, 'dialog[open] img')).toBe(true);
  await page.screenshot({ path: info.outputPath('pago-visor.png') });
  await visor.getByRole('button', { name: 'Cerrar' }).click();
  await expect(visor).toBeHidden();
  await page.screenshot({ path: info.outputPath('compra-pagada.png'), fullPage: true });

  // --- Una entrega, con la foto del remito.
  await page.getByRole('link', { name: 'Registrar entrega' }).click();
  await page.getByLabel('Llegaron').fill('30');
  await page.getByLabel('Sacar foto o elegir captura').setInputFiles({
    name: 'remito.png',
    mimeType: 'image/png',
    buffer: await fotoDePrueba(page),
  });
  await expect(page.getByRole('img', { name: 'Imagen 1' })).toBeVisible();
  await page.getByRole('button', { name: 'Registrar entrega' }).click();
  await expect(page.getByRole('heading', { name: /Entrega \d+/ })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Ver Remito 1' })).toBeVisible();
  expect(await cargoLaImagen(page, 'button[aria-label="Ver Remito 1"] img')).toBe(true);

  // --- Lo que me deben: pagó todo y llegaron 30 → tiene $1.400.000 suyos ahí.
  await page.getByRole('link', { name: 'Acopio' }).click();
  await expect(page.getByRole('heading', { name: 'Acopio' })).toBeVisible();
  const plataTuya = page
    .getByRole('heading', { name: 'Plata tuya en los proveedores' })
    .locator('..');
  await expect(plataTuya).not.toContainText('$ 0,00');

  // --- Anular el pago: vuelve a "Sin pagar", y el pago queda tachado con el motivo.
  await page.goto(`/compras/${compra.id}`);
  await page.getByRole('button', { name: 'Anular', exact: true }).click();
  await page.getByPlaceholder(/Cargué un cero de más/).fill('lo cargué en la compra equivocada');
  await page.getByRole('button', { name: 'Anular pago' }).click();
  await expect(page.getByText('Sin pagar').first()).toBeVisible();
  // Aparece en el pago tachado y en el historial.
  await expect(page.getByText(/lo cargué en la compra equivocada/)).toHaveCount(2);

  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    ),
  ).toBe(0);
  expect(errores).toEqual([]);
});

test('un archivo que no es imagen no se puede elegir como comprobante', async ({ page }) => {
  await entrar(page, 'dueno@panaderia.test');
  const { central } = await sucursales(page);
  const proveedores = await api<{ id: string; nombre: string }[]>(page, 'GET', '/proveedores');
  const insumos = await api<{ items: { id: string }[] }>(page, 'GET', '/insumos?limite=1');
  const compra = await api<{ id: string }>(page, 'POST', '/ordenes-compra', {
    sucursalId: central,
    proveedorId: proveedores[0]?.id,
    lineas: [{ insumoId: insumos.items[0]?.id, cantidad: '1', precioUnitario: '100' }],
  });
  await page.goto(`/compras/${compra.id}`);
  await page.getByRole('button', { name: 'Registrar pago' }).click();
  await page.getByLabel('Sacar foto o elegir captura').setInputFiles({
    name: 'factura.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from('%PDF-1.4 no es una imagen'),
  });
  await expect(page.getByText('"factura.pdf" no es una imagen.')).toBeVisible();
  await expect(page.getByRole('img', { name: 'Imagen 1' })).toHaveCount(0);
});

test('el historial muestra todo en orden, y se puede dejar una nota', async ({ page }, info) => {
  const errores = vigilarErrores(page);
  await entrar(page, 'dueno@panaderia.test');
  const { central } = await sucursales(page);
  const proveedores = await api<{ id: string; nombre: string }[]>(page, 'GET', '/proveedores');
  const molino = proveedores.find((p) => p.nombre === 'Molino San Jorge');
  const insumos = await api<{ items: { id: string }[] }>(
    page,
    'GET',
    '/insumos?busqueda=Harina%200000',
  );
  const compra = await api<{ id: string; lineas: { id: string }[] }>(
    page,
    'POST',
    '/ordenes-compra',
    {
      sucursalId: central,
      proveedorId: molino?.id,
      lineas: [{ insumoId: insumos.items[0]?.id, cantidad: '10', precioUnitario: '1000' }],
    },
  );
  await api(page, 'POST', `/ordenes-compra/${compra.id}/pagos`, {
    monto: '10000',
    medio: 'EFECTIVO',
  });
  await api(page, 'POST', `/ordenes-compra/${compra.id}/recepciones`, {
    lineas: [{ lineaOrdenId: compra.lineas[0]?.id, cantidad: '4', precioUnitario: '1000' }],
  });

  await page.goto(`/compras/${compra.id}`);
  const historial = page
    .locator('section')
    .filter({ has: page.getByRole('heading', { name: 'Historial' }) });
  await expect(historial.getByRole('listitem')).toHaveCount(3);
  await expect(historial.getByRole('listitem').nth(0)).toContainText('Compra creada y pedida');
  await expect(historial.getByRole('listitem').nth(1)).toContainText('· Efectivo');
  await expect(historial.getByRole('listitem').nth(2)).toContainText(/Entrega \d+ en Central/);

  await page.getByPlaceholder(/Anotar algo/).fill('la próxima viene el 19');
  await page.getByRole('button', { name: 'Agregar nota' }).click();
  await expect(historial.getByRole('listitem')).toHaveCount(4);
  await expect(historial.getByRole('listitem').nth(3)).toContainText('«la próxima viene el 19»');
  await expect(page.getByPlaceholder(/Anotar algo/)).toHaveValue('');
  await historial.screenshot({ path: info.outputPath('historial.png') });

  expect(errores).toEqual([]);
});
