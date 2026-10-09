-- ===========================================================================
-- VISTA v_stock_actual (Fase 10), escrita a mano.
--
-- Una VISTA es una consulta guardada en la base con nombre propio: se usa como
-- si fuera una tabla (`SELECT ... FROM v_stock_actual`), pero no guarda datos.
-- Cada vez que se consulta, Postgres ejecuta la consulta de adentro.
--
-- ¿Por qué una vista y no una tabla de saldos? Porque el stock NUNCA se
-- guarda (regla 9 de CLAUDE.md): sigue siendo la suma de los movimientos.
-- La vista solo le pone nombre a esa suma, para poder cruzarla con los
-- mínimos de `insumo_sucursal` en un JOIN que hace Postgres y no JavaScript.
--
-- ¿Y no es lenta? Postgres no la calcula entera y después filtra: cuando la
-- consulta de afuera filtra por empresa, sucursal o insumo (las columnas del
-- GROUP BY), ese filtro "baja" adentro de la vista y usa el índice
-- (empresa_id, sucursal_id, insumo_id, fecha). Está verificado con EXPLAIN
-- ANALYZE en docs/aprendizaje/18-fase-10-reposicion.md.
-- ===========================================================================

CREATE VIEW "v_stock_actual" AS
SELECT
  "empresa_id",
  "sucursal_id",
  "insumo_id",
  SUM("cantidad_base") AS "saldo",
  COUNT(*)::int        AS "movimientos"
FROM "movimiento_stock"
GROUP BY "empresa_id", "sucursal_id", "insumo_id";
