/**
 * EL ALTA DE PRODUCCIÓN: una empresa real, con su catálogo base, sus
 * sucursales y su dueño; y después, los demás usuarios.
 *
 * Es lo que reemplaza a la semilla en producción. La semilla NO puede correr
 * ahí: crea usuarios con la contraseña de desarrollo y una empresa ficticia,
 * y además resetea contraseñas cada vez que corre.
 *
 * Diferencias con la semilla, todas a propósito:
 *   - NO es idempotente: si el email del dueño ya existe, se niega. Dar de
 *     alta dos veces la misma empresa por error es peor que un error claro.
 *   - La contraseña NO está en el código ni en el archivo de datos: llega por
 *     una variable de entorno, y se valida con la misma regla que la API.
 *   - NO carga insumos ni proveedores: los carga el dueño desde la pantalla
 *     (respuesta C-4 del cliente). Solo lo que el sistema necesita para
 *     arrancar: unidades de medida, motivos y categorías.
 *
 * Lo usan alta-cli.ts (por línea de comandos) y los tests.
 */
import { CrearUsuarioSchema, PasswordNuevaSchema, RolSchema } from '@panaderia/shared';
import { z } from 'zod';

import type { PrismaClient } from '../src/generated/prisma/client.js';
import { hashearPassword } from '../src/lib/password.js';
import { MOTIVOS, UNIDADES } from './semilla.js';
import { CATEGORIAS } from './semilla-insumos.js';

const CodigoSucursal = z
  .string()
  .trim()
  .regex(
    /^[A-Z0-9]{2,6}$/,
    'El código de sucursal son 2 a 6 letras o números en mayúscula (CEN, LAF)',
  );

export const AltaEmpresaSchema = z.object({
  empresa: z.object({
    nombre: z.string().trim().min(1).max(120),
    razonSocial: z.string().trim().max(160).optional(),
    cuit: z
      .string()
      .trim()
      .regex(/^\d{11}$/, 'El CUIT son 11 dígitos, sin guiones')
      .optional(),
  }),
  sucursales: z
    .array(
      z.object({
        codigo: CodigoSucursal,
        nombre: z.string().trim().min(1).max(80),
        esCentral: z.boolean().default(false),
      }),
    )
    .min(1, 'Hace falta al menos una sucursal')
    .refine(
      (s) => s.filter((x) => x.esCentral).length <= 1,
      'Solo una sucursal puede ser la central',
    ),
  dueno: CrearUsuarioSchema.pick({ email: true, nombre: true }),
});
export type AltaEmpresaInput = z.input<typeof AltaEmpresaSchema>;

export const AltaUsuarioSchema = z.object({
  empresaId: z.uuid(),
  email: CrearUsuarioSchema.shape.email,
  nombre: CrearUsuarioSchema.shape.nombre,
  rol: RolSchema,
  /** Códigos de sucursal. El dueño no los necesita: accede a todas. */
  sucursales: z.array(CodigoSucursal).default([]),
});
export type AltaUsuarioInput = z.input<typeof AltaUsuarioSchema>;

/** Valida la contraseña con la MISMA regla que la API. Lanza si no sirve. */
function validarPassword(password: string | undefined): string {
  const resultado = PasswordNuevaSchema.safeParse(password ?? '');
  if (!resultado.success) {
    throw new Error(`Contraseña inválida: ${resultado.error.issues[0]?.message ?? ''}`);
  }
  return resultado.data;
}

export async function darDeAltaEmpresa(
  prisma: PrismaClient,
  entrada: AltaEmpresaInput,
  password: string | undefined,
): Promise<{ empresaId: string; duenoId: string }> {
  const datos = AltaEmpresaSchema.parse(entrada);
  const hash = await hashearPassword(validarPassword(password));
  const email = datos.dueno.email;

  if (await prisma.usuario.findUnique({ where: { email } })) {
    throw new Error(`Ya existe un usuario con el email ${email}: esta empresa ya se dio de alta.`);
  }

  // TODO en una transacción: o queda la empresa completa, o no queda nada.
  return prisma.$transaction(async (tx) => {
    const empresa = await tx.empresa.create({
      data: {
        nombre: datos.empresa.nombre,
        razonSocial: datos.empresa.razonSocial ?? null,
        cuit: datos.empresa.cuit ?? null,
        // C-11: sin IVA. El campo existe; el costo es lo que se pagó.
        costoIncluyeIva: true,
      },
      select: { id: true },
    });

    await tx.unidadMedida.createMany({
      data: UNIDADES.map((u) => ({ ...u, empresaId: empresa.id })),
    });
    await tx.motivoMovimiento.createMany({
      data: MOTIVOS.map((m) => ({ ...m, empresaId: empresa.id })),
    });
    await tx.categoriaInsumo.createMany({
      data: CATEGORIAS.map((nombre) => ({ nombre, empresaId: empresa.id })),
    });
    await tx.sucursal.createMany({
      data: datos.sucursales.map((s) => ({ ...s, empresaId: empresa.id })),
    });

    const dueno = await tx.usuario.create({
      data: {
        empresaId: empresa.id,
        email,
        nombre: datos.dueno.nombre,
        passwordHash: hash,
        rol: 'DUENO',
      },
      select: { id: true },
    });

    await tx.auditoria.create({
      data: {
        empresaId: empresa.id,
        entidad: 'empresa',
        entidadId: empresa.id,
        accion: 'CREAR',
        datosDespues: { ...datos, origen: 'alta de producción' },
      },
    });

    return { empresaId: empresa.id, duenoId: dueno.id };
  });
}

export async function darDeAltaUsuario(
  prisma: PrismaClient,
  entrada: AltaUsuarioInput,
  password: string | undefined,
): Promise<{ usuarioId: string }> {
  const datos = AltaUsuarioSchema.parse(entrada);
  const hash = await hashearPassword(validarPassword(password));

  const empresa = await prisma.empresa.findUnique({
    where: { id: datos.empresaId },
    select: { id: true, sucursales: { select: { id: true, codigo: true } } },
  });
  if (!empresa) throw new Error(`No existe la empresa ${datos.empresaId}.`);
  if (await prisma.usuario.findUnique({ where: { email: datos.email } })) {
    throw new Error(`Ya existe un usuario con el email ${datos.email}.`);
  }

  const sucursalIds = datos.sucursales.map((codigo) => {
    const sucursal = empresa.sucursales.find((s) => s.codigo === codigo);
    if (!sucursal) throw new Error(`La empresa no tiene una sucursal ${codigo}.`);
    return sucursal.id;
  });
  if (datos.rol !== 'DUENO' && sucursalIds.length === 0) {
    throw new Error('Un encargado o un empleado necesita al menos una sucursal.');
  }

  return prisma.$transaction(async (tx) => {
    const usuario = await tx.usuario.create({
      data: {
        empresaId: empresa.id,
        email: datos.email,
        nombre: datos.nombre,
        passwordHash: hash,
        rol: datos.rol,
      },
      select: { id: true },
    });
    if (sucursalIds.length > 0) {
      await tx.usuarioSucursal.createMany({
        data: sucursalIds.map((sucursalId) => ({ usuarioId: usuario.id, sucursalId })),
      });
    }
    await tx.auditoria.create({
      data: {
        empresaId: empresa.id,
        entidad: 'usuario',
        entidadId: usuario.id,
        accion: 'CREAR',
        datosDespues: { ...datos, origen: 'alta de producción' },
      },
    });
    return { usuarioId: usuario.id };
  });
}
