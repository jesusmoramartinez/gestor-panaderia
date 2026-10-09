#!/usr/bin/env bash
# =============================================================================
# BACKUP de la base: pg_dump en formato "custom" (comprimido, y se puede
# restaurar tabla por tabla), con RETENCIÓN de 7 diarios + 4 semanales.
#
# Uso:
#   DATABASE_URL=postgresql://... ./scripts/backup.sh [carpeta]
#
# Sin DATABASE_URL, usa la del .env (la base de desarrollo).
# La carpeta por defecto es ./backups (está en .gitignore: un backup con datos
# reales NUNCA va al repositorio).
#
# pg_dump corre adentro de un contenedor de Docker con la MISMA versión de
# Postgres que el servidor (PG_IMAGEN): no hace falta instalar nada, y un
# pg_dump más viejo que el servidor se niega a trabajar.
# =============================================================================
set -euo pipefail

cd "$(dirname "$0")/.."
CARPETA="${1:-backups}"
PG_IMAGEN="${PG_IMAGEN:-postgres:18}"

if [[ -z "${DATABASE_URL:-}" ]]; then
  # shellcheck disable=SC1091
  set -a && source .env && set +a
fi

mkdir -p "$CARPETA/diarios" "$CARPETA/semanales"
HOY="$(date +%F)"
ARCHIVO="$CARPETA/diarios/panaderia-$HOY.dump"

echo "[backup] volcando la base en $ARCHIVO ..."
# --schema=public: solo nuestras tablas. En Supabase hay otros esquemas
#   (auth, storage...) que son de la plataforma y no se restauran nosotros.
# --no-owner --no-privileges: el backup no depende de qué usuario lo creó,
#   así se puede restaurar en otra base, con otro usuario.
# --user: el archivo queda a nombre tuyo y no de root (si no, la retención de
#   abajo no podría borrarlo).
docker run --rm --network host --user "$(id -u):$(id -g)" -v "$PWD/$CARPETA:/backups" "$PG_IMAGEN" \
  pg_dump "$DATABASE_URL" --format=custom --schema=public --no-owner --no-privileges \
  --file="/backups/diarios/panaderia-$HOY.dump"

# Un backup vacío o roto es peor que ninguno: da una falsa tranquilidad.
# pg_restore --list lee el índice del archivo; si está dañado, falla acá.
TABLAS=$(docker run --rm -v "$PWD/$CARPETA:/backups" "$PG_IMAGEN" \
  pg_restore --list "/backups/diarios/panaderia-$HOY.dump" | grep -c "TABLE DATA" || true)
if [[ "$TABLAS" -lt 10 ]]; then
  echo "[backup] ERROR: el archivo tiene solo $TABLAS tablas con datos. Algo salió mal." >&2
  exit 1
fi
echo "[backup] ok: $TABLAS tablas, $(du -h "$ARCHIVO" | cut -f1)"

# Los domingos, una copia semanal.
if [[ "$(date +%u)" == "7" ]]; then
  cp "$ARCHIVO" "$CARPETA/semanales/panaderia-$(date +%G-S%V).dump"
fi

# RETENCIÓN: los 7 diarios y los 4 semanales más nuevos; el resto se borra.
# (ls -1t ordena del más nuevo al más viejo.)
ls -1t "$CARPETA"/diarios/*.dump 2>/dev/null | tail -n +8 | xargs -r rm --
ls -1t "$CARPETA"/semanales/*.dump 2>/dev/null | tail -n +5 | xargs -r rm --
echo "[backup] quedan $(ls "$CARPETA"/diarios | wc -l) diarios y $(ls "$CARPETA"/semanales | wc -l) semanales"
