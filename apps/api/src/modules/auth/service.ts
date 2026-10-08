// CAPA 3 — SERVICIO: las reglas. No sabe que existe HTTP.
import { createHash, randomBytes } from 'node:crypto';

import { permisosDe, type LoginInput, type UsuarioSesion } from '@panaderia/shared';

import { registrarAuditoria } from '../../lib/auditoria.js';
import type { Contexto } from '../../lib/contexto.js';
import { prisma } from '../../lib/db.js';
import { errores } from '../../lib/errores.js';
import { LimitadorIntentos } from '../../lib/limitador.js';
import { hashearPassword, verificarPassword } from '../../lib/password.js';
import * as repo from './repo.js';

/** Cuánto vive una sesión sin usarse. */
const DURACION_SESION_MS = 7 * 24 * 60 * 60 * 1000;
/** Si queda menos de la mitad, se renueva al usarla (sesión "deslizante"). */
const UMBRAL_RENOVACION_MS = DURACION_SESION_MS / 2;
/** Cada cuánto, como máximo, se actualiza "último uso" (para no escribir en cada pedido). */
const INTERVALO_ULTIMO_USO_MS = 5 * 60 * 1000;

const QUINCE_MINUTOS = 15 * 60 * 1000;

/**
 * Dos limitadores, y los dos hacen falta:
 *   - por EMAIL frena a quien prueba contraseñas sobre una cuenta puntual,
 *     aunque rote de IP;
 *   - por IP frena a quien prueba una contraseña común contra muchas cuentas
 *     (password spraying), donde cada email recibe un solo intento.
 */
const limitePorEmail = new LimitadorIntentos({ limite: 5, ventanaMs: QUINCE_MINUTOS });
const limitePorIp = new LimitadorIntentos({ limite: 20, ventanaMs: QUINCE_MINUTOS });

/** Solo para los tests: deja los contadores de intentos en cero. */
export function reiniciarLimitadores(): void {
  limitePorEmail.limpiarTodo();
  limitePorIp.limpiarTodo();
}

/**
 * El token de sesión: 32 bytes aleatorios (256 bits).
 * base64url no usa "+", "/" ni "=", así que viaja en una cookie sin escapar.
 */
function generarToken(): string {
  return randomBytes(32).toString('base64url');
}

/**
 * En la base se guarda el hash del token, no el token.
 *
 * Acá SHA-256 es lo correcto, aunque para contraseñas usemos scrypt: el token
 * son 256 bits aleatorios, así que no hay nada que adivinar por fuerza bruta y
 * un hash lento solo agregaría 130 ms a CADA pedido. El hash lento se usa
 * cuando el secreto lo eligió una persona.
 */
export function hashearToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/**
 * Hash descartable contra el cual verificar cuando el email NO existe.
 *
 * ¿Para qué? Si no existiera el usuario y respondiéramos de inmediato, el
 * login tardaría 2 ms con un email inexistente y 130 ms con uno real. Midiendo
 * ese tiempo se puede averiguar qué emails están registrados. Verificando
 * siempre contra algo, los dos casos tardan lo mismo.
 */
let hashSenuelo: string | null = null;
async function gastarTiempoComoSiVerificara(password: string): Promise<void> {
  hashSenuelo ??= await hashearPassword('contraseña-que-no-existe');
  await verificarPassword(password, hashSenuelo);
}

export type MetadatosPedido = {
  ip: string | null;
  userAgent: string | null;
};

export type ResultadoLogin = {
  token: string;
  expiraAt: Date;
  /**
   * Los datos de la sesión, para que el frontend no tenga que pedir /auth/me
   * inmediatamente después de loguearse.
   */
  usuario: UsuarioSesion;
};

export async function login(entrada: LoginInput, meta: MetadatosPedido): Promise<ResultadoLogin> {
  const claveIp = meta.ip ?? 'sin-ip';

  // 1. ¿Está bloqueado por intentos previos?
  for (const [limitador, clave] of [
    [limitePorEmail, entrada.email],
    [limitePorIp, claveIp],
  ] as const) {
    const estado = limitador.verificar(clave);
    if (!estado.permitido) throw errores.demasiadosIntentos(estado.esperarSegundos);
  }

  const usuario = await repo.buscarUsuarioPorEmail(entrada.email);

  // 2. Credenciales. Un usuario inactivo se trata igual que uno inexistente:
  //    no hay que confirmarle a nadie que la cuenta existe.
  let passwordOk = false;
  if (usuario && usuario.activo) {
    passwordOk = await verificarPassword(entrada.password, usuario.passwordHash);
  } else {
    // Gastamos el mismo tiempo que si verificáramos, para que el tiempo de
    // respuesta no delate si el email existe.
    await gastarTiempoComoSiVerificara(entrada.password);
  }

  if (!usuario || !usuario.activo || !passwordOk) {
    limitePorEmail.registrarFallo(entrada.email);
    limitePorIp.registrarFallo(claveIp);

    // La auditoría del fallo se escribe SIEMPRE y fuera de cualquier
    // transacción: es justamente el registro que no debe perderse.
    await registrarAuditoria(prisma, {
      empresaId: usuario?.empresaId ?? null,
      usuarioId: usuario?.id ?? null,
      entidad: 'usuario',
      entidadId: usuario?.id ?? null,
      accion: 'LOGIN_FALLIDO',
      // Guardamos el email intentado (sirve para investigar) y JAMÁS la
      // contraseña, ni siquiera parcialmente.
      datosDespues: {
        email: entrada.email,
        motivo: !usuario ? 'inexistente' : !usuario.activo ? 'inactivo' : 'password',
      },
      ip: meta.ip,
    });

    throw errores.credencialesInvalidas();
  }

  // 3. Login correcto: se perdonan los intentos previos.
  limitePorEmail.limpiar(entrada.email);
  limitePorIp.limpiar(claveIp);

  const token = generarToken();
  const ahora = new Date();
  const expiraAt = new Date(ahora.getTime() + DURACION_SESION_MS);

  // Crear la sesión, marcar el acceso y auditar: las tres cosas o ninguna.
  await prisma.$transaction(async (tx) => {
    await tx.sesion.create({
      data: {
        usuarioId: usuario.id,
        tokenHash: hashearToken(token),
        expiraAt,
        ip: meta.ip,
        userAgent: meta.userAgent,
      },
    });
    await tx.usuario.update({ where: { id: usuario.id }, data: { ultimoAccesoAt: ahora } });
    await registrarAuditoria(tx, {
      empresaId: usuario.empresaId,
      usuarioId: usuario.id,
      entidad: 'usuario',
      entidadId: usuario.id,
      accion: 'LOGIN',
      ip: meta.ip,
    });
  });

  // Reusamos el mismo camino que usa /auth/me para armar la respuesta, en
  // lugar de duplicar la consulta: un solo lugar donde se decide qué datos de
  // la sesión salen del servidor.
  const ctx = await resolverContexto(token, meta.ip ?? undefined);
  if (!ctx) {
    // No debería pasar: acabamos de crear la sesión en la transacción anterior.
    throw new Error('No se pudo leer la sesión recién creada');
  }

  return { token, expiraAt, usuario: await datosDeSesion(ctx) };
}

export async function logout(ctx: Contexto): Promise<void> {
  const ahora = new Date();
  await prisma.$transaction(async (tx) => {
    await tx.sesion.updateMany({
      where: { id: ctx.sesionId, revocadaAt: null },
      data: { revocadaAt: ahora },
    });
    await registrarAuditoria(tx, {
      empresaId: ctx.empresaId,
      usuarioId: ctx.usuarioId,
      entidad: 'sesion',
      entidadId: ctx.sesionId,
      accion: 'LOGOUT',
      ip: ctx.ip ?? null,
    });
  });
}

/**
 * Convierte el token de la cookie en un Contexto, o devuelve null.
 *
 * Devuelve null (y no un error) para cualquier motivo de rechazo: token
 * inexistente, revocado, vencido o usuario desactivado. Quien llama decide qué
 * hacer; desde afuera todos esos casos se ven igual: no estás autenticado.
 */
export async function resolverContexto(
  token: string,
  ip: string | undefined,
): Promise<Contexto | null> {
  const sesion = await repo.buscarSesionPorTokenHash(hashearToken(token));
  if (!sesion) return null;

  const ahora = new Date();
  if (sesion.revocadaAt !== null) return null;
  if (sesion.expiraAt <= ahora) return null;
  if (!sesion.usuario.activo) return null;
  if (!sesion.usuario.empresa.activa) return null;

  const esDueno = sesion.usuario.rol === 'DUENO';

  // El DUEÑO puede operar en todas las sucursales de SU empresa. Se resuelve
  // acá, una vez, para que el resto del código no tenga que tratarlo como un
  // caso especial.
  const sucursalesPermitidas = esDueno
    ? (await repo.sucursalesDeEmpresa(sesion.usuario.empresaId)).map((s) => s.id)
    : sesion.usuario.sucursales
        .filter((union) => union.sucursal.activa)
        .map((union) => union.sucursalId);

  await renovarSiCorresponde(sesion.id, sesion.expiraAt, sesion.ultimoUsoAt, ahora);

  return {
    usuarioId: sesion.usuario.id,
    empresaId: sesion.usuario.empresaId,
    rol: sesion.usuario.rol,
    permisos: permisosDe(sesion.usuario.rol),
    sucursalesPermitidas,
    sesionId: sesion.id,
    ip,
  };
}

/**
 * Sesión "deslizante": se extiende sola mientras se use, para que al encargado
 * no se le corte la sesión en medio de un conteo. Pero no escribimos en la
 * base en CADA pedido: solo cuando hace falta.
 */
async function renovarSiCorresponde(
  sesionId: string,
  expiraAt: Date,
  ultimoUsoAt: Date | null,
  ahora: Date,
): Promise<void> {
  const leQuedaPoco = expiraAt.getTime() - ahora.getTime() < UMBRAL_RENOVACION_MS;
  const haceRatoQueNoSeUsa =
    ultimoUsoAt === null || ahora.getTime() - ultimoUsoAt.getTime() > INTERVALO_ULTIMO_USO_MS;

  if (!leQuedaPoco && !haceRatoQueNoSeUsa) return;

  await repo.tocarSesion(sesionId, {
    ultimoUsoAt: ahora,
    ...(leQuedaPoco ? { expiraAt: new Date(ahora.getTime() + DURACION_SESION_MS) } : {}),
  });
}

/** Lo que ve el frontend en GET /api/auth/me. */
export async function datosDeSesion(ctx: Contexto): Promise<UsuarioSesion> {
  const usuario = await prisma.usuario.findFirst({
    // Siempre con empresaId, aunque busquemos por id: es la regla del proyecto.
    where: { id: ctx.usuarioId, empresaId: ctx.empresaId },
    include: { empresa: true },
  });
  if (!usuario) throw errores.noAutenticado();

  const todas = await repo.sucursalesDeEmpresa(ctx.empresaId);
  const sucursales = todas.filter((sucursal) => ctx.sucursalesPermitidas.includes(sucursal.id));

  return {
    id: usuario.id,
    email: usuario.email,
    nombre: usuario.nombre,
    rol: usuario.rol,
    empresa: {
      id: usuario.empresa.id,
      nombre: usuario.empresa.nombre,
      zonaHoraria: usuario.empresa.zonaHoraria,
    },
    sucursales,
    permisos: [...ctx.permisos],
  };
}
