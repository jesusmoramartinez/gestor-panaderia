/**
 * Carga los datos iniciales de desarrollo en la base del .env.
 *
 * Los datos y la lógica viven en semilla.ts, para que los tests puedan
 * reutilizarlos contra otra base.
 *
 * Correr con:  pnpm db:seed
 */
import { env } from '../src/config/env.js';
import { cerrarConexiones, prisma } from '../src/lib/db.js';
import { EMPRESAS, PASSWORD_DEV, sembrar } from './semilla.js';

async function main(): Promise<void> {
  // Guarda de seguridad: este script reescribe datos. Nunca debe correr
  // contra la base de producción.
  if (env.NODE_ENV === 'production') {
    throw new Error('El seed no se ejecuta en producción (NODE_ENV=production).');
  }

  console.log(`[seed] base: ${ocultarPassword(env.DATABASE_URL)}`);
  await sembrar(prisma);
  await resumen();
}

async function resumen(): Promise<void> {
  const empresas = await prisma.empresa.findMany({
    orderBy: { nombre: 'asc' },
    include: {
      _count: { select: { categorias: true, insumos: true, unidades: true, proveedores: true } },
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
    console.log(
      `         ${String(empresa._count.categorias).padStart(3)} categorías · ` +
        `${String(empresa._count.insumos).padStart(3)} insumos · ` +
        `${String(empresa._count.unidades).padStart(3)} unidades · ` +
        `${String(empresa._count.proveedores).padStart(3)} proveedores`,
    );
    for (const usuario of empresa.usuarios) {
      const donde =
        usuario.rol === 'DUENO'
          ? 'todas las sucursales'
          : usuario.sucursales.map((union) => union.sucursal.codigo).join(', ') || 'ninguna';
      console.log(`         ${usuario.rol.padEnd(9)} ${usuario.email.padEnd(28)} → ${donde}`);
    }
  }

  console.log(`\n[seed] Contraseña de desarrollo para todos: ${PASSWORD_DEV}`);
  console.log(`[seed] ${String(EMPRESAS.length)} empresas sembradas. Listo.`);
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
