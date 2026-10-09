/**
 * Limitador de intentos (rate limit) con ventana deslizante.
 *
 * ¿Qué problema resuelve? Sin esto, un script puede probar miles de
 * contraseñas por minuto contra el login. El hasheo con scrypt tarda ~130 ms,
 * lo que ya frena bastante, pero no alcanza: hay que cortar antes.
 *
 * "Ventana deslizante" significa que se cuentan los intentos de los últimos N
 * minutos contados desde AHORA, no desde el comienzo de un bloque fijo. Con
 * bloques fijos, alguien puede gastar el límite al final de un bloque y otra
 * vez al principio del siguiente, duplicando los intentos permitidos.
 *
 * El estado vive en memoria. Para una panadería con un solo servidor alcanza;
 * si algún día hay varios, esto se mueve a Redis (anotado en PLAN.md).
 */

/** Permite inyectar el reloj para poder testear sin esperar 15 minutos. */
export type Reloj = () => number;

export type ResultadoLimite =
  { permitido: true } | { permitido: false; esperarMs: number; esperarSegundos: number };

export type OpcionesLimitador = {
  /** Cuántos intentos fallidos se permiten dentro de la ventana. */
  limite: number;
  ventanaMs: number;
  reloj?: Reloj;
};

export class LimitadorIntentos {
  private readonly fallos = new Map<string, number[]>();
  private readonly limite: number;
  private readonly ventanaMs: number;
  private readonly reloj: Reloj;

  constructor(opciones: OpcionesLimitador) {
    this.limite = opciones.limite;
    this.ventanaMs = opciones.ventanaMs;
    this.reloj = opciones.reloj ?? Date.now;
  }

  /** ¿Puede intentar? No registra nada: solo consulta. */
  verificar(clave: string): ResultadoLimite {
    const vigentes = this.vigentes(clave);
    if (vigentes.length < this.limite) return { permitido: true };

    // El bloqueo se levanta cuando el intento más viejo sale de la ventana.
    const masViejo = vigentes[0] ?? this.reloj();
    const esperarMs = Math.max(0, masViejo + this.ventanaMs - this.reloj());
    return {
      permitido: false,
      esperarMs,
      esperarSegundos: Math.ceil(esperarMs / 1000),
    };
  }

  /** Se llama cuando el intento SALIÓ MAL. Los aciertos no se cuentan. */
  registrarFallo(clave: string): void {
    const vigentes = this.vigentes(clave);
    vigentes.push(this.reloj());
    this.fallos.set(clave, vigentes);
  }

  /**
   * Cuenta un evento cualquiera (no un fallo): lo usa el límite GENERAL de
   * pedidos, que cuenta todos. Es lo mismo que registrarFallo, con el nombre
   * que corresponde a ese uso.
   */
  registrar(clave: string): void {
    this.registrarFallo(clave);
  }

  /** Se llama cuando el login funciona: borra el historial de esa clave. */
  limpiar(clave: string): void {
    this.fallos.delete(clave);
  }

  /** Borra todo. Lo usan los tests para empezar de cero. */
  limpiarTodo(): void {
    this.fallos.clear();
  }

  /** Cuántas claves tiene en memoria (para los tests y para diagnóstico). */
  get clavesEnMemoria(): number {
    return this.fallos.size;
  }

  /**
   * Devuelve los intentos que todavía están dentro de la ventana y, de paso,
   * descarta los viejos. Limpiar al leer evita que el Map crezca para siempre
   * sin necesidad de un temporizador aparte.
   */
  private vigentes(clave: string): number[] {
    const ahora = this.reloj();
    const limiteInferior = ahora - this.ventanaMs;
    const previos = this.fallos.get(clave) ?? [];
    const vigentes = previos.filter((momento) => momento > limiteInferior);

    if (vigentes.length === 0) this.fallos.delete(clave);
    else if (vigentes.length !== previos.length) this.fallos.set(clave, vigentes);

    return vigentes;
  }
}
