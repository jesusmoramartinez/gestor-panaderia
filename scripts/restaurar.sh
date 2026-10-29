#!/usr/bin/env bash
# =============================================================================
# RESTAURAR un backup en una base NUEVA (local).
#
# Uso:
#   pnpm db:restaurar ~/backups/panaderia/panaderia-20261030T120000Z.sql.gpg panaderia_restaurada
#   pnpm db:restaurar backups/diarios/panaderia-2026-10-09.dump panaderia_restaurada
#
# Dos formatos:
#   .sql.gpg  los del VPS (backup-proyecto, en el repo infra): SQL plano cifrado
#             con gpg. Pide la clave (la del gestor de contraseñas), o la lee de
#             BACKUP_PASSPHRASE_FILE. Se descifra al vuelo: el SQL sin cifrar
#             nunca se escribe en el disco.
#   .dump     los de `pnpm db:backup` (formato custom de pg_dump).
#
# Crea la base de destino (falla si ya existe: restaurar ENCIMA de una base
# con datos mezcla lo viejo con lo nuevo y no hay forma de saber qué quedó).
#
# SOLO restaura en el Postgres local del docker-compose de desarrollo: no
# recibe ninguna URL, así que no puede apuntar al servidor por accidente (y la
# base del servidor ni siquiera publica puertos). Recuperar producción es otro
# procedimiento, a mano y con aprobación: docs/operacion.md.
# =============================================================================
set -euo pipefail

cd "$(dirname "$0")/.."
ARCHIVO="${1:?Falta el archivo .sql.gpg o .dump}"
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

if [[ "$ARCHIVO" == *.gpg ]]; then
  echo "[restaurar] descifrando y restaurando $ARCHIVO ..."
  GPG=(gpg --quiet --decrypt)
  if [[ -n "${BACKUP_PASSPHRASE_FILE:-}" ]]; then
    GPG=(gpg --quiet --batch --pinentry-mode loopback --passphrase-file "$BACKUP_PASSPHRASE_FILE" --decrypt)
  fi
  # --single-transaction + ON_ERROR_STOP: o entra todo, o no entra nada.
  "${GPG[@]}" "$ARCHIVO" | "${PSQL[@]}" --quiet --single-transaction -d "$DESTINO" >/dev/null
else
  # Toda base nueva trae un esquema "public" vacío, y el .dump (hecho con
  # --schema=public) trae el suyo: con --exit-on-error, el restore se frenaba
  # en la primera línea. Lo encontró el primer simulacro. Se borra el vacío.
  "${PSQL[@]}" -d "$DESTINO" -c "DROP SCHEMA public"
  echo "[restaurar] restaurando $ARCHIVO ..."
  # --exit-on-error: al primer error, para. Un restore "a medias" que siguió
  # de largo es el peor resultado posible: parece que anduvo.
  docker compose exec -T db pg_restore -U "$POSTGRES_USER" -d "$DESTINO" \
    --no-owner --no-privileges --exit-on-error < "$ARCHIVO"
fi

echo "[restaurar] listo. Filas por tabla:"
# ANALYZE primero: actualiza las estadísticas, que es de donde sale n_live_tup.
"${PSQL[@]}" -d "$DESTINO" -c "ANALYZE" >/dev/null
"${PSQL[@]}" -d "$DESTINO" -c "
  SELECT relname AS tabla, n_live_tup AS filas
  FROM pg_stat_user_tables WHERE n_live_tup > 0 ORDER BY relname"
