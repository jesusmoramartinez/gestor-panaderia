import { afterAll, describe, expect, it } from 'vitest';

import { cerrarConexiones, prisma } from '../src/lib/db.js';

/**
 * LA BASE CERRADA PARA QUIEN NO ES LA API (Fase 11, por Supabase).
 *
 * Supabase publica las tablas de `public` por su API REST para el rol `anon`,
 * cuya clave es pública. La migración `seguridad_supabase` activa RLS en
 * todas las tablas: sin políticas, nadie que no sea el dueño ve una fila.
 * Estos tests verifican que siga así, también para las tablas FUTURAS.
 */

afterAll(async () => {
  await cerrarConexiones();
});

describe('RLS en toda la base', () => {
  it('TODAS las tablas tienen RLS activo (si agregás una tabla, agregale RLS en su migración)', async () => {
    const sinRls = await prisma.$queryRaw<{ tablename: string }[]>`
      SELECT tablename FROM pg_tables
      WHERE schemaname = 'public' AND NOT rowsecurity`;
    expect(sinRls.map((t) => t.tablename)).toEqual([]);
  });

  it('la vista del stock respeta el RLS de quien consulta (security_invoker)', async () => {
    const [vista] = await prisma.$queryRaw<{ opciones: string[] | null }[]>`
      SELECT reloptions AS opciones FROM pg_class WHERE relname = 'v_stock_actual'`;
    expect(vista?.opciones).toContain('security_invoker=true');
  });

  it('un rol que NO es el dueño (como el `anon` de Supabase) no ve ni una fila, aunque tenga permiso de lectura', async () => {
    // Hay movimientos en la base de prueba (los cargan los otros tests), pero
    // por las dudas se asegura que haya al menos una empresa con datos.
    expect(await prisma.empresa.count()).toBeGreaterThan(0);

    const resultado = await prisma
      .$transaction(async (tx) => {
        // Un rol nuevo, sin privilegios especiales: el equivalente de `anon`.
        await tx.$executeRawUnsafe('CREATE ROLE lector_de_prueba NOLOGIN');
        await tx.$executeRawUnsafe('GRANT USAGE ON SCHEMA public TO lector_de_prueba');
        // El peor caso: alguien le dio permiso de lectura a todo.
        await tx.$executeRawUnsafe(
          'GRANT SELECT ON ALL TABLES IN SCHEMA public TO lector_de_prueba',
        );
        await tx.$executeRawUnsafe('SET LOCAL ROLE lector_de_prueba');

        const empresas = await tx.$queryRaw<{ n: bigint }[]>`SELECT count(*) AS n FROM empresa`;
        const usuarios = await tx.$queryRaw<{ n: bigint }[]>`SELECT count(*) AS n FROM usuario`;
        const stock = await tx.$queryRaw<{ n: bigint }[]>`SELECT count(*) AS n FROM v_stock_actual`;
        // Se tira la transacción entera: el rol de prueba no queda en la base.
        throw new Error(
          `deshacer:${String(empresas[0]?.n)},${String(usuarios[0]?.n)},${String(stock[0]?.n)}`,
        );
      })
      .catch((error: unknown) => (error instanceof Error ? error.message : String(error)));

    // Tiene permiso de SELECT y aun así ve CERO filas: el RLS las esconde.
    expect(resultado).toBe('deshacer:0,0,0');
  });
});
