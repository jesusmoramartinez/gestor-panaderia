-- ===========================================================================
-- SEGURIDAD PARA SUPABASE (Fase 11), escrita a mano.
--
-- EL RIESGO: Supabase publica automáticamente las tablas del esquema `public`
-- por su API REST ("Data API", PostgREST), para los roles `anon` y
-- `authenticated`. La clave `anon` se considera PÚBLICA por diseño. Si las
-- tablas quedaran así, cualquiera con esa clave podría leer y escribir la
-- base salteándose TODA nuestra API: los permisos, el aislamiento entre
-- empresas, el motor de stock.
--
-- Nosotros no usamos esa API: la aplicación se conecta a Postgres directo,
-- como el rol dueño de las tablas. Entonces se cierra todo, en tres capas:
--
--   1. RLS (Row Level Security) en TODAS las tablas, sin ninguna política.
--      Con RLS activo y sin políticas, nadie ve ni una fila... salvo el
--      DUEÑO de la tabla, que no está sujeto a RLS. Ese es el rol con el que
--      se conecta la API, así que a ella no le cambia nada.
--   2. La vista v_stock_actual pasa a `security_invoker`: por defecto una
--      vista consulta con los permisos de quien la CREÓ (el dueño), lo que
--      la convertiría en un agujero que se saltea el RLS de la tabla.
--   3. Si existen los roles de Supabase, se les sacan todos los permisos.
--      (En desarrollo y en el CI esos roles no existen: el bloque no hace
--      nada.)
--
-- Y en la guía de despliegue: apagar la Data API del proyecto. Cuatro capas,
-- cada una por si falla la anterior.
--
-- Un test (test/seguridad-base.test.ts) falla si una tabla nueva se crea
-- sin RLS.
-- ===========================================================================

DO $$
DECLARE
  tabla record;
BEGIN
  FOR tabla IN
    SELECT tablename FROM pg_tables WHERE schemaname = 'public'
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', tabla.tablename);
  END LOOP;
END
$$;

ALTER VIEW "v_stock_actual" SET (security_invoker = true);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon, authenticated;
    REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon, authenticated;
    REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM anon, authenticated;
    -- Y para las tablas que se creen DESPUÉS (las próximas migraciones).
    ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM anon, authenticated;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM anon, authenticated;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON FUNCTIONS FROM anon, authenticated;
  END IF;
END
$$;
