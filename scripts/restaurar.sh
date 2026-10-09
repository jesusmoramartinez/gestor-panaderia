#!/usr/bin/env bash
# =============================================================================
# RESTAURAR un backup en una base NUEVA.
#
# Uso:
#   ./scripts/restaurar.sh backups/diarios/panaderia-2026-10-09.dump panaderia_restaurada
#
# Crea la base de destino (falla si ya existe: restaurar ENCIMA de una base
# con datos mezcla lo viejo con lo nuevo y no hay forma de saber qué quedó).
# Usa el Postgres del docker-compose. Para restaurar en producción, ver
# docs/operacion.md: el procedimiento es el mismo con otra URL.
#
# Si el backup está cifrado (.dump.gpg, los de GitHub Actions), primero:
#   gpg --decrypt panaderia.dump.gpg > panaderia.dump
# =============================================================================
set -euo pipefail

cd "$(dirname "$0")/.."
ARCHIVO="${1:?Falta el archivo .dump}"
DESTINO="${2:?Falta el nombre de la base de destino}"

[[ -f "$ARCHIVO" ]] || { echo "No existe $ARCHIVO" >&2; exit 1; }
[[ "$DESTINO" =~ ^[a-z_][a-z0-9_]*$ ]] || { echo "Nombre de base inválido: $DESTINO" >&2; exit 1; }

# shellcheck disable=SC1091
set -a && source .env && set +a
PSQL=(docker compose exec -T db psql -U "$POSTGRES_USER" -v ON_ERROR_STOP=1)

if "${PSQL[@]}" -d postgres -tAc "SELECT 1 FROM pg_database WHERE datname = '$DESTINO'" | grep -q 1; then
  echo "La base $DESTINO ya existe. Elegí otro nombre o borrala a mano si estás seguro." >&2
  exit 1
fi

echo "[restaurar] creando la base $DESTINO ..."
"${PSQL[@]}" -d postgres -c "CREATE DATABASE \"$DESTINO\""
# Toda base nueva trae un esquema "public" vacío, y el backup trae el suyo
# (CREATE SCHEMA public): con --exit-on-error, el restore se frenaba en la
# primera línea. Lo encontró el primer simulacro. Se borra el vacío, que en
# una base recién creada no tiene nada adentro.
"${PSQL[@]}" -d "$DESTINO" -c "DROP SCHEMA public"

echo "[restaurar] restaurando $ARCHIVO ..."
# --exit-on-error: al primer error, para. Un restore "a medias" que siguió
# de largo es el peor resultado posible: parece que anduvo.
docker compose exec -T db pg_restore -U "$POSTGRES_USER" -d "$DESTINO" \
  --no-owner --no-privileges --exit-on-error < "$ARCHIVO"

echo "[restaurar] listo. Filas por tabla:"
# ANALYZE primero: actualiza las estadísticas, que es de donde sale n_live_tup.
"${PSQL[@]}" -d "$DESTINO" -c "ANALYZE" >/dev/null
"${PSQL[@]}" -d "$DESTINO" -c "
  SELECT relname AS tabla, n_live_tup AS filas
  FROM pg_stat_user_tables WHERE n_live_tup > 0 ORDER BY relname"
