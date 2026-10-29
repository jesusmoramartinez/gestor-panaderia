#!/usr/bin/env bash
# =============================================================================
# BACKUP MANUAL: baja a la laptop un backup de la base del VPS, cuando quieras.
#
#   pnpm backup:bajar            hace un backup AHORA en el servidor y lo baja
#   pnpm backup:bajar --ultimo   baja el último que ya está en el servidor
#
# El backup de ahora es el mismo de todos los días (backup@panaderia.service):
# queda también en el servidor y, si hubo cambios, en Google Drive. Lo que baja
# es el .sql.gpg tal cual, CIFRADO: se abre con `pnpm db:restaurar` y la clave
# del gestor de contraseñas. Variables: SERVIDOR (por defecto "vps").
# =============================================================================
set -euo pipefail

SERVIDOR="${SERVIDOR:-vps}"
REMOTA=/srv/backups/panaderia/automaticos
DESTINO="${DESTINO:-$HOME/backups/panaderia}"

if [[ "${1:-}" != "--ultimo" ]]; then
  echo "[bajar] haciendo un backup ahora en el servidor ..."
  ssh "$SERVIDOR" 'sudo systemctl start backup@panaderia.service'
  ssh "$SERVIDOR" 'sudo tail -n 2 /var/log/backup-panaderia.log'
fi

NOMBRE="$(ssh "$SERVIDOR" "sudo ls -1t $REMOTA" | grep '\.sql\.gpg$' | head -n 1)"
[[ -n "$NOMBRE" ]] || { echo "No hay backups en $SERVIDOR:$REMOTA" >&2; exit 1; }

install -d -m 700 "$DESTINO"
if [[ -f "$DESTINO/$NOMBRE" ]]; then
  echo "[bajar] ya lo tenías: $DESTINO/$NOMBRE"
  exit 0
fi

echo "[bajar] bajando $NOMBRE ..."
ssh "$SERVIDOR" "sudo cat $REMOTA/$NOMBRE" > "$DESTINO/$NOMBRE.part"
# Que llegue entero: la misma huella acá y allá.
REMOTO_SHA="$(ssh "$SERVIDOR" "sudo sha256sum $REMOTA/$NOMBRE" | cut -d' ' -f1)"
LOCAL_SHA="$(sha256sum "$DESTINO/$NOMBRE.part" | cut -d' ' -f1)"
if [[ "$REMOTO_SHA" != "$LOCAL_SHA" ]]; then
  rm -f "$DESTINO/$NOMBRE.part"
  echo "El archivo llegó distinto (sha256 no coincide). Probá de nuevo." >&2
  exit 1
fi
mv "$DESTINO/$NOMBRE.part" "$DESTINO/$NOMBRE"
chmod 600 "$DESTINO/$NOMBRE"
echo "[bajar] listo: $DESTINO/$NOMBRE ($(du -h "$DESTINO/$NOMBRE" | cut -f1))"
echo "[bajar] para abrirlo: pnpm db:restaurar $DESTINO/$NOMBRE panaderia_restaurada"
