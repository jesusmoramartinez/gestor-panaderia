import { expect, type Locator, type Page } from '@playwright/test';

export const PASSWORD = 'panaderia123';

/** Entra con un usuario de la semilla (o uno creado en la prueba). */
export async function entrar(page: Page, email: string): Promise<void> {
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Contraseña').fill(PASSWORD);
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page.getByRole('button', { name: 'Salir' })).toBeVisible();
}

/**
 * Elige en un <select> la opción cuyo texto EMPIEZA con `texto`.
 *
 * `selectOption({ label })` de Playwright pide el texto exacto, y varias
 * opciones del sistema llevan algo más: "Harina 000 ★", "Harina 000 (hay
 * 50 kg)". Además espera a que la opción exista: muchas listas se llenan con
 * un pedido a la API después de que la pantalla aparece.
 */
export async function elegir(select: Locator, texto: string): Promise<void> {
  const opcion = select.locator('option').filter({ hasText: texto }).first();
  await expect(opcion).toBeAttached();
  const valor = await opcion.getAttribute('value');
  await select.selectOption(valor ?? '');
}

/**
 * Un <select> por su etiqueta, comparando cómo EMPIEZA su nombre accesible.
 *
 * `getByLabel('Insumo')` no alcanza: el nombre accesible de un control
 * incluye todo el texto de su <label>, y la etiqueta "Unidad" contiene la
 * opción "La del insumo". Buscando "empieza con Insumo" no hay ambigüedad.
 */
export function desplegable(page: Page, etiqueta: string): Locator {
  const escapada = etiqueta.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return page.getByRole('combobox', { name: new RegExp(`^${escapada}`) });
}

/** Lo que dice el desplegable ahora: lo que VE la persona. */
export async function textoElegido(select: Locator): Promise<string> {
  return select.evaluate((el) => {
    const s = el as HTMLSelectElement;
    return s.selectedOptions[0]?.textContent ?? '';
  });
}

/** Llama a la API con la sesión del navegador (para preparar datos, no para probar). */
export async function api<T>(
  page: Page,
  metodo: 'GET' | 'POST',
  ruta: string,
  cuerpo?: unknown,
): Promise<T> {
  const respuesta =
    metodo === 'GET'
      ? await page.request.get(`/api${ruta}`)
      : await page.request.post(`/api${ruta}`, { data: cuerpo ?? {} });
  expect(
    respuesta.ok(),
    `${metodo} ${ruta}: ${String(respuesta.status())} ${await respuesta.text()}`,
  ).toBe(true);
  return (await respuesta.json()) as T;
}

/** El saldo de un insumo en una sucursal, leído por la API. */
export async function saldo(page: Page, insumoId: string, sucursalId: string): Promise<string> {
  const historial = await api<{ saldo: string }>(
    page,
    'GET',
    `/insumos/${insumoId}/movimientos?sucursalId=${sucursalId}`,
  );
  return historial.saldo;
}

type Sesion = { sucursales: { id: string; codigo: string }[] };

export async function sucursales(page: Page): Promise<{ central: string; laferrere: string }> {
  const yo = await api<Sesion>(page, 'GET', '/auth/me');
  const id = (codigo: string) => yo.sucursales.find((s) => s.codigo === codigo)?.id ?? '';
  return { central: id('CEN'), laferrere: id('LAF') };
}

/**
 * Junta los errores que ve el navegador: excepciones de la página y
 * respuestas HTTP con error. Al final de la prueba se verifica que no haya
 * ninguno: fue exactamente el síntoma del bug de la Fase 8 (un 400 que la
 * pantalla se tragaba en silencio).
 */
export function vigilarErrores(page: Page): string[] {
  const errores: string[] = [];
  page.on('pageerror', (error) => errores.push(`excepción: ${error.message}`));
  // Los errores de consola incluyen las violaciones de la política de
  // contenido (CSP): si la CSP de producción bloquea algo del front, sale acá.
  page.on('console', (mensaje) => {
    if (mensaje.type() === 'error') errores.push(`consola: ${mensaje.text()}`);
  });
  page.on('response', (respuesta) => {
    if (respuesta.status() >= 400 && !respuesta.url().endsWith('/favicon.ico')) {
      errores.push(
        `HTTP ${String(respuesta.status())} ${respuesta.request().method()} ${respuesta.url()}`,
      );
    }
  });
  return errores;
}
