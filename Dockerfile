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
RUN pnpm --filter @panaderia/api deploy --prod --legacy /salida

# ---------------------------------------------------------------------------
# 2. LA IMAGEN FINAL: solo lo necesario para correr.
# ---------------------------------------------------------------------------
FROM node:26.8.2-alpine
ENV NODE_ENV=production \
    PORT=3000 \
    WEB_DIR=/app/web \
    TRUST_PROXY=true
WORKDIR /app

COPY --from=compilar /salida/node_modules node_modules
COPY --from=compilar /salida/package.json package.json
# Lo compilado de src/ (la API y el alta). LISTA EXPLÍCITA, como en la
# clínica: la semilla (prisma/seed.ts, semilla*.ts), que crea usuarios con la
# contraseña de desarrollo, NO entra. Un archivo nuevo de prisma/ no viaja
# salvo que se agregue acá a propósito.
COPY --from=compilar /repo/apps/api/dist dist
COPY --from=compilar /repo/apps/api/prisma/schema.prisma prisma/schema.prisma
COPY --from=compilar /repo/apps/api/prisma/migrations prisma/migrations
COPY --from=compilar /repo/apps/api/prisma.config.ts prisma.config.ts
COPY --from=compilar /repo/apps/web/dist web

# Usuario sin privilegios (lo trae la imagen de Node): si alguien rompiera la
# app, no es root en el contenedor.
USER node
EXPOSE 3000

# Las migraciones NO corren al arrancar: las corre actualizar.sh antes de
# activar la versión, con un backup previo (ver infra/servidor/panaderia).
CMD ["node", "dist/main.js"]
