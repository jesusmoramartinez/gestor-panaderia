# Gestor de Panadería

Sistema web de gestión para una panadería con dos sucursales (una central que
produce y abastece a la otra). Preparado para multi-empresa desde el diseño.

**Etapa actual:** control de stock de materia prima (insumos).
**Fase actual:** 0 — setup del repositorio y rebanada vertical. ✅

| Documento                                | Para qué                                                                    |
| ---------------------------------------- | --------------------------------------------------------------------------- |
| [`PLAN.md`](PLAN.md)                     | Arquitectura, modelo de datos y las 12 fases con su criterio de "terminado" |
| [`CLAUDE.md`](CLAUDE.md)                 | Glosario del negocio, convenciones de código y reglas de trabajo            |
| [`docs/aprendizaje/`](docs/aprendizaje/) | Notas de estudio, una por concepto                                          |

---

## Requisitos

- **Node.js** ≥ 22 (el proyecto se desarrolla con 26)
- **pnpm** — `npm install -g pnpm`
- **Docker** con Docker Compose (para PostgreSQL)

## Puesta en marcha (una sola vez)

```bash
# 1. Dependencias
pnpm install

# 2. Variables de entorno (el .env no se commitea)
cp .env.example .env

# 3. Docker: habilitar el servicio y poder usarlo sin sudo
sudo systemctl enable --now docker
sudo usermod -aG docker "$USER"     # después hay que volver a iniciar sesión
```

## Uso diario

```bash
pnpm db:up        # levanta PostgreSQL en Docker
pnpm dev          # levanta la API (puerto 3000) y el frontend (puerto 5173)
```

Abrí **http://localhost:5173** y deberías ver los indicadores de API y base de
datos en verde.

## Todos los comandos

| Comando          | Qué hace                                                                           |
| ---------------- | ---------------------------------------------------------------------------------- |
| `pnpm dev`       | Compila `shared` y levanta API + frontend en paralelo                              |
| `pnpm build`     | Build de producción de los tres paquetes                                           |
| `pnpm check`     | `typecheck` + `lint` + `test`, lo que tiene que estar en verde para cerrar un paso |
| `pnpm typecheck` | Verifica los tipos sin generar archivos                                            |
| `pnpm lint`      | ESLint sobre todo el repositorio                                                   |
| `pnpm lint:fix`  | Igual, corrigiendo lo que se puede corregir solo                                   |
| `pnpm format`    | Formatea con Prettier                                                              |
| `pnpm test`      | Corre los tests de todos los paquetes                                              |
| `pnpm db:up`     | Levanta PostgreSQL                                                                 |
| `pnpm db:down`   | Apaga PostgreSQL (los datos quedan)                                                |
| `pnpm db:reset`  | Apaga PostgreSQL y **borra los datos**                                             |
| `pnpm db:logs`   | Muestra los logs de PostgreSQL                                                     |
| `pnpm db:psql`   | Abre una consola SQL contra la base                                                |

Para un paquete puntual: `pnpm --filter @panaderia/api test`

## Estructura

```
.
├── apps/
│   ├── api/          Backend: Node + Express + PostgreSQL
│   │   └── src/
│   │       ├── config/    Variables de entorno validadas con Zod
│   │       ├── lib/       Pool de conexiones, utilidades
│   │       └── modules/   Un directorio por módulo del negocio
│   │                      (routes → controller → service → repo)
│   └── web/          Frontend: React + Vite + Tailwind + TanStack Query
└── packages/
    └── shared/       Esquemas Zod, tipos y lógica pura usados por los dos lados
```

## Verificación de la Fase 0

```bash
docker compose ps        # la base tiene que figurar "healthy"
pnpm check               # typecheck + lint + test en verde
curl localhost:3000/api/health
```

Con la base levantada, `/api/health` responde **200** y `"db": "ok"`.
Con la base apagada responde **503** y `"db": "error"` con el detalle: el
sistema distingue "la API no responde" de "la API responde pero no alcanza la
base", que son dos problemas distintos.
