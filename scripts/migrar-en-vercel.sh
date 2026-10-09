#!/usr/bin/env bash
# =============================================================================
# Aplica las migraciones pendientes durante el build de Vercel, SOLO en el
# despliegue de PRODUCCIÓN.
#
# Vercel construye también una "preview" por cada rama y pull request, y
# todas comparten las variables de entorno que se marquen para Preview. Una
# preview NUNCA tiene que tocar la base de producción: por eso la guarda de
# VERCEL_ENV (Vercel la pone sola: production | preview | development).
#
# `migrate deploy` (y nunca `migrate dev`): aplica las migraciones que ya
# están escritas y commiteadas, en orden, y nada más. No genera migraciones,
# no compara el schema, no resetea nada.
#
# ANTES de desplegar una migración nueva: backup (ver docs/operacion.md).
# =============================================================================
set -euo pipefail

if [[ "${VERCEL_ENV:-}" != "production" ]]; then
  echo "[migrar] VERCEL_ENV=${VERCEL_ENV:-(vacío)}: no es producción, no se migra."
  exit 0
fi
if [[ -z "${DIRECT_URL:-}" ]]; then
  echo "[migrar] ERROR: falta DIRECT_URL (la conexión directa de Supabase, puerto 5432)." >&2
  exit 1
fi

echo "[migrar] aplicando migraciones pendientes en producción..."
pnpm --filter @panaderia/api exec prisma migrate deploy
