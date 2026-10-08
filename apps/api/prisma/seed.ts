/**
 * Seed: carga los datos iniciales de desarrollo.
 *
 * Es IDEMPOTENTE: se puede correr cien veces y el resultado es siempre el
 * mismo. Eso se logra con `upsert` ("insertá si no existe, actualizá si
 * existe") en lugar de `create` (que fallaría la segunda vez o duplicaría).
 *
 * Correr con:  pnpm db:seed
 */
import { env } from '../src/config/env.js';
import { cerrarConexiones, prisma } from '../src/lib/db.js';
import { hashearPassword } from '../src/lib/password.js';

// ===========================================================================
// DATOS DEL CLIENTE — cambiá estos valores por los reales
// ===========================================================================

const EMPRESA = {
  // Id FIJO a propósito. La tabla `empresa` no tiene otra columna única por la
  // cual buscarla, así que un id fijo es lo que hace que el upsert encuentre
  // siempre la misma fila en lugar de crear una empresa nueva en cada corrida.
  id: '11111111-1111-1111-1111-111111111111',
  // TODO(cliente): nombre provisorio, falta confirmarlo con el dueño.
  nombre: 'Panadería Laferrere',
  razonSocial: null,
  cuit: null,
  // Supuesto de la pregunta C-11 del PLAN.md: monotributista, así que el IVA
  // que paga es parte del costo del insumo. Si es responsable inscripto, esto
  // pasa a false y el costo se registra neto.
  costoIncluyeIva: true,
};

const SUCURSALES = [
  {
    codigo: 'CEN',
    nombre: 'Central',
    esCentral: true,
    direccion: null,
    telefono: null,
  },
  {
    codigo: 'LAF',
    nombre: 'Laferrere',
    esCentral: false,
    direccion: null,
    telefono: null,
  },
] as const;

/**
 * Contraseña única para todos los usuarios de desarrollo.
 * Es visible a propósito: son datos de prueba. El seed se niega a correr en
 * producción (ver la guarda más abajo), así que esto nunca llega a un servidor.
 */
const PASSWORD_DEV = 'panaderia123';

const USUARIOS = [
  {
    email: 'dueno@panaderia.test',
    nombre: 'Dueño',
    rol: 'DUENO',
    // El DUEÑO accede a todas las sucursales de su empresa sin filas en
    // usuario_sucursal: lo resuelve el middleware de permisos (Fase 2).
    sucursales: [],
  },
  {
    email: 'encargado@panaderia.test',
    nombre: 'Encargado',
    rol: 'ENCARGADO',
    // Cubre las dos panaderías: justo el caso que justificó la decisión de
    // "un usuario, varias sucursales" (PLAN.md, decisión 3).
    sucursales: ['CEN', 'LAF'],
  },
  {
    email: 'empleado@panaderia.test',
    nombre: 'Empleado',
    rol: 'EMPLEADO',
    sucursales: ['LAF'],
  },
] as const;

// ===========================================================================

async function main(): Promise<void> {
  // Guarda de seguridad: este script BORRA y REESCRIBE datos. Nunca debe
  // correr contra la base de producción.
  if (env.NODE_ENV === 'production') {
    throw new Error('El seed no se ejecuta en producción (NODE_ENV=production).');
  }

  console.log(`[seed] base: ${ocultarPassword(env.DATABASE_URL)}`);

  // Hasheamos ANTES de abrir la transacción: cada hasheo tarda ~130 ms a
  // propósito, y no conviene tener la transacción abierta mientras esperamos.
  const hashes = new Map<string, string>();
  for (const usuario of USUARIOS) {
    hashes.set(usuario.email, await hashearPassword(PASSWORD_DEV));
  }

  // Todo en UNA transacción: si algo falla a mitad de camino, no queda una
  // empresa sin sucursales ni un usuario sin permisos.
  await prisma.$transaction(async (tx) => {
    const empresa = await tx.empresa.upsert({
      where: { id: EMPRESA.id },
      create: EMPRESA,
      update: {
        nombre: EMPRESA.nombre,
        razonSocial: EMPRESA.razonSocial,
        cuit: EMPRESA.cuit,
        costoIncluyeIva: EMPRESA.costoIncluyeIva,
      },
    });

    const sucursalesPorCodigo = new Map<string, string>();
    for (const sucursal of SUCURSALES) {
      const fila = await tx.sucursal.upsert({
        // empresaId_codigo es el nombre que Prisma le da a la clave única
        // compuesta @@unique([empresaId, codigo]) del schema.
        where: { empresaId_codigo: { empresaId: empresa.id, codigo: sucursal.codigo } },
        create: { ...sucursal, empresaId: empresa.id },
        update: {
          nombre: sucursal.nombre,
          esCentral: sucursal.esCentral,
          direccion: sucursal.direccion,
          telefono: sucursal.telefono,
        },
      });
      sucursalesPorCodigo.set(sucursal.codigo, fila.id);
    }

    for (const usuario of USUARIOS) {
      const hash = hashes.get(usuario.email);
      if (!hash) throw new Error(`Falta el hash de ${usuario.email}`);

      const fila = await tx.usuario.upsert({
        where: { email: usuario.email },
        create: {
          empresaId: empresa.id,
          email: usuario.email,
          nombre: usuario.nombre,
          passwordHash: hash,
          rol: usuario.rol,
        },
        update: {
          nombre: usuario.nombre,
          rol: usuario.rol,
          passwordHash: hash,
          activo: true,
        },
      });

      // Para las asignaciones de sucursal, el seed declara el estado FINAL:
      // borra las que haya y crea las que corresponden. Así, si mañana cambiás
      // la lista de arriba, la corrida siguiente refleja el cambio en lugar de
      // ir acumulando asignaciones viejas.
      await tx.usuarioSucursal.deleteMany({ where: { usuarioId: fila.id } });
      if (usuario.sucursales.length > 0) {
        await tx.usuarioSucursal.createMany({
          data: usuario.sucursales.map((codigo) => {
            const sucursalId = sucursalesPorCodigo.get(codigo);
            if (!sucursalId) throw new Error(`No existe la sucursal ${codigo}`);
            return { usuarioId: fila.id, sucursalId };
          }),
        });
      }
    }
  });

  await resumen();
}

async function resumen(): Promise<void> {
  const empresas = await prisma.empresa.findMany({
    include: {
      sucursales: { orderBy: { codigo: 'asc' } },
      usuarios: {
        orderBy: { email: 'asc' },
        include: { sucursales: { include: { sucursal: true } } },
      },
    },
  });

  for (const empresa of empresas) {
    console.log(`\n[seed] Empresa: ${empresa.nombre}`);
    for (const sucursal of empresa.sucursales) {
      const marca = sucursal.esCentral ? ' (CENTRAL)' : '';
      console.log(`         sucursal ${sucursal.codigo} — ${sucursal.nombre}${marca}`);
    }
    for (const usuario of empresa.usuarios) {
      const donde =
        usuario.rol === 'DUENO'
          ? 'todas las sucursales'
          : usuario.sucursales.map((union) => union.sucursal.codigo).join(', ') || 'ninguna';
      console.log(`         ${usuario.rol.padEnd(9)} ${usuario.email.padEnd(28)} → ${donde}`);
    }
  }

  console.log(`\n[seed] Contraseña de desarrollo para todos: ${PASSWORD_DEV}`);
  console.log('[seed] Listo.');
}

/** No imprimir la contraseña de la base en la consola ni en los logs. */
function ocultarPassword(url: string): string {
  return url.replace(/:\/\/([^:]+):[^@]+@/, '://$1:***@');
}

try {
  await main();
} finally {
  await cerrarConexiones();
}
