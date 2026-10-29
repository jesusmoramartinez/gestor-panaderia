# Imagen de la panadería para el VPS: la API (Express + Prisma) que además
# sirve las pantallas ya compiladas. Un solo contenedor, una sola etiqueta:
# la web y la API de una versión siempre viajan juntas.
#
# Se arma en la laptop con scripts/deploy.sh, desde el commit que está en
# GitHub (git archive): nada que no esté versionado entra acá. Sin secretos:
# la configuración llega por variables de entorno (infra/servidor/panaderia).

# ---------------------------------------------------------------------------
# 1. COMPILAR: todo el monorepo, con las dependencias de desarrollo.
# ---------------------------------------------------------------------------
FROM node:26.8.2-alpine AS compilar
RUN npm install -g pnpm@12.9.1
WORKDIR /repo

# Primero solo lo que define las dependencias: si cambia el código pero no
# las dependencias, Docker reutiliza la capa del `pnpm install`.
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
COPY e2e/package.json e2e/
# El postinstall de la API corre `prisma generate`, que necesita el esquema.
COPY apps/api/prisma/schema.prisma apps/api/prisma/
COPY apps/api/prisma.config.ts apps/api/
RUN pnpm install --frozen-lockfile

COPY . .
RUN pnpm --filter @panaderia/shared build \
 && pnpm --filter @panaderia/api build \
 && pnpm --filter @panaderia/web build

# Las dependencias de PRODUCCIÓN de la API, en una carpeta aparte y sin
# enlaces al resto del monorepo (el paquete compartido queda copiado adentro).
# La CLI de Prisma NO está: es de desarrollo, y podar-dependencias.mjs saca lo
# que se colaba igual (ver ese script). Las migraciones las aplica
# dist/migraciones/migrar-cli.js (ver src/migraciones/migrador.ts).
#
# Y el cliente de Prisma trae el motor de consultas para cinco bases de datos
# (unos 13 MB cada uno); esta app usa solo PostgreSQL. La prueba de la imagen
# (CI y docs/deploy-vps.md) corre consultas de verdad: si un día faltara algo,
# falla ahí y no en el servidor.
RUN pnpm --filter @panaderia/api deploy --prod --legacy /salida \
 && node scripts/podar-dependencias.mjs /salida \
 && find /salida/node_modules/.pnpm -path '*/@prisma/client/runtime/*' \
      \( -name '*mysql*' -o -name '*sqlserver*' -o -name '*sqlite*' -o -name '*cockroachdb*' \) -delete

# ---------------------------------------------------------------------------
# 2. LA IMAGEN FINAL: solo lo necesario para correr.
# ---------------------------------------------------------------------------
FROM node:26.8.2-alpine
# npm y corepack vienen en la imagen de Node; acá no se instala nada.
RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack \
      /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack
ENV NODE_ENV=production \
    PORT=3000 \
    WEB_DIR=/app/web \
    TRUST_PROXY=true
WORKDIR /app

COPY --from=compilar /salida/node_modules node_modules
COPY --from=compilar /salida/package.json package.json
# Lo compilado de src/ (la API, el alta y el migrador). LISTA EXPLÍCITA, como en la
# clínica: la semilla (prisma/seed.ts, semilla*.ts), que crea usuarios con la
# contraseña de desarrollo, NO entra. Un archivo nuevo de prisma/ no viaja
# salvo que se agregue acá a propósito.
COPY --from=compilar /repo/apps/api/dist dist
COPY --from=compilar /repo/apps/api/prisma/migrations prisma/migrations
COPY --from=compilar /repo/apps/web/dist web

# Usuario sin privilegios (lo trae la imagen de Node): si alguien rompiera la
# app, no es root en el contenedor.
USER node
EXPOSE 3000

# Las migraciones NO corren al arrancar: las corre actualizar.sh antes de
# activar la versión, con un backup previo (ver infra/servidor/panaderia):
#   node dist/migraciones/migrar-cli.js
CMD ["node", "dist/main.js"]
