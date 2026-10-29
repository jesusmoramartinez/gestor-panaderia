#!/usr/bin/env bash
# Despliega en el VPS exactamente el commit que está en GitHub (origin/main).
#
#   pnpm deploy:vps        (o scripts/deploy.sh)
#
# 1. Verifica que no haya cambios sin commitear ni sin subir a GitHub.
# 2. Arma la imagen en la laptop desde ese commit (git archive: solo lo
#    versionado; nunca .env ni backups) con la etiqueta FECHA-COMMIT.
# 3. La manda comprimida al servidor por SSH (docker save | docker load).
# 4. En el servidor, /srv/panaderia/actualizar.sh hace backup de la base,
#    corre las migraciones y activa la versión nueva.
#
# Volver atrás: ssh vps 'sudo /srv/panaderia/actualizar.sh <etiqueta-anterior>'
# (ver docs/deploy-vps.md). Variables: SERVIDOR (por defecto "vps").
set -euo pipefail
cd "$(dirname "$0")/.."
SERVIDOR="${SERVIDOR:-vps}"

git fetch -q origin
if [ -n "$(git status --porcelain --untracked-files=no)" ]; then
    echo "Hay cambios sin commitear. Commiteá y subí a GitHub antes de desplegar." >&2; exit 1
fi
if [ "$(git rev-parse HEAD)" != "$(git rev-parse origin/main)" ]; then
    echo "Lo local no coincide con GitHub (origin/main): hacé git push (o git pull) primero." >&2; exit 1
fi

ETIQUETA="$(date +%Y-%m-%d)-$(git rev-parse --short=7 HEAD)"
IMAGEN="panaderia-api:$ETIQUETA"
echo "== Imagen $IMAGEN (commit de GitHub)"
git archive --format=tar HEAD | docker build -t "$IMAGEN" -

echo "== Enviando al servidor ($SERVIDOR)"
docker save "$IMAGEN" | gzip -1 | ssh "$SERVIDOR" 'gunzip | sudo docker load'

echo "== Activando en el servidor"
ssh "$SERVIDOR" "sudo /srv/panaderia/actualizar.sh $ETIQUETA"
