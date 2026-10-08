import type { CrearUsuarioInput, UsuarioResumen } from '@panaderia/shared';

import { registrarAuditoria } from '../../lib/auditoria.js';
import type { Contexto } from '../../lib/contexto.js';
import { prisma } from '../../lib/db.js';
import { AppError, errores } from '../../lib/errores.js';
import { hashearPassword } from '../../lib/password.js';
import * as repo from './repo.js';

/** Lo que viene de la base a lo que sale por la API. */
type FilaUsuario = Awaited<ReturnType<typeof repo.listarPorEmpresa>>[number];

function aResumen(fila: FilaUsuario): UsuarioResumen {
  return {
    id: fila.id,
    email: fila.email,
    nombre: fila.nombre,
    rol: fila.rol,
    activo: fila.activo,
    // Por la red las fechas viajan en UTC como texto ISO; el frontend las
    // muestra en hora de Argentina.
    ultimoAccesoAt: fila.ultimoAccesoAt?.toISOString() ?? null,
    sucursales: fila.sucursales.map((union) => union.sucursal),
  };
}

export async function listar(ctx: Contexto): Promise<UsuarioResumen[]> {
  const filas = await repo.listarPorEmpresa(ctx.empresaId);
  return filas.map(aResumen);
}

export async function crear(ctx: Contexto, entrada: CrearUsuarioInput): Promise<UsuarioResumen> {
  // Regla 1: el email es único a nivel global.
  const existente = await repo.buscarPorEmail(entrada.email);
  if (existente) {
    throw new AppError('EMAIL_DUPLICADO', 'Ya hay una cuenta con ese email.', 409);
  }

  // Regla 2: las sucursales asignadas tienen que ser de MI empresa. Sin este
  // chequeo, el dueño de una panadería podría asignarle a su empleado una
  // sucursal de otra empresa pasando su UUID.
  if (entrada.sucursalIds.length > 0) {
    const propias = await repo.contarSucursalesDeEmpresa(ctx.empresaId, entrada.sucursalIds);
    if (propias !== entrada.sucursalIds.length) {
      throw errores.datosInvalidos({
        sucursalIds: 'Alguna de las sucursales indicadas no existe en tu empresa.',
      });
    }
  }

  // El hasheo va ANTES de abrir la transacción: tarda ~130 ms a propósito y no
  // conviene tener la transacción abierta esperando.
  const passwordHash = await hashearPassword(entrada.password);

  const creado = await prisma.$transaction(async (tx) => {
    const usuario = await tx.usuario.create({
      data: {
        empresaId: ctx.empresaId,
        email: entrada.email,
        nombre: entrada.nombre,
        rol: entrada.rol,
        passwordHash,
        sucursales: {
          create: entrada.sucursalIds.map((sucursalId) => ({ sucursalId })),
        },
      },
      select: { id: true },
    });

    await registrarAuditoria(tx, {
      empresaId: ctx.empresaId,
      usuarioId: ctx.usuarioId,
      entidad: 'usuario',
      entidadId: usuario.id,
      accion: 'CREAR',
      // La contraseña NO se audita, ni hasheada. Lo que no hace falta
      // guardar, no se guarda.
      datosDespues: {
        email: entrada.email,
        nombre: entrada.nombre,
        rol: entrada.rol,
        sucursalIds: entrada.sucursalIds,
      },
      ip: ctx.ip ?? null,
    });

    return usuario.id;
  });

  const fila = await repo.buscarEnEmpresa(ctx.empresaId, creado);
  if (!fila) throw errores.noEncontrado('El usuario');
  return aResumen(fila);
}
