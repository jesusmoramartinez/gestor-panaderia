import { once } from 'node:events';
import type { AddressInfo } from 'node:net';

import { crearApp } from '../src/app.js';

export type Respuesta = {
  status: number;
  cuerpo: unknown;
  /** Los encabezados Set-Cookie crudos, para poder revisar sus atributos. */
  setCookie: string[];
};

/**
 * Cliente HTTP para los tests.
 *
 * Levanta la app de Express en un puerto libre (el 0 significa "elegí uno
 * libre") y le pega con fetch. Es un test de integración de verdad: pasa por
 * los middlewares, por las cookies y por la base, igual que el navegador.
 *
 * Guarda las cookies entre pedidos, como hace un navegador: es lo que permite
 * loguearse en un test y seguir autenticado en el pedido siguiente.
 */
export class ClienteHttp {
  private readonly cookies = new Map<string, string>();

  private constructor(
    private readonly base: string,
    private readonly cerrarServidor: () => Promise<void>,
  ) {}

  static async levantar(): Promise<ClienteHttp> {
    const servidor = crearApp().listen(0, '127.0.0.1');
    await once(servidor, 'listening');
    const { port } = servidor.address() as AddressInfo;

    return new ClienteHttp(`http://127.0.0.1:${String(port)}`, async () => {
      servidor.close();
      await once(servidor, 'close');
    });
  }

  async pedir(metodo: string, ruta: string, cuerpo?: unknown): Promise<Respuesta> {
    const headers = new Headers();
    if (cuerpo !== undefined) headers.set('content-type', 'application/json');

    const cookieHeader = [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; ');
    if (cookieHeader.length > 0) headers.set('cookie', cookieHeader);

    const respuesta = await fetch(`${this.base}${ruta}`, {
      method: metodo,
      headers,
      body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
    });

    const setCookie = respuesta.headers.getSetCookie();
    this.guardarCookies(setCookie);

    const texto = await respuesta.text();
    return {
      status: respuesta.status,
      cuerpo: texto.length === 0 ? null : (JSON.parse(texto) as unknown),
      setCookie,
    };
  }

  /**
   * Un pedido sin procesar: devuelve la Response de fetch tal cual, para los
   * tests que miran cabeceras o mandan cuerpos que no son JSON.
   */
  crudo(ruta: string, init?: RequestInit): Promise<Response> {
    return fetch(`${this.base}${ruta}`, init);
  }

  get = (ruta: string) => this.pedir('GET', ruta);
  post = (ruta: string, cuerpo?: unknown) => this.pedir('POST', ruta, cuerpo);

  /** El valor crudo de la cookie de sesión, para poder reusarla o manipularla. */
  cookie(nombre: string): string | undefined {
    return this.cookies.get(nombre);
  }

  ponerCookie(nombre: string, valor: string): void {
    this.cookies.set(nombre, valor);
  }

  olvidarCookies(): void {
    this.cookies.clear();
  }

  async cerrar(): Promise<void> {
    await this.cerrarServidor();
  }

  private guardarCookies(encabezados: readonly string[]): void {
    for (const encabezado of encabezados) {
      const [par] = encabezado.split(';');
      if (!par) continue;
      const separador = par.indexOf('=');
      if (separador < 0) continue;

      const nombre = par.slice(0, separador).trim();
      const valor = par.slice(separador + 1).trim();

      // Un valor vacío es cómo el servidor borra una cookie (res.clearCookie).
      if (valor.length === 0) this.cookies.delete(nombre);
      else this.cookies.set(nombre, valor);
    }
  }
}
