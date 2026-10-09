# PLAN.md — Sistema de gestión para panadería

> **Etapa actual:** Control de stock de materia prima (insumos).
> **Fecha del plan:** 2026-10-05
> **Estado:** aprobado para empezar por la Fase 0. Nada de código todavía fuera de lo que diga cada fase.

---

## 0. Cómo leer este documento

Este plan tiene cinco partes:

1. **Decisiones ya tomadas** — lo que definimos antes de arrancar, para no volver a discutirlo.
2. **Arquitectura** — qué piezas tiene el sistema y por qué cada una existe.
3. **Modelo de datos** — las tablas, sus campos y sus relaciones.
4. **Plan por fases** — el orden de trabajo, con criterios de "terminado" que podés verificar vos mismo.
5. **Preguntas al cliente y riesgos** — lo que falta saber y lo que puede salir mal.

Cada vez que aparezca un término técnico nuevo, está explicado en `docs/aprendizaje/`. Ese es tu material de estudio: una nota por concepto, en Markdown, y se va ampliando a medida que avanzamos de fase.

**Convención de lectura:** cuando este documento dice "preparado para el futuro" significa _diseñado para que se pueda agregar sin romper lo existente_, **no** "implementado".

---

## 1. Decisiones ya tomadas

| #   | Decisión             | Elegido                                     | Por qué                                                                                                                                   |
| --- | -------------------- | ------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Lotes y vencimientos | **No** en esta etapa, diseño preparado      | Seguir lotes obliga a que cada salida elija de qué lote descuenta. Duplica la lógica del kardex antes de que el sistema esté andando.     |
| 2   | Valuación de stock   | **Costo promedio ponderado (CPP)**          | Permite saber cuánta plata hay en el depósito y cuánto costó una merma. Con inflación, el "último precio" distorsiona y FIFO exige lotes. |
| 3   | Usuarios             | 1 usuario → 1 empresa, 1 rol, N sucursales  | Cubre el caso real (un encargado que cubre las dos panaderías) sin complicar el chequeo de permisos.                                      |
| 4   | Idioma del código    | Dominio en español, técnico en inglés       | Hablás con el dueño y con el código con el mismo vocabulario ("merma" no se traduce bien), sin pelear con el ecosistema JavaScript.       |
| 5   | Flujo de compras     | Orden de compra **opcional**                | En la realidad a veces el proveedor llega con el remito y nadie cargó una orden. Permitir los dos caminos evita órdenes de compra falsas. |
| 6   | Autenticación        | Sesión en base de datos + cookie `httpOnly` | La cookie no es legible por JavaScript (un ataque XSS no roba la sesión) y la sesión en tabla se puede revocar.                           |
| 7   | Stock negativo       | Bloqueado, salvo permiso especial           | Protege los datos, pero no traba la operación cuando la realidad no coincide con el sistema. Cada vez que se fuerza, queda registrado.    |
| 8   | Deploy               | **Vercel + Supabase** (Fase 11)             | Decidido en la Fase 11: Vercel (front + API como función) y Supabase (Postgres 17). Paso a paso en `docs/deploy-vercel-supabase.md`.      |

El detalle de cada decisión, con las alternativas que descartamos, está en `docs/aprendizaje/02-decisiones-de-arranque.md`.

---

## 2. Arquitectura

### 2.1 Vista general

```
                        NAVEGADOR (PC de escritorio / tablet)
    ┌──────────────────────────────────────────────────────────────────┐
    │  apps/web  —  React + Vite                                       │
    │                                                                  │
    │   React Router ──► páginas ──► componentes (shadcn/ui + Tailwind)│
    │                       │                                          │
    │                       ▼                                          │
    │             TanStack Query  (caché de los datos del servidor)     │
    └───────────────────────────────┬──────────────────────────────────┘
                                    │  HTTP + JSON
                                    │  cookie de sesión (httpOnly)
                                    ▼
    ┌──────────────────────────────────────────────────────────────────┐
    │  apps/api  —  Node.js + Express                                  │
    │                                                                  │
    │   middlewares: logs ─► auth ─► empresa (tenant) ─► permisos       │
    │        │                                                         │
    │        ▼                                                         │
    │   routes ──► controllers ──► services ──► data access (Prisma)   │
    │              (HTTP)          (REGLAS DE      (consultas SQL)     │
    │                               NEGOCIO)                           │
    └───────────────────────────────┬──────────────────────────────────┘
                                    │  SQL (Prisma Client)
                                    ▼
    ┌──────────────────────────────────────────────────────────────────┐
    │  PostgreSQL 18  (en un contenedor Docker, en tu máquina)         │
    │  Una sola base. Todas las tablas de negocio llevan empresa_id.   │
    └──────────────────────────────────────────────────────────────────┘

    ┌──────────────────────────────────────────────────────────────────┐
    │  packages/shared  —  lo que usan LOS DOS lados                   │
    │  · esquemas Zod (validación)   · tipos TypeScript                │
    │  · lógica pura del dominio (conversión de unidades, cálculo CPP) │
    │  NO conoce Express ni Prisma ni React.                           │
    └──────────────────────────────────────────────────────────────────┘
```

### 2.2 Qué es cada pieza y por qué está

**Monorepo**: un solo repositorio de git que contiene varios proyectos ("paquetes"). El frontend, el backend y el código compartido viven juntos.
_Por qué:_ cuando cambiás la forma de un dato (por ejemplo, agregás un campo a "insumo"), cambiás el esquema compartido y **TypeScript te marca el error en los dos lados en el mismo commit**. Si fueran dos repositorios, el front y el back se desincronizan y te enterás en producción.

**Gestor de workspaces: pnpm.** Un "workspace" es la función del gestor de paquetes que permite que varios paquetes de un mismo repo compartan una instalación de dependencias y se referencien entre sí.
_Por qué pnpm y no npm (que ya tenés instalado):_

- **Aislamiento estricto.** Con npm, si `apps/web` usa una librería que en realidad declaró `apps/api`, igual funciona (por como npm aplana `node_modules`) y el día que publiques se rompe. pnpm no te deja importar lo que no declaraste. Para alguien que está aprendiendo, es un profesor gratis.
- **Espacio y velocidad.** Guarda cada versión de cada paquete una sola vez en el disco y usa enlaces duros; instalar es mucho más rápido.
- **`pnpm --filter`.** Te permite correr un script en un paquete puntual (`pnpm --filter api test`), que es lo que vas a hacer todo el día.
  _Alternativas descartadas:_ **npm workspaces** (funciona, cero instalación extra, pero sin el aislamiento estricto); **Yarn** (similar a pnpm, menos usado hoy en proyectos nuevos); **Turborepo / Nx** (agregan caché de builds y orquestación — útiles con 10 paquetes y CI, hoy serían complejidad sin beneficio; se pueden sumar después sin tocar el código).

**TypeScript en modo strict**: JavaScript con tipos verificados antes de ejecutar. "Strict" es el conjunto de reglas más exigente (entre otras cosas, no te deja tratar un valor que puede ser `null` como si nunca lo fuera).
_Por qué:_ en un sistema de stock, el bug típico es `undefined` donde esperabas un número, y aparece recién cuando el dueño carga una merma a las 6 de la mañana. Strict lo convierte en un error en tu pantalla, hoy.

**Express**: el servidor HTTP del backend. Recibe pedidos y devuelve JSON.

**Las 4 capas del backend** (esto es lo más importante de la arquitectura):

| Capa          | Responsabilidad                                                                                                                                                                             | Qué **no** hace                                         |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| `routes`      | Declarar qué URL y qué método existen y en qué orden pasan los middlewares.                                                                                                                 | Nada de lógica.                                         |
| `controllers` | Traducir HTTP ↔ dominio: validar el body con Zod, armar el contexto (usuario, empresa, sucursal), llamar al servicio, elegir el código de estado.                                           | No sabe reglas de negocio, no toca la base.             |
| `services`    | **Las reglas del negocio.** "Una merma no puede dejar el stock negativo salvo que tengas permiso", "al recibir una compra se recalcula el costo promedio". Abre y cierra las transacciones. | No sabe que existe HTTP. No lee `req` ni escribe `res`. |
| `data access` | Las consultas con Prisma.                                                                                                                                                                   | No decide reglas.                                       |

_Por qué separar:_ la parte valiosa y peligrosa de este sistema es el servicio de stock. Separado, lo podés testear con Vitest llamándolo como una función común, sin levantar un servidor ni un navegador. Si la lógica vive dentro de la ruta de Express, para probar "no permitir stock negativo" tenés que simular un pedido HTTP completo, y nadie escribe esos tests.

**PostgreSQL**: la base de datos relacional. Elegida porque es la que mejor soporta lo que este sistema necesita: tipo `NUMERIC` exacto para cantidades y dinero, transacciones serias, `CHECK` constraints, y porque es gratis y estándar.

**Docker Compose**: una herramienta que levanta servicios (acá, Postgres) definidos en un archivo YAML.
_Por qué:_ no instalás Postgres en tu Linux ni peleás con versiones. `docker compose up -d` y tenés la base; `docker compose down -v` y la borrás por completo para empezar de nuevo. Y el día que otra persona (o un servidor) necesite el mismo entorno, corre el mismo archivo.

**Prisma (ORM)**: un ORM (_Object–Relational Mapper_) es una librería que traduce entre tablas de SQL y objetos de tu lenguaje. Con Prisma describís el modelo en un archivo `schema.prisma`, y te genera (a) el SQL de las migraciones y (b) un cliente tipado.
_Por qué:_ las **migraciones** (archivos SQL versionados que llevan la base de un estado al siguiente) son obligatorias en un sistema real, y el cliente tipado hace que `insumo.nombre` exista y `insumo.nombr` sea un error de compilación.
_Advertencia honesta:_ Prisma te esconde el SQL, y en un sistema de stock vas a necesitar leer SQL. Por eso en cada migración vamos a **abrir el `.sql` que genera y leerlo**, y en la Fase 10 escribimos una vista a mano.

**Zod**: librería de validación. Declarás la forma esperada de un dato y Zod la verifica **en tiempo de ejecución** (TypeScript solo verifica al compilar; un JSON que llega por la red podría traer cualquier cosa).
_Por qué compartido:_ definimos el esquema una vez en `packages/shared`, el formulario del front lo usa para validar antes de enviar y la API lo usa para no confiar en nada. Un solo lugar donde cambiar una regla.

**React + Vite**: React arma la interfaz con componentes; Vite es la herramienta de desarrollo (servidor con recarga instantánea y build de producción).

**React Router**: maneja las URLs dentro de la aplicación (`/insumos`, `/stock/:sucursalId`) sin recargar la página.

**TanStack Query**: caché del estado del servidor. En lugar de escribir a mano `useEffect` + `fetch` + tres `useState` (cargando, error, datos), declarás "esta pantalla necesita el stock de la sucursal X" y la librería se encarga del caché, los reintentos, el estado de carga y de **invalidar** (marcar como viejo y volver a pedir) después de una mutación.
_Por qué importa acá:_ cuando el empleado registra una merma, el stock que se ve en pantalla quedó obsoleto. Con TanStack Query eso es una línea.

**Tailwind CSS**: estilos con clases utilitarias directo en el HTML (`class="flex gap-2 p-4"`) en lugar de archivos CSS aparte.

**shadcn/ui**: **no es una dependencia**, es un catálogo de componentes (botón, tabla, diálogo, formulario) que se **copian** a tu proyecto y quedan como código tuyo, construidos sobre Radix (accesibilidad) y Tailwind. Los podés modificar sin pelear con la librería. Clave para los botones grandes de la tablet.

**Vitest**: el corredor de tests. Mismo ecosistema que Vite, API casi idéntica a Jest.
_Dónde es obligatorio:_ toda la lógica de stock y de conversión de unidades. Es la regla que más te va a salvar en este proyecto.

### 2.3 Estructura de carpetas

```
panaderia/
├── CLAUDE.md                  Reglas de trabajo y glosario (lo lee Claude y lo leés vos)
├── PLAN.md                    Este archivo
├── docs/
│   └── aprendizaje/           Tus notas de estudio, una por concepto
├── docker-compose.yml         Postgres para desarrollo
├── pnpm-workspace.yaml        Declara dónde están los paquetes
├── package.json               Scripts raíz (dev, test, lint, typecheck)
├── tsconfig.base.json         Configuración TypeScript compartida (strict)
│
├── apps/
│   ├── api/
│   │   ├── prisma/
│   │   │   ├── schema.prisma  El modelo de datos
│   │   │   ├── migrations/    SQL versionado (se lee, no se edita a mano)
│   │   │   └── seed.ts        Datos de prueba realistas
│   │   └── src/
│   │       ├── main.ts            Arranque del servidor
│   │       ├── config/            Variables de entorno validadas con Zod
│   │       ├── middlewares/       auth, empresa (tenant), permisos, errores
│   │       ├── modules/           Un directorio por módulo del negocio
│   │       │   ├── auth/
│   │       │   ├── insumos/       routes.ts · controller.ts · service.ts · repo.ts
│   │       │   ├── proveedores/
│   │       │   ├── stock/         ← el corazón del sistema
│   │       │   ├── compras/
│   │       │   └── transferencias/
│   │       └── lib/               db.ts (cliente Prisma), errores, auditoría, logger
│   │
│   └── web/
│       └── src/
│           ├── main.tsx
│           ├── routes/            Una carpeta por pantalla
│           ├── components/        ui/ (shadcn) + propios
│           ├── lib/               cliente HTTP, configuración de TanStack Query
│           └── hooks/
│
└── packages/
    └── shared/
        └── src/
            ├── esquemas/          Zod: insumo, movimiento, compra, ...
            ├── dominio/           Lógica pura: conversión de unidades, CPP
            └── tipos/             Enums y tipos compartidos
```

**Regla de dependencias (importante):** `web` → `shared` y `api` → `shared`. Nunca `shared` → `web` o `api`, y nunca `web` → `api`. Si `shared` importara Prisma, el navegador intentaría cargar una librería de base de datos.

### 2.4 El recorrido completo de un pedido (ejemplo: registrar una merma de 2 kg de harina)

Seguir este recorrido una vez te explica el 80% de la arquitectura:

1. **Front.** El encargado completa el formulario en la tablet. El formulario valida con el esquema `MermaInput` de `packages/shared`: si falta el motivo, ni se envía.
2. **Front.** TanStack Query ejecuta `POST /api/movimientos/merma`. El navegador adjunta la cookie de sesión automáticamente.
3. **API, middlewares** (se ejecutan en orden, cada uno puede cortar la cadena):
   `logger` (registra el pedido) → `requireAuth` (busca el token de la cookie en la tabla `sesion`; si no existe o venció, responde 401) → `empresa` (fija `ctx.empresaId` **tomándolo de la sesión, nunca del body**) → `requirePermiso('merma:crear')` → `requireSucursal` (¿este usuario opera en esa sucursal?).
4. **Controller.** `MermaInputSchema.parse(req.body)`. Si falla, responde 400 con la lista de campos inválidos. Arma el contexto y llama al servicio.
5. **Service** — acá vive el negocio. Dentro de **una transacción**:
   a. convierte la cantidad a la unidad base del insumo (si cargó "2000 g" y el insumo se lleva en kg → 2);
   b. bloquea la fila de control de ese insumo en esa sucursal (para que dos usuarios simultáneos no lean el mismo saldo);
   c. calcula el saldo actual sumando los movimientos;
   d. valida la regla de stock negativo (y si el usuario tiene permiso para forzar, marca el movimiento);
   e. toma el costo promedio del insumo para valorizar la merma;
   f. inserta el movimiento con cantidad **negativa**, el motivo, el usuario y la fecha;
   g. escribe el registro de auditoría;
   h. **commit**. Si cualquier paso falla, no se escribe absolutamente nada.
6. **Controller.** Responde `201` con el movimiento creado.
7. **Front.** TanStack Query invalida las consultas de `stock` y `movimientos`; las pantallas abiertas se actualizan solas.

> Fijate que la regla de negocio aparece **una sola vez**, en el paso 5. Esa es la razón de ser de las capas.

---

## 3. Modelo de datos

### 3.0 Reglas que valen para TODAS las tablas

| Regla                                     | Cómo se aplica                                                                     | Por qué                                                                                                                                                                                                                                                                                                            |
| ----------------------------------------- | ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Identificadores UUID**                  | `id uuid` con valor por defecto `gen_random_uuid()`.                               | Un `id` autoincremental (1, 2, 3…) obliga a ir a la base para saber el id antes de insertar cosas relacionadas, y filtra información (el cliente ve que es la compra Nº 7). Además, el día que haya varias empresas o importaciones, los números choquan. Lo explico en `docs/aprendizaje/00-glosario-tecnico.md`. |
| **`empresa_id` en toda tabla de negocio** | Columna obligatoria + índice.                                                      | Es el aislamiento multi-empresa: todas las empresas comparten las tablas y cada fila sabe de quién es.                                                                                                                                                                                                             |
| **`sucursal_id` donde hay stock**         | En movimientos, conteos, transferencias, recepciones.                              | El stock no es "de la empresa", es "de un insumo en una sucursal".                                                                                                                                                                                                                                                 |
| **Cantidades y dinero en `NUMERIC`**      | Cantidades `NUMERIC(18,6)`; dinero `NUMERIC(18,4)`; factores `NUMERIC(20,10)`.     | `float`/`double` son binarios: `0.1 + 0.2 = 0.30000000000000004`. En un kardex eso significa stock que nunca cierra. Ver `docs/aprendizaje/04-dinero-y-cantidades-decimal.md`.                                                                                                                                     |
| **Fechas en `timestamptz` y en UTC**      | Postgres guarda el instante absoluto; el front lo muestra en horario de Argentina. | Si guardás "hora local" sin zona, una carga a las 23:30 puede terminar en el día equivocado, y no hay forma de saberlo después.                                                                                                                                                                                    |
| **`created_at` / `updated_at`**           | En todas las tablas.                                                               | Saber cuándo se registró algo, que no es lo mismo que cuándo _ocurrió_ (ver `fecha` en movimientos).                                                                                                                                                                                                               |
| **Baja lógica, no borrado**               | Columna `activo boolean`.                                                          | No se puede borrar un insumo que aparece en movimientos de hace 6 meses: el historial quedaría roto. Se desactiva y deja de aparecer en los formularios.                                                                                                                                                           |
| **Unicidad siempre por empresa**          | `UNIQUE (empresa_id, codigo)`, no `UNIQUE (codigo)`.                               | Dos panaderías distintas pueden tener un insumo con el mismo código.                                                                                                                                                                                                                                               |

---

### 3.1 Núcleo: empresa, sucursales y usuarios _(Fase 1 y 2)_

#### `empresa` — el "inquilino" del sistema

Es la raíz de todo. Cuando el sistema se venda a otra panadería, se crea otra fila acá y sus datos jamás se cruzan con los tuyos.

| Campo                  | Tipo           | Notas                                                                                                                                        |
| ---------------------- | -------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`                   | uuid           |                                                                                                                                              |
| `nombre`               | text           | Nombre de fantasía.                                                                                                                          |
| `razon_social`, `cuit` | text, nullable | Para el futuro (facturación fuera de alcance).                                                                                               |
| `zona_horaria`         | text           | Por defecto `America/Argentina/Buenos_Aires`.                                                                                                |
| `moneda`               | text           | Por defecto `ARS`. Preparado para el futuro, hoy no se usa para convertir.                                                                   |
| `costo_incluye_iva`    | boolean        | **A confirmar con el cliente** (pregunta C-11): define si el costo de inventario se registra con IVA o neto. Depende de su condición fiscal. |
| `activa`               | boolean        |                                                                                                                                              |

#### `sucursal` — dónde está físicamente el stock

| Campo                   | Tipo           | Notas                                                                                                              |
| ----------------------- | -------------- | ------------------------------------------------------------------------------------------------------------------ |
| `id`                    | uuid           |                                                                                                                    |
| `empresa_id`            | uuid → empresa |                                                                                                                    |
| `nombre`                | text           | "Central", "Sucursal Belgrano".                                                                                    |
| `codigo`                | text           | Corto, para documentos. `UNIQUE (empresa_id, codigo)`.                                                             |
| `direccion`, `telefono` | text, nullable |                                                                                                                    |
| `es_central`            | boolean        | Marca la que produce y abastece. Hoy solo informativo; mañana lo usa el módulo de producción y la venta mayorista. |
| `activa`                | boolean        |                                                                                                                    |

_Por qué existe esta tabla y no un campo "sucursal" de texto:_ porque el stock mínimo, los movimientos, las transferencias y los permisos **apuntan** a la sucursal. Si fuera texto, un error de tipeo partiría el stock en dos.

#### `usuario`

| Campo              | Tipo                  | Notas                                                                                                                                                  |
| ------------------ | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `id`               | uuid                  |                                                                                                                                                        |
| `empresa_id`       | uuid → empresa        | Decisión 3: un usuario pertenece a una sola empresa.                                                                                                   |
| `email`            | text                  | `UNIQUE` global (no por empresa). Si el mismo email existiera en dos empresas, el login sería ambiguo: habría que preguntar "¿en cuál querés entrar?". |
| `nombre`           | text                  |                                                                                                                                                        |
| `password_hash`    | text                  | **Nunca** la contraseña. Un _hash_ es una transformación irreversible: si te roban la base, no tienen las contraseñas.                                 |
| `rol`              | enum                  | `DUENO` \| `ENCARGADO` \| `EMPLEADO`.                                                                                                                  |
| `activo`           | boolean               | Se desactiva al empleado que se fue; sus movimientos históricos siguen apuntando a él.                                                                 |
| `ultimo_acceso_at` | timestamptz, nullable |                                                                                                                                                        |

_Por qué un enum y no tablas `rol` + `permiso`:_ con 3 roles fijos, una matriz de permisos en código (`EMPLEADO: ['insumo:ver', 'consumo:crear', ...]`) es más simple de leer y de testear, y no se puede desincronizar con la base. Si el cliente pide roles a medida, la migración es clara: tabla `rol` + tabla `rol_permiso`, y el enum pasa a ser el rol por defecto.

#### `usuario_sucursal` — en qué sucursales puede operar

| Campo         | Tipo            | Notas                                           |
| ------------- | --------------- | ----------------------------------------------- |
| `usuario_id`  | uuid → usuario  | **Clave primaria compuesta** con `sucursal_id`. |
| `sucursal_id` | uuid → sucursal |                                                 |

_Por qué una tabla aparte:_ es una relación **muchos a muchos** (un usuario puede estar en varias sucursales; una sucursal tiene varios usuarios). En SQL eso siempre se modela con una tabla puente.
**Regla:** el rol `DUENO` accede a todas las sucursales de su empresa sin necesidad de filas acá (lo resuelve el middleware de permisos). Al encargado y al empleado hay que asignarles sucursales explícitamente.

#### `sesion` — login activo

| Campo              | Tipo                  | Notas                                                                                                                                       |
| ------------------ | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`               | uuid                  |                                                                                                                                             |
| `usuario_id`       | uuid → usuario        |                                                                                                                                             |
| `token_hash`       | text                  | Se guarda el **hash** del token, no el token. Mismo razonamiento que la contraseña: si te leen la tabla, no pueden hacerse pasar por nadie. |
| `expira_at`        | timestamptz           |                                                                                                                                             |
| `revocada_at`      | timestamptz, nullable | Logout, o "cerrar sesión en todos los dispositivos".                                                                                        |
| `ip`, `user_agent` | text, nullable        | Para el historial de accesos.                                                                                                               |

_Por qué una tabla y no solo un JWT firmado:_ un JWT es válido hasta que vence y **no se puede cancelar**. Si echás a un empleado, su token sigue andando. Con la sesión en tabla, borrás la fila y listo. El costo es una consulta por pedido, irrelevante para una panadería.

#### `auditoria` — quién hizo cada cambio _(Fase 2, usada desde ahí en adelante)_

| Campo                          | Tipo            | Notas                                                                                                         |
| ------------------------------ | --------------- | ------------------------------------------------------------------------------------------------------------- |
| `id`                           | uuid            |                                                                                                               |
| `empresa_id`                   | uuid            |                                                                                                               |
| `usuario_id`                   | uuid, nullable  | Nullable para eventos del sistema.                                                                            |
| `entidad`                      | text            | `'insumo'`, `'recepcion_compra'`, `'usuario'`…                                                                |
| `entidad_id`                   | uuid, nullable  |                                                                                                               |
| `accion`                       | enum            | `CREAR` \| `ACTUALIZAR` \| `DESACTIVAR` \| `ANULAR` \| `LOGIN` \| `LOGIN_FALLIDO` \| `FORZAR_STOCK_NEGATIVO`. |
| `datos_antes`, `datos_despues` | jsonb, nullable | Foto del registro antes y después. `jsonb` es el tipo de Postgres para guardar JSON consultable.              |
| `ip`                           | text, nullable  |                                                                                                               |
| `created_at`                   | timestamptz     |                                                                                                               |

_Por qué desde la Fase 2 y no al final:_ la auditoría se escribe desde los servicios. Si la dejamos para el final, hay que volver a tocar cada servicio ya escrito y testeado. Agregarla temprano cuesta una línea por operación.
_Por qué no audita los movimientos de stock:_ los movimientos ya son inmutables y llevan `usuario_id` y `fecha`; auditarlos sería guardar lo mismo dos veces. La auditoría cubre lo que **sí** se puede modificar: catálogos, precios, usuarios, mínimos y anulaciones.

---

### 3.2 Unidades de medida y conversiones _(Fase 3)_

#### `unidad_medida`

| Campo           | Tipo           | Notas                                                                                            |
| --------------- | -------------- | ------------------------------------------------------------------------------------------------ |
| `id`            | uuid           |                                                                                                  |
| `empresa_id`    | uuid → empresa | Cada empresa tiene su catálogo (el seed crea las básicas y puede agregar "docena", "cajón").     |
| `codigo`        | text           | `kg`, `g`, `l`, `ml`, `u`. `UNIQUE (empresa_id, codigo)`.                                        |
| `nombre`        | text           | "Kilogramo".                                                                                     |
| `dimension`     | enum           | `PESO` \| `VOLUMEN` \| `UNIDAD`.                                                                 |
| `factor_a_base` | numeric(20,10) | Cuánto vale 1 de esta unidad expresado en la unidad base de su dimensión. `kg` = 1, `g` = 0.001. |
| `es_base`       | boolean        | Una sola por dimensión.                                                                          |
| `activa`        | boolean        |                                                                                                  |

**La regla central:** solo se convierte **dentro de la misma dimensión**. `kg → g` sí. `kg → litros` **no**, porque dependería de la densidad del material (1 litro de aceite y 1 litro de agua no pesan lo mismo). El sistema tiene que rechazar eso con un error claro, no "estimar".

> **Ojo con esto en la panadería:** el aceite se compra por litro y a veces se usa por kilo. Si el cliente trabaja así, hay dos caminos: (a) elegir una sola unidad por insumo y que todos carguen en esa, o (b) agregar `densidad` al insumo y permitir PESO↔VOLUMEN. Es la pregunta **C-3** para el cliente. Hoy el diseño asume (a).

#### `presentacion_insumo` — cómo se compra _(Fase 4)_

Esto es lo que resuelve "compro en bolsas de 25 kg pero el stock se lleva en kg".

| Campo                     | Tipo          | Notas                                                                                 |
| ------------------------- | ------------- | ------------------------------------------------------------------------------------- |
| `id`                      | uuid          |                                                                                       |
| `empresa_id`, `insumo_id` | uuid          | La presentación es **de un insumo**: "Bolsa 25 kg" solo tiene sentido para la harina. |
| `nombre`                  | text          | "Bolsa 25 kg", "Cajón 12 u", "Bidón 10 l".                                            |
| `cantidad_base`           | numeric(18,6) | Cuántas unidades **base del insumo** trae. Bolsa de 25 kg → `25`.                     |
| `es_default`              | boolean       | La que se propone al comprar.                                                         |
| `activa`                  | boolean       |                                                                                       |

_Por qué es una tabla y no un campo "factor" en el insumo:_ un mismo insumo se compra en varias presentaciones (bolsa de 25 kg y de 50 kg) y conviven.
**Regla de oro (vale para todo el sistema):** cuando un documento usa una presentación, **copia** `cantidad_base` en su propia línea (`factor_conversion`). Si mañana alguien corrige la presentación de 25 a 24, las compras del año pasado **no deben cambiar**. Guardar la copia de un dato en el momento del hecho se llama _snapshot_, y es la diferencia entre un historial confiable y uno que miente.

---

### 3.3 Catálogo de insumos _(Fase 4)_

#### `categoria_insumo`

`id`, `empresa_id`, `nombre`, `activa`. _Por qué:_ agrupar para listar, filtrar, contar por categoría (conteo rotativo) y ordenar la lista de compras. Simple a propósito (sin jerarquía de categorías: no la necesita y complica todas las consultas).

#### `insumo` — el centro del catálogo

| Campo            | Tipo                              | Notas                                                                                                                                                |
| ---------------- | --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`             | uuid                              |                                                                                                                                                      |
| `empresa_id`     | uuid → empresa                    |                                                                                                                                                      |
| `codigo`         | text, nullable                    | Código interno. `UNIQUE (empresa_id, codigo)`.                                                                                                       |
| `nombre`         | text                              | "Harina 000". `UNIQUE (empresa_id, nombre)` para evitar duplicados que parten el stock.                                                              |
| `categoria_id`   | uuid → categoria_insumo, nullable |                                                                                                                                                      |
| `unidad_base_id` | uuid → unidad_medida              | **La unidad en la que se lleva el stock, siempre.** Todo movimiento se guarda convertido a esta unidad.                                              |
| `costo_promedio` | numeric(18,4)                     | Costo por unidad base. Se recalcula en cada entrada (Fase 8). Es un valor **derivado**: existe una función que lo reconstruye desde los movimientos. |
| `activo`         | boolean                           |                                                                                                                                                      |

_Por qué una unidad base fija por insumo:_ es la decisión que hace que el kardex funcione. Si un movimiento estuviera en bolsas, otro en kg y otro en gramos, sumarlos sería imposible sin convertir en cada consulta. Se convierte **una vez, al entrar**, y de ahí en adelante todo está en la misma unidad.
_Regla:_ una vez que el insumo tiene movimientos, **no se puede cambiar** su unidad base (cambiaría el significado de todo el historial). La API lo rechaza.

#### `insumo_sucursal` — parámetros por sucursal

| Campo                       | Tipo                    | Notas                                         |
| --------------------------- | ----------------------- | --------------------------------------------- |
| `insumo_id` + `sucursal_id` | uuid                    | Clave primaria compuesta.                     |
| `empresa_id`                | uuid                    | Redundante pero práctico para filtrar.        |
| `stock_minimo`              | numeric(18,6)           | En unidad base. Dispara la alerta (Fase 10).  |
| `stock_maximo`              | numeric(18,6), nullable | Para sugerir _cuánto_ reponer, no solo _qué_. |
| `ubicacion`                 | text, nullable          | "Depósito B, estante 3".                      |
| `activo`                    | boolean                 | Un insumo puede no usarse en una sucursal.    |

_Por qué el mínimo va acá y no en `insumo`:_ porque la central guarda 300 kg de harina y la sucursal 50. Es exactamente el pedido del cliente.

> **Importante: acá NO hay una columna `stock_actual`.** El saldo no se guarda: se calcula sumando los movimientos (ver 3.11). Esta tabla guarda solo lo que **configura una persona**.

---

### 3.4 Proveedores _(Fase 5)_

#### `proveedor`

`id`, `empresa_id`, `nombre`, `razon_social`, `cuit`, `email`, `telefono`, `direccion`, `contacto_nombre`, `dias_entrega` (nullable, int — cuántos días tarda en entregar; sirve para la reposición), `notas`, `activo`.

#### `proveedor_insumo` — qué insumo provee cada uno

| Campo                                     | Tipo                                 | Notas                                                                      |
| ----------------------------------------- | ------------------------------------ | -------------------------------------------------------------------------- |
| `id`                                      | uuid                                 |                                                                            |
| `empresa_id`, `proveedor_id`, `insumo_id` | uuid                                 | `UNIQUE (proveedor_id, insumo_id)`.                                        |
| `presentacion_id`                         | uuid → presentacion_insumo, nullable | En qué presentación lo vende. Null = en la unidad base.                    |
| `codigo_proveedor`                        | text, nullable                       | El código del artículo en **su** catálogo, para pedirle sin confusión.     |
| `ultimo_precio`                           | numeric(18,4), nullable              | Precio de la presentación en la última compra. Se actualiza solo (Fase 8). |
| `ultimo_precio_at`                        | timestamptz, nullable                | Con inflación, un precio sin fecha no sirve.                               |
| `es_preferido`                            | boolean                              | Define a quién agrupar en la vista de reposición.                          |
| `activo`                                  | boolean                              |                                                                            |

_Por qué una tabla puente con campos propios:_ la relación "proveedor ↔ insumo" tiene datos que no pertenecen a ninguno de los dos por separado: el precio, el código del proveedor y la presentación. Esa es la señal de que una relación N:M necesita su propia tabla.
_Validación cruzada que el servicio debe hacer:_ la `presentacion_id` tiene que pertenecer al `insumo_id` de la misma fila. La base no puede expresar eso con una clave foránea simple, así que es una regla del servicio **con su test**.

---

### 3.5 Movimientos de stock — el corazón del sistema _(Fase 6)_

Esta es **la tabla más importante del proyecto**. Si sale bien, el resto es formularios. Si sale mal, no hay forma de confiar en ningún número.

El modelo se llama **kardex**: no se guarda "cuánto hay", se guardan **todos los hechos** (entró, salió, se ajustó) y el saldo es la suma. Igual que un extracto bancario: el banco no guarda tu saldo, guarda los movimientos. La nota completa está en `docs/aprendizaje/03-kardex-stock-calculado.md`.

#### `motivo_movimiento`

`id`, `empresa_id`, `tipo_aplicable` (enum `MERMA` \| `AJUSTE` \| `CONSUMO`), `nombre`, `activo`.
Ejemplos a sembrar: _Vencido_, _Roto / derramado_, _Plaga o humedad_, _Error de carga_, _Diferencia de conteo_, _Diferencia en transferencia_, _Prueba / degustación_.
_Por qué una tabla y no texto libre:_ si cada uno escribe "vencio", "Vencido", "venció", nunca vas a poder responder "¿cuánta plata perdimos por vencimiento este mes?". El campo `notas` queda para el detalle libre.

#### `movimiento_stock`

| Campo                 | Tipo                               | Notas                                                                                                                                                                                         |
| --------------------- | ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`                  | uuid                               |                                                                                                                                                                                               |
| `empresa_id`          | uuid                               |                                                                                                                                                                                               |
| `sucursal_id`         | uuid → sucursal                    | Dónde pasó.                                                                                                                                                                                   |
| `insumo_id`           | uuid → insumo                      | Qué.                                                                                                                                                                                          |
| `tipo`                | enum                               | `SALDO_INICIAL` \| `COMPRA` \| `CONSUMO` \| `MERMA` \| `AJUSTE` \| `TRANSFERENCIA_SALIDA` \| `TRANSFERENCIA_ENTRADA` \| `REVERSA`.                                                            |
| `cantidad_base`       | numeric(18,6)                      | **Con signo:** positivo = entra, negativo = sale. En la unidad base del insumo.                                                                                                               |
| `cantidad_ingresada`  | numeric(18,6)                      | Lo que la persona realmente tipeó (ej. `4`).                                                                                                                                                  |
| `unidad_ingresada_id` | uuid → unidad_medida               | En qué unidad lo tipeó (ej. "bolsa"/"g").                                                                                                                                                     |
| `factor_conversion`   | numeric(20,10)                     | Snapshot del factor usado. Con estos tres campos el historial puede decir _"cargó 4 bolsas de 25 kg = 100 kg"_ y seguirá siendo verdad en 5 años.                                             |
| `costo_unitario`      | numeric(18,4), nullable            | Costo por unidad base **en el momento del movimiento**. En entradas: el costo real de compra. En salidas: el costo promedio congelado.                                                        |
| `fecha`               | timestamptz                        | **Cuándo ocurrió** en la realidad.                                                                                                                                                            |
| `usuario_id`          | uuid → usuario                     | Quién lo registró.                                                                                                                                                                            |
| `motivo_id`           | uuid → motivo_movimiento, nullable | Obligatorio para `MERMA` y `AJUSTE` (regla del servicio).                                                                                                                                     |
| `notas`               | text, nullable                     |                                                                                                                                                                                               |
| `operacion_id`        | uuid                               | Agrupa los movimientos creados en la misma operación (una carga de consumo con 6 insumos tiene 6 filas con el mismo `operacion_id`). No es clave foránea: es solo una etiqueta de agrupación. |
| `recepcion_compra_id` | uuid → recepcion_compra, nullable  | Documento que lo originó.                                                                                                                                                                     |
| `transferencia_id`    | uuid → transferencia, nullable     | Ídem.                                                                                                                                                                                         |
| `conteo_fisico_id`    | uuid → conteo_fisico, nullable     | Ídem.                                                                                                                                                                                         |
| `revierte_a_id`       | uuid → movimiento_stock, nullable  | Si este movimiento anula a otro. `UNIQUE`: un movimiento se puede revertir una sola vez.                                                                                                      |
| `forzado`             | boolean                            | `true` si se permitió dejar el stock negativo con permiso especial.                                                                                                                           |
| `created_at`          | timestamptz                        | Cuándo se **registró** (puede ser muy distinto de `fecha`).                                                                                                                                   |

**Restricciones en la base de datos** (un `CHECK` es una regla que Postgres verifica en cada `INSERT`; si la rompés, rechaza la fila — es la última línea de defensa, por debajo de la validación de Zod y de las reglas del servicio):

- `cantidad_base <> 0` — un movimiento de cero no significa nada.
- El signo tiene que coincidir con el tipo: `COMPRA`, `TRANSFERENCIA_ENTRADA`, `SALDO_INICIAL` → `> 0`; `CONSUMO`, `MERMA`, `TRANSFERENCIA_SALIDA` → `< 0`; `AJUSTE` y `REVERSA` → cualquiera salvo cero.
- `factor_conversion > 0`.

**Índices** (un índice es una estructura que permite encontrar filas sin leer toda la tabla):

- `(empresa_id, sucursal_id, insumo_id, fecha)` — la consulta de saldo y de historial.
- `(empresa_id, insumo_id, fecha)` — valuación y recálculo del costo promedio.
- `(operacion_id)`, `(recepcion_compra_id)`, `(transferencia_id)`, `(conteo_fisico_id)`.

#### Las dos reglas que nunca se rompen

1. **Un movimiento, una vez escrito, no se edita ni se borra. Nunca.** Para corregir un error se escribe un movimiento **inverso** (lo que en contabilidad se llama _contra-asiento_): mismo insumo, misma sucursal, cantidad opuesta, `tipo = REVERSA` y `revierte_a_id` apuntando al original. Así el historial cuenta la verdad completa: _"se cargó mal y se corrigió el día 12"_, en lugar de borrar la evidencia.
2. **Todo lo que escribe movimientos pasa por un único servicio.** Una sola función `registrarMovimientos(tx, movimientos[])` que valida signos, convierte unidades, chequea stock negativo y escribe. Ningún otro módulo inserta en esta tabla directamente. Si hay dos lugares que escriben movimientos, tarde o temprano uno se olvida de una validación.

---

### 3.6 Ajuste de stock _(Fase 7)_ — y el conteo físico, que quedó preparado

**No hay tablas nuevas.** El ajuste se registra como un `movimiento_stock` de tipo `AJUSTE` con su `motivo_id` obligatorio, que ya existían desde la Fase 6.

Lo único propio de la operación es que **se carga lo contado y el servicio calcula la diferencia** (`contado − saldo`), con el candado de `insumo_sucursal` tomado. Ver la Fase 7 para el razonamiento completo.

#### `conteo_fisico` y `linea_conteo` — diseño preparado, NO implementado

El plan original tenía un documento de conteo con estados. Se descartó por la respuesta del cliente a C-15 (no piensa hacer conteos formales), pero el diseño queda anotado porque es una extensión limpia si alguna vez entra más gente a contar el depósito:

- `conteo_fisico`: `id`, `empresa_id`, `sucursal_id`, `numero`, `estado` (`BORRADOR` | `CERRADO` | `ANULADO`), `fecha`, `categoria_id` (nullable, para contar solo una categoría: _conteo rotativo_), `usuario_id`, `cerrado_at`, `cerrado_por_id`, `notas`.
- `linea_conteo`: `id`, `conteo_fisico_id`, `insumo_id`, `cantidad_contada`, `saldo_sistema` (snapshot al momento de contar), `diferencia`, `contada_at`, `usuario_id`.

_Lo importante:_ al cerrarse, ese documento **llamaría al mismo servicio de ajuste** que ya existe. No habría que tocar el kardex ni el motor. Y `movimiento_stock` tendría entonces su columna `conteo_fisico_id`, que hoy no existe a propósito (una columna que apunta a una tabla que no existe no la puede validar nadie).

---

### 3.7 Compras: orden y recepción _(Fase 8)_ ✅

Dos documentos distintos porque son dos hechos distintos: **pedir** no mueve stock, **recibir** sí. La nota completa está en `docs/aprendizaje/16-fase-8-compras-y-costo-promedio.md`.

> **Cambios respecto del diseño original**, por las respuestas del cliente: sin IVA (C-11: no hay `iva_porcentaje` en ninguna línea y `empresa.costo_incluye_iva` queda sin usar); estado `CERRADA` para "lo que falta no va a llegar"; la orden nace `PEDIDA` o en `BORRADOR`; plantillas de pedidos recurrentes; `fecha_entrega_estimada` es un `date` y no un `timestamptz`; los totales se calculan, no se guardan.

#### `orden_compra`

| Campo                       | Tipo                  | Notas                                                                                                           |
| --------------------------- | --------------------- | --------------------------------------------------------------------------------------------------------------- |
| `id`, `empresa_id`          | uuid                  |                                                                                                                 |
| `sucursal_id`               | uuid → sucursal       | La que va a recibir.                                                                                            |
| `proveedor_id`              | uuid → proveedor      |                                                                                                                 |
| `numero`                    | int                   | Correlativo por empresa (ver 3.9). `UNIQUE (empresa_id, numero)`.                                               |
| `estado`                    | enum                  | `BORRADOR` \| `PEDIDA` \| `PARCIAL` \| `RECIBIDA` \| `CERRADA` \| `CANCELADA`. Ver la máquina de estados abajo. |
| `fecha_entrega_estimada`    | **date**, nullable    | Un día de calendario ("llega el jueves"), no un instante (C-8).                                                 |
| `pedida_at`                 | timestamptz, nullable | Null mientras es borrador. Un `CHECK` lo exige en todo lo que salió del borrador.                               |
| `cerrada_at`, `nota_cierre` | timestamptz, text     | Solo en `CERRADA` y `CANCELADA` (también con `CHECK`).                                                          |
| `usuario_id`, `notas`       |                       |                                                                                                                 |

#### `linea_orden_compra`

`id`, `empresa_id`, `orden_compra_id`, `insumo_id`, `presentacion_id` (nullable = unidad base), `cantidad` (en presentaciones), `factor_conversion` (snapshot), `cantidad_base` (= cantidad × factor), `precio_unitario` (por presentación, **nullable**: se puede pedir sin saber el precio, C-9). `UNIQUE (orden_compra_id, insumo_id)`.

> **No** hay `cantidad_recibida`. Lo pendiente se calcula: `cantidad_base` menos la suma de las líneas de recepciones **CONFIRMADAS**. Las anuladas no suman, y eso es lo que hace que anular "reabra" la orden sola.

#### La máquina de estados

```
crear ──► BORRADOR ──pedir──► PEDIDA ──recibir parte──► PARCIAL ──recibir resto──► RECIBIDA
  └──────(o directo)──────────►  │                        │
                                 └──cancelar──► CANCELADA └──cerrar──► CERRADA (con faltante)
```

`PEDIDA`, `PARCIAL` y `RECIBIDA` **no las elige nadie**: se calculan de lo recibido. Las acciones permitidas por estado son una tabla en `shared/dominio/compras.ts`; la API manda en el detalle la lista `acciones` y la pantalla muestra solo esos botones. Editar, además, exige que la orden no tenga ninguna recepción (ni anulada).

#### `recepcion_compra`

| Campo                                              | Tipo               | Notas                                                              |
| -------------------------------------------------- | ------------------ | ------------------------------------------------------------------ |
| `id`, `empresa_id`, `sucursal_id`, `proveedor_id`  | uuid               |                                                                    |
| `orden_compra_id`                                  | uuid, **nullable** | Null = recepción directa sin orden previa (decisión 5).            |
| `numero`                                           | int                | Correlativo por empresa.                                           |
| `fecha`                                            | timestamptz        | Cuándo llegó.                                                      |
| `numero_remito`, `numero_factura`                  | text, nullable     | Para cruzar con el papel que trajo el repartidor.                  |
| `estado`                                           | enum               | `CONFIRMADA` \| `ANULADA`. No tiene borrador: lo que llegó, llegó. |
| `operacion_id`                                     | uuid               | El de los movimientos `COMPRA` que escribió.                       |
| `anulada_at`, `anulada_por_id`, `motivo_anulacion` |                    | Van juntos o no van (`CHECK`).                                     |

#### `linea_recepcion_compra`

`id`, `empresa_id`, `recepcion_compra_id`, `linea_orden_compra_id` (nullable), `insumo_id`, `presentacion_id`, `cantidad`, `factor_conversion`, `cantidad_base`, `precio_unitario` (**obligatorio**, C-7), `costo_unitario_base` (= precio ÷ factor: $25.000 / 25 kg = $1.000/kg). El total de la recepción se calcula.

#### `plantilla_pedido` y `linea_plantilla_pedido`

Pedido recurrente con nombre ("Pedido semanal Molino"): proveedor, sucursal, notas, `activa`, y líneas con insumo, presentación y cantidad. **Sin precios** (con inflación estarían viejos a la segunda semana: al usarla se sugiere el último precio pagado). No se gasta al usarla.

#### En `insumo` y en `movimiento_stock`

- `insumo.costo_promedio` (numeric(18,4), nullable): el CPP de toda la empresa. **Valor derivado:** se reconstruye, nunca se edita.
- `movimiento_stock.recepcion_compra_id`: el documento que originó la compra (o su reversa). `CHECK`: un `COMPRA` siempre tiene recepción **y** costo.
- `movimiento_stock.costo_unitario` ahora se llena siempre que se sepa: el costo real en las compras, el promedio del momento (congelado) en todo lo demás.

**Qué pasa al confirmar una recepción (todo en UNA transacción):**

1. Número de documento (candado del contador).
2. La recepción y sus líneas.
3. Un movimiento `COMPRA` positivo por línea, con su costo, **por el motor**.
4. Reconstrucción del **costo promedio ponderado** de cada insumo.
5. Si tiene orden: no se recibe más de lo pendiente (leído con el candado de la orden) y se recalcula el estado.
6. Actualización de `ultimo_precio` y `ultimo_precio_at` en `proveedor_insumo` (C-7). Si no existía la asociación, se crea. Una recepción con fecha vieja no pisa un precio más nuevo.
7. Auditoría.

**El costo promedio ponderado, con números:**

```
Hay 100 kg comprados a $1.000/kg   → valor en depósito = $100.000
Llegan 50 kg a $1.300/kg           → valor que entra   =  $65.000

nuevo promedio = (100.000 + 65.000) / (100 + 50) = 165.000 / 150 = $1.100/kg
```

Las cuatro reglas: solo las compras mueven el promedio; el stock sin costo (saldo inicial) toma el precio de la primera compra (decisión del cliente); sin stock o en negativo, el precio nuevo manda; una compra anulada y su reversa se saltean las dos.
**Decisión:** el costo promedio es **por empresa**, no por sucursal. Está anotado en los riesgos como algo a revisar.
**Al anular una recepción** se escriben las reversas, la recepción queda `ANULADA`, y se **reconstruyen** el costo promedio (`recalcularCostoPromedio`), el último precio del proveedor y el estado de la orden. Una `COMPRA` **no** se puede anular desde el historial de movimientos: solo desde su recepción.

**El orden de los candados** (para que no haya abrazos mortales): recepción → orden → contador → `insumo_sucursal` → `insumo` (con `FOR NO KEY UPDATE`, ver la nota 16) → `proveedor_insumo`.

---

### 3.8 Transferencias entre sucursales _(Fase 9)_ ✅

#### `transferencia`

`id`, `empresa_id`, `sucursal_origen_id`, `sucursal_destino_id`, `numero` (correlativo por empresa), `estado` (enum `ENVIADA` \| `RECIBIDA` \| `ANULADA`), `notas`, `fecha_envio` + `usuario_envio_id` + `operacion_envio_id`, `fecha_recepcion` + `usuario_recepcion_id` + `operacion_recepcion_id` + `nota_recepcion` (null hasta recibir), `anulada_at` + `anulada_por_id` + `motivo_anulacion`.
`CHECK`: origen ≠ destino; los datos de recepción y de anulación van juntos o no van; no se recibe antes de enviar. Que las dos sucursales sean de la misma empresa lo controla el servicio (un `CHECK` solo ve la fila).

#### `linea_transferencia`

`id`, `empresa_id`, `transferencia_id`, `insumo_id`, `cantidad_ingresada` + `unidad_ingresada_id` + `factor_conversion` (lo que tipeó quien envió), `cantidad_base_enviada`, `cantidad_base_recibida` (null hasta recibir; `CHECK` entre 0 y lo enviado), `costo_unitario` (el promedio al enviar, congelado). `UNIQUE (transferencia_id, insumo_id)`.

Y en `movimiento_stock`, `transferencia_id`, con un `CHECK`: todo `TRANSFERENCIA_*` tiene su transferencia.

**El flujo, movimiento por movimiento:**

- **Enviar** (origen) → `TRANSFERENCIA_SALIDA` (negativo), por el motor: controla stock (o `forzar` con permiso) y congela el costo. Queda `ENVIADA`.
- **Mientras está `ENVIADA`** → la mercadería está **en tránsito**: ya no está en el origen y todavía no está en el destino. La bandeja "en tránsito" es la lista de transferencias `ENVIADA`.
- **Recibir** (destino) → `TRANSFERENCIA_ENTRADA` por lo **enviado** y, si llegó menos, una `MERMA` **en el destino** por la diferencia, con motivo _"Diferencia en transferencia"_ (decisión del cliente). Las dos al costo de la salida. Estado `RECIBIDA`.
- **Anular** → solo si está `ENVIADA`, desde el origen: `REVERSA` de cada salida. Una recibida no se anula: se corrige con una transferencia en sentido contrario.

> **Corrección del diseño original:** decía "merma en el **origen**". Con números: el origen ya bajó 20 al enviar; una merma de 2 ahí lo hacía bajar 22. Ver la nota 17.

_Test clave:_ la suma del stock de las dos sucursales antes y después es idéntica, salvo exactamente la merma declarada.

---

### 3.9 Numeración de documentos _(Fase 8)_

#### `contador_documento`

`empresa_id` + `tipo_documento` (clave primaria compuesta), `ultimo_numero` (int).

_Por qué una tabla y no `MAX(numero) + 1`:_ si dos usuarios confirman una recepción en el mismo instante, los dos leen el mismo máximo y generan el mismo número. La solución es bloquear la fila del contador dentro de la transacción, incrementar y seguir: el segundo usuario espera unos milisegundos y obtiene el número siguiente.

**Implementado (Fase 8)** con una sola sentencia, `INSERT ... ON CONFLICT DO UPDATE SET ultimo_numero = ultimo_numero + 1 RETURNING ultimo_numero`: crea la fila la primera vez, incrementa las siguientes, y el `UPDATE` deja la fila bloqueada hasta el commit. Si la transacción falla, el incremento se deshace: no quedan huecos. Tipos: `ORDEN_COMPRA`, `RECEPCION_COMPRA` (la Fase 9 agrega `TRANSFERENCIA`).

---

### 3.10 Mapa de relaciones

```
empresa ─┬─< sucursal ──────────────< usuario_sucursal >────── usuario
         │        │                                               │
         │        └──< insumo_sucursal >── insumo                 │
         │                                   │                    │
         ├─< unidad_medida ◄── insumo.unidad_base_id              │
         ├─< categoria_insumo ◄── insumo.categoria_id             │
         ├─< insumo ─┬─< presentacion_insumo                      │
         │           └─< proveedor_insumo >─── proveedor          │
         ├─< proveedor ─┬─< orden_compra ──< linea_orden_compra   │
         │              └─< recepcion_compra ──< linea_recepcion  │
         ├─< transferencia ──< linea_transferencia                │
         ├─< conteo_fisico ──< linea_conteo_fisico                │
         ├─< motivo_movimiento                                    │
         ├─< contador_documento                                   │
         ├─< auditoria ────────────────────────────────────────────┤
         └─< movimiento_stock ─────────────────────────────────────┘
                 │
                 └─ apunta a: sucursal, insumo, usuario, motivo,
                    unidad_ingresada y (opcionalmente) al documento
                    que lo originó: recepcion_compra | transferencia |
                    conteo_fisico, o a otro movimiento (revierte_a_id).

Leyenda:  A ─< B  =  una A tiene muchas B        >──  =  tabla puente (N:M)
```

**Resumen: 24 tablas.** Ninguna se crea "por si acaso": cada fase crea solo las que necesita.

| Fase | Tablas que agrega                                                                                        |
| ---- | -------------------------------------------------------------------------------------------------------- |
| 1    | `empresa`, `sucursal`, `usuario`, `usuario_sucursal`                                                     |
| 2    | `sesion`, `auditoria`                                                                                    |
| 3    | `unidad_medida`                                                                                          |
| 4    | `categoria_insumo`, `insumo`, `presentacion_insumo`, `insumo_sucursal`                                   |
| 5    | `proveedor`, `proveedor_insumo`                                                                          |
| 6    | `motivo_movimiento`, `movimiento_stock`                                                                  |
| 7    | `conteo_fisico`, `linea_conteo_fisico`                                                                   |
| 8    | `contador_documento`, `orden_compra`, `linea_orden_compra`, `recepcion_compra`, `linea_recepcion_compra` |
| 9    | `transferencia`, `linea_transferencia`                                                                   |
| 10   | — (una **vista** SQL, no una tabla)                                                                      |

_Por qué diseñar las 24 ahora pero crearlas de a poco:_ diseñar completo evita descubrir en la fase 8 que la tabla de la fase 4 le falta una columna crítica. Crear de a poco evita escribir 24 tablas que nadie probó, y te hace practicar migraciones varias veces en lugar de una.

---

### 3.11 Cómo se calcula el stock

No hay columna `stock_actual`. El saldo de un insumo en una sucursal es:

```sql
SELECT SUM(cantidad_base)
FROM   movimiento_stock
WHERE  empresa_id = $1 AND sucursal_id = $2 AND insumo_id = $3;
```

Como los movimientos ya llevan signo, **sumar es todo lo que hay que hacer**. No hay `CASE WHEN tipo = 'COMPRA' THEN ... ELSE ...`: esa clase de consulta es la que se olvida de un tipo nuevo y empieza a dar números mal.

- **Fases 6 a 9:** se usa `groupBy` de Prisma sobre esa tabla con el índice correspondiente. Para una panadería (unos pocos miles de movimientos por año) es instantáneo.
- **Fase 10:** cuando necesitemos cruzar el saldo con `insumo_sucursal.stock_minimo` para las alertas, creamos una **vista** SQL (`v_stock_actual`): una consulta guardada en la base con nombre, que se usa como si fuera una tabla. Así el JOIN lo hace Postgres y no JavaScript.
- **Si algún día pesa de verdad** (decenas de millones de filas): tabla de saldos actualizada en la misma transacción que el movimiento, **más** una función que la reconstruya desde el kardex para poder auditarla. No antes: optimizar sin un problema medido es la forma más común de agregar bugs.

---

### 3.12 Qué queda preparado (y NO se implementa ahora)

| Qué                          | Cómo entra después, sin romper nada                                                                                                                                                                                                                                                                                        |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Lotes y vencimientos**     | Tabla `lote` (insumo, código, vencimiento, sucursal) + columna `lote_id` nullable en `movimiento_stock` + política de salida (FIFO / por vencimiento). Los movimientos viejos quedan con `lote_id = NULL` = "sin lote", y el saldo total sigue siendo la misma suma.                                                       |
| **Recetas y producción**     | `receta` + `receta_insumo` (insumo, cantidad en unidad base). Una orden de producción genera movimientos `CONSUMO` con `orden_produccion_id`. **El motor de movimientos no cambia:** solo se agrega un documento más que lo invoca. Esta es la prueba de que el diseño está bien: producción es un cliente más del kardex. |
| **Productos terminados**     | Tabla `producto` separada de `insumo` (tienen atributos distintos: precio de venta, si se vende por unidad o por peso) + su propio stock sobre la **misma** tabla de movimientos, agregando `producto_id` nullable.                                                                                                        |
| **POS / caja / pedidos**     | Documentos de venta que generan movimientos de salida de productos.                                                                                                                                                                                                                                                        |
| **Venta mayorista**          | Cliente + lista de precios; sale de la central.                                                                                                                                                                                                                                                                            |
| **Costo por sucursal**       | Mover `costo_promedio` de `insumo` a `insumo_sucursal` y hacer que las transferencias lleven el costo del origen al destino.                                                                                                                                                                                               |
| **Roles a medida**           | Tablas `rol` y `rol_permiso`; el enum actual queda como rol preexistente.                                                                                                                                                                                                                                                  |
| **Multi-moneda / inflación** | `moneda` ya está en `empresa`; haría falta tabla de cotizaciones y decidir en qué moneda se valoriza.                                                                                                                                                                                                                      |
| **Offline**                  | Es un cambio de arquitectura, no una tabla: exige IDs generados en el cliente (ya los tenemos: UUID), cola de operaciones y resolución de conflictos. Los UUID y la inmutabilidad de los movimientos nos dejan bien parados, pero es un proyecto en sí mismo.                                                              |

---

## 4. Plan de implementación por fases

### 4.0 Qué cambié de tu propuesta y por qué

Tu plan tenía 9 fases (0 a 8). Propongo **12**, básicamente partiendo las que eran demasiado grandes:

| Cambio                                                                                         | Por qué                                                                                                                                                                                                                                                             |
| ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| La Fase 0 termina con una **rebanada vertical** (un dato que viaja de Postgres a la pantalla). | Es el momento más frustrante de cualquier proyecto: variables de entorno, CORS, proxy, tipos entre paquetes. Resolverlo con un endpoint trivial, antes de que exista lógica, significa que cuando falle algo después vas a saber que es tu código y no la plomería. |
| Las migraciones y el seed **no** se hacen todos en la Fase 1: cada fase crea sus tablas.       | Escribir 24 tablas de una no se puede verificar. Además así practicás migraciones 9 veces, que es la habilidad real.                                                                                                                                                |
| **Unidades y conversiones** son su propia fase (3), antes del catálogo.                        | Es lógica pura, sin base de datos y sin pantalla: la función ideal para aprender a testear. Y todo lo demás depende de ella, así que conviene que esté probada antes.                                                                                               |
| Catálogo (4) y proveedores (5) separados.                                                      | Dos CRUDs seguidos; el de proveedores incluye una relación N:M con atributos, que es un concepto nuevo y merece su propio paso.                                                                                                                                     |
| **Movimientos** (6) separados de **conteo físico** (7).                                        | La Fase 6 es la más difícil del proyecto (transacciones, concurrencia, inmutabilidad, signos). Mezclarla con el conteo garantiza no entender ninguna de las dos.                                                                                                    |
| La **auditoría** se hace en la Fase 2, no al final.                                            | Se escribe desde los servicios. Agregarla al final obliga a volver a tocar y re-testear todo lo ya hecho.                                                                                                                                                           |
| El **costo promedio** aparece en la Fase 8 (compras).                                          | Es la primera vez que existe un costo real. Antes no hay nada que promediar.                                                                                                                                                                                        |

**Formato de cada fase:** Objetivo · Tareas · Qué vas a aprender · Terminado cuando (verificable por vos) · Fuera de esta fase · Commit sugerido.

**Regla que vale para las 12:** ninguna fase se considera terminada si `pnpm typecheck && pnpm lint && pnpm test` no pasa en verde.

---

### Fase 0 — Setup del repo y rebanada vertical

**Objetivo:** que el proyecto arranque con un comando y que un dato viaje desde Postgres hasta el navegador.

**Tareas**

1. `git init`, `.gitignore` (node_modules, dist, `.env`), `.editorconfig`, `README.md` con los comandos.
2. Instalar pnpm: `npm install -g pnpm` (no tenés corepack disponible en este Node, así que este es el camino).
3. `pnpm-workspace.yaml` con `apps/*` y `packages/*`; `package.json` raíz con los scripts `dev`, `build`, `test`, `lint`, `typecheck`.
4. `tsconfig.base.json` con `strict: true` y los paquetes extendiéndolo.
5. `packages/shared`: paquete TypeScript mínimo que exporta algo trivial, consumido por los otros dos (así verificás que los workspaces funcionan).
6. `apps/api`: Express + `GET /api/health` que ejecuta `SELECT 1` contra Postgres y responde `{ api: "ok", db: "ok" }`. Variables de entorno validadas con Zod al arrancar (si falta `DATABASE_URL`, el servidor **no** arranca y dice qué falta).
7. `apps/web`: Vite + React + Tailwind + una página que consume `/api/health` con TanStack Query y muestra el estado.
8. `docker-compose.yml`: Postgres 18 con volumen persistente y `healthcheck`. `.env.example` versionado, `.env` ignorado.
9. Proxy de Vite: `/api` → `http://localhost:3000` (y entender por qué esto evita configurar CORS en desarrollo).
10. ESLint + Prettier + Vitest, con un test trivial en `api` y en `shared` que pase.

**Qué vas a aprender:** monorepo y workspaces; TypeScript strict y `tsconfig` compartido; variables de entorno y por qué nunca van al repositorio; Docker Compose y volúmenes; qué es CORS y por qué un proxy de desarrollo lo evita; por qué conviene una rebanada vertical antes de la lógica.

**Terminado cuando** (verificalo vos):

- `docker compose up -d` deja Postgres andando y `docker compose ps` lo muestra _healthy_.
- `pnpm dev` levanta API y web juntos.
- En `http://localhost:5173` ves "API ok · DB ok".
- Si bajás la base, la página muestra un error claro en lugar de quedar colgada.
- `docker compose down && docker compose up -d` y los datos siguen (el volumen funciona).
- `pnpm typecheck && pnpm lint && pnpm test` en verde.

**Fuera de esta fase:** cualquier tabla, pantalla o concepto del negocio.

**Commit sugerido:** `chore: setup del monorepo con api, web, shared y postgres`

---

### Fase 1 — Modelo núcleo, migraciones y seed

**Objetivo:** tener empresa, sucursales y usuarios en la base, creados con migraciones versionadas y poblados con datos reales de la panadería del cliente.

**Tareas**

1. Instalar Prisma; configurar `schema.prisma` (datasource Postgres, generator client).
2. Modelar `empresa`, `sucursal`, `usuario`, `usuario_sucursal` con `@@map` a snake_case y los tipos de la sección 3.0.
3. `pnpm db:migrate` (`prisma migrate dev --name nucleo`) y **abrir y leer el `.sql` generado**, línea por línea. Esto no es opcional: es donde se aprende.
4. Cliente Prisma único en `apps/api/src/lib/db.ts`.
5. Seed **idempotente** (se puede correr 100 veces sin duplicar, usando `upsert`): la empresa, las dos sucursales (Central y la otra), un usuario de cada rol con contraseña conocida de desarrollo.
6. Probar `prisma studio` para mirar los datos, y `psql` dentro del contenedor para ver los tipos reales de las columnas.

**Qué vas a aprender:** qué es un ORM y qué hace por vos; **migración** vs _esquema_ (la migración es el historial, el esquema es el estado); claves primarias y foráneas; `UNIQUE` compuesto; por qué UUID; `timestamptz`; qué es un seed y por qué tiene que ser idempotente; `upsert`.

**Terminado cuando:**

- `pnpm db:migrate` sobre una base vacía crea todas las tablas sin errores.
- `pnpm db:seed` dos veces seguidas deja exactamente los mismos registros.
- En Prisma Studio ves la empresa con sus 2 sucursales y los 3 usuarios.
- En `psql`: `\d sucursal` muestra `uuid`, `timestamptz` y la clave foránea a `empresa`.
- Podés explicar con tus palabras qué hace cada línea del SQL de la migración.

**Fuera de esta fase:** login (eso es la Fase 2), insumos, movimientos.

**Commit sugerido:** `feat(db): modelo núcleo de empresa, sucursales y usuarios con seed`

---

### Fase 2 — Autenticación, roles, aislamiento por empresa y auditoría

**Objetivo:** que nadie pueda tocar nada sin estar logueado, que cada rol pueda hacer solo lo suyo, y que sea **imposible** ver datos de otra empresa.

**Tareas**

1. Tablas `sesion` y `auditoria` (migración propia).
2. Hash de contraseñas. _(Decisión a confirmar antes de instalar: `argon2` — más moderno y recomendado hoy — o `bcrypt` — más viejo, más ejemplos. Te pregunto antes de agregar la dependencia.)_
3. `POST /api/auth/login`, `POST /api/auth/logout`, `GET /api/auth/me`.
4. Cookie de sesión: `httpOnly`, `SameSite=Lax`, `Secure` en producción, con vencimiento. En la tabla se guarda el **hash** del token.
5. Middleware `requireAuth` → carga el usuario y sus sucursales en `req.ctx`.
6. Middleware `empresa` → fija `ctx.empresaId` **desde la sesión**. Regla inviolable: el `empresa_id` **nunca** se lee del body, del query ni de un header.
7. Matriz de permisos en código + middlewares `requirePermiso(...)` y `requireSucursal(...)`.
8. Helper `registrarAuditoria(tx, {...})`, usado desde los servicios de ahí en adelante.
9. Límite de intentos de login (rate limit) y mensaje de error genérico ("usuario o contraseña incorrectos", sin decir cuál falló).
10. Front: pantalla de login, rutas protegidas, layout con el usuario, su rol y un **selector de sucursal** (el resto del sistema trabaja siempre "en una sucursal").

**Qué vas a aprender:** hash vs cifrado y por qué una contraseña no se puede "desencriptar"; cookies `httpOnly` y por qué un token en `localStorage` es vulnerable a XSS; qué es CSRF y cómo lo mitiga `SameSite`; sesión en base vs JWT; middlewares y el orden en que corren; RBAC (control de acceso por roles); **multi-tenancy** y por qué el tenant se resuelve en el servidor.

**Terminado cuando:**

- Login correcto → aparece la cookie (visible en DevTools → Application → Cookies) y `GET /auth/me` devuelve tu usuario, rol y sucursales.
- Contraseña mala → 401 con mensaje genérico y una fila `LOGIN_FALLIDO` en `auditoria`.
- Sin cookie → cualquier endpoint protegido responde 401.
- Logout → el mismo token deja de funcionar (probalo con `curl`).
- **Test de aislamiento:** con dos empresas sembradas, un test de Vitest demuestra que el usuario de la empresa A recibe 404/403 (nunca datos) al pedir un recurso de la empresa B.
- Un `EMPLEADO` recibe 403 en un endpoint exclusivo del dueño.
- En DevTools, `document.cookie` **no** muestra la cookie de sesión (es `httpOnly`).

**Fuera de esta fase:** recuperar contraseña por email, 2FA, invitaciones. (ABM de usuarios: solo lo mínimo para crear un empleado.)

**Commit sugerido:** `feat(auth): login con sesión en cookie, roles, aislamiento por empresa y auditoría`

---

### Fase 3 — Unidades de medida y conversiones

**Objetivo:** una función de conversión probada hasta el hueso, porque todo el stock pasa por ella.

**Tareas**

1. Tabla `unidad_medida` + seed (`kg`, `g` para PESO; `l`, `ml` para VOLUMEN; `u` para UNIDAD).
2. Módulo **puro** en `packages/shared/src/dominio/unidades.ts`: `convertir(cantidad, unidadOrigen, unidadDestino)` usando aritmética decimal, nunca `number`.
3. Error de dominio explícito `DimensionIncompatibleError` cuando se intenta `kg → l`.
4. Definir y documentar la política de redondeo (a 6 decimales en la unidad base) y **por qué**.
5. Tests de Vitest: ida y vuelta (`kg→g→kg` da exactamente lo mismo), casos con decimales largos, cantidad cero, cantidad negativa, unidad inexistente, dimensiones incompatibles.
6. `GET /api/unidades`.

**Qué vas a aprender:** qué es una **función pura** y por qué es la más fácil de testear; aritmética decimal (`Decimal` vs `number`); diseñar errores de dominio en lugar de devolver `null`; tests como especificación ("el test dice qué tiene que pasar, el código obedece").

**Terminado cuando:**

- Al menos 10 casos de test en verde, incluidos los que **esperan un error**.
- `convertir(1, kg, g)` = `1000`; `convertir(2500, g, kg)` = `2.5`; `convertir(1, kg, l)` **lanza** error.
- Hacer ida y vuelta 1000 veces no acumula error decimal (hay un test que lo prueba).
- `GET /api/unidades` devuelve las 5 unidades de tu empresa.

**Fuera de esta fase:** presentaciones de compra (Fase 4), densidades (fuera de alcance salvo que el cliente lo pida).

**Commit sugerido:** `feat(unidades): catálogo de unidades y conversión decimal con tests`

---

### Fase 4 — Catálogo de insumos

**Objetivo:** dar de alta los insumos reales de la panadería, con su unidad base, presentaciones de compra y stock mínimo por sucursal.

**Tareas**

1. Tablas `categoria_insumo`, `insumo`, `presentacion_insumo`, `insumo_sucursal`.
2. Esquemas Zod compartidos (`CrearInsumo`, `ActualizarInsumo`, `CrearPresentacion`, `ParametrosSucursal`) y tipos derivados con `z.infer`.
3. Módulo `insumos` completo en 4 capas (routes → controller → service → repo).
4. Reglas del servicio **con test**: nombre único por empresa; no borrar, desactivar; no cambiar la unidad base si el insumo ya tiene movimientos (la regla se escribe ahora, se vuelve verificable en la Fase 6); la presentación pertenece al insumo; `cantidad_base > 0`.
5. Listado con búsqueda por texto, filtro por categoría y paginación.
6. Front: tabla responsive, formulario de alta/edición con React Hook Form + Zod, panel de presentaciones, panel de parámetros por sucursal, confirmación para desactivar. Botones y filas con altura cómoda para dedos (pensado para tablet).
7. Ampliar el seed: ~25 insumos reales (harina 000 y 0000, levadura fresca y seca, sal fina y gruesa, azúcar, manteca, margarina, huevos, leche, crema, dulce de leche, chocolate, esencia de vainilla, mejorador, semillas, aceite, bolsas y cajas…) con categorías, presentaciones y mínimos distintos por sucursal.

**Qué vas a aprender:** Zod + `z.infer` (un solo esquema, tipo y validación); separación en capas en la práctica; CRUD y por qué "borrar" casi nunca es borrar; paginación; TanStack Query (`useQuery`, `useMutation`, invalidación de caché); formularios controlados y validación compartida; diseño responsive y táctil.

**Terminado cuando:**

- Podés crear, editar y desactivar un insumo desde la UI, y el listado se actualiza solo (sin recargar la página).
- Un POST con nombre vacío o unidad inexistente responde 400 **indicando el campo**.
- Crear dos insumos con el mismo nombre responde 409 con un mensaje entendible.
- El insumo desactivado desaparece de los selectores pero sigue visible con el filtro "incluir inactivos".
- Un insumo tiene 2 presentaciones y mínimos distintos en cada sucursal.
- Funciona cómodo en una tablet (probalo con el modo dispositivo de DevTools, 768×1024).
- Hay tests del servicio para las 5 reglas.

**Fuera de esta fase:** movimientos, stock, nada de cantidades reales.

**Commit sugerido:** `feat(insumos): catálogo con categorías, presentaciones y mínimos por sucursal`

---

### Fase 5 — Proveedores

**Objetivo:** saber a quién le compro cada insumo, en qué presentación y a qué precio.

**Tareas**

1. Tablas `proveedor` y `proveedor_insumo`.
2. CRUD de proveedor en 4 capas, con sus esquemas Zod.
3. Asociación insumo ↔ proveedor con presentación, último precio, código del proveedor y `es_preferido`.
4. Reglas con test: un solo proveedor preferido por insumo; la presentación debe pertenecer al insumo; no se puede asociar un insumo inactivo.
5. Front: dos vistas complementarias — "insumos de este proveedor" y "proveedores de este insumo".

**Qué vas a aprender:** relaciones muchos-a-muchos **con atributos propios** y cómo se ven en Prisma; validaciones que la base no puede expresar y por eso viven en el servicio; cómo diseñar UI para relaciones (el error típico es hacer una sola pantalla y que no se entienda desde ningún lado).

**Terminado cuando:**

- Podés asociar "Harina 000" a un proveedor con la presentación "Bolsa 25 kg" y un precio.
- La API rechaza con 400 asociar una presentación que pertenece a otro insumo.
- Marcar un segundo proveedor como preferido desmarca el anterior (o lo rechaza, según lo que decidamos) — y hay un test.
- Desde la ficha del insumo ves sus proveedores; desde la ficha del proveedor, sus insumos.

**Fuera de esta fase:** órdenes de compra (Fase 8), cuentas corrientes, pagos.

**Commit sugerido:** `feat(proveedores): alta de proveedores y catálogo de insumos por proveedor`

---

### Fase 6 — Motor de movimientos: saldo inicial, consumo, mermas e historial ⭐

**Objetivo:** el corazón del sistema. Stock calculado desde movimientos inmutables, con control de stock negativo y a prueba de dos usuarios simultáneos.

> Esta es **la fase más importante y la más difícil**. Vamos a ir más despacio y con más tests que en cualquier otra. Si algo acá queda flojo, todo lo que viene después hereda el problema.

**Tareas**

1. Tablas `motivo_movimiento` y `movimiento_stock`, con los `CHECK` de signo y los índices de la sección 3.5. **Leer el SQL generado** y verificar que los CHECK están.
2. Seed de motivos.
3. Servicio `registrarMovimientos(tx, ctx, movimientos[])` — **el único** que inserta en la tabla. Hace: validar con Zod → convertir a unidad base → ordenar y bloquear → calcular saldo → validar negativo → asignar `costo_unitario` → insertar → auditar.
4. Bloqueo de concurrencia: antes de calcular el saldo, bloquear la fila `insumo_sucursal` correspondiente (`SELECT ... FOR UPDATE`). Explicación completa del problema que resuelve, con un test que lo reproduce.
5. Regla de stock negativo: bloquear con 409 y un mensaje útil ("hay 12,5 kg, intentás sacar 20 kg"); permitir forzar si el rol tiene el permiso, marcando `forzado = true` y registrando en auditoría.
6. Endpoints: `POST /api/movimientos/saldo-inicial`, `POST /api/movimientos/consumo` (multi-línea, **una sola transacción**), `POST /api/movimientos/merma` (con motivo obligatorio), `POST /api/movimientos/:id/reversa`.
7. Consultas: `GET /api/stock?sucursalId=` (saldo de todos los insumos) y `GET /api/insumos/:id/movimientos?sucursalId=` (historial con quién, cuándo, por qué, con paginación).
8. Front: pantalla "Stock por sucursal" (con el mínimo al lado y semáforo), carga de consumo multi-línea pensada para tablet, carga de merma, historial por insumo.
9. **Tests obligatorios:** la suma de movimientos da el saldo; el signo se respeta por tipo; consumir más de lo disponible falla; forzar con permiso funciona y queda marcado; una transacción que falla en la línea 3 de 5 **no deja nada** escrito; la reversa devuelve el saldo exacto; un movimiento no se puede revertir dos veces; conversión de unidades integrada (cargar 2000 g descuenta 2 kg).

**Qué vas a aprender:** el patrón **kardex**; inmutabilidad y contra-asiento; **transacciones** y ACID (por qué o se escribe todo o no se escribe nada); **condiciones de carrera** y bloqueos pesimistas — el bug que no se ve en desarrollo y aparece con dos usuarios reales; `CHECK` constraints como última defensa; índices y por qué estos; errores de dominio con códigos estables que el front puede traducir a un mensaje.

**Terminado cuando:**

- Cargo saldo inicial de 100 kg de harina y un consumo de 30 → la pantalla muestra 70 kg y el historial 2 filas con usuario y fecha.
- Intento consumir 1000 kg → 409 con un mensaje que dice cuánto hay.
- Como dueño lo fuerzo → se registra, el stock queda negativo y marcado en rojo, y hay una fila en `auditoria`.
- Anulo el consumo de 30 → aparece un movimiento `REVERSA` y el saldo vuelve a 100. El movimiento original **sigue estando** (no desapareció).
- Cargo un consumo de 6 insumos donde el 4º es inválido → la API responde error y **ninguno** de los 6 se registró (verificalo en la tabla).
- Cargo 2000 g de un insumo que se lleva en kg → descuenta 2.
- `pnpm test` con toda la lógica de stock en verde.

**Fuera de esta fase:** conteos, compras, transferencias, costo promedio (el `costo_unitario` queda en null o en 0 hasta la Fase 8).

**Commit sugerido:** `feat(stock): motor de movimientos con consumo, mermas, reversas e historial`

---

### Fase 7 — Ajuste de stock contra lo contado ✅

> **Esta fase cambió respecto del plan original**, por la respuesta del cliente a la pregunta **C-15**: _"en teoría el control de stock que va a tener este sistema va a evitar tener que contar; quizás debe permitir hacer un ajuste cada vez que el dueño quiera, poniendo nota"._
>
> El plan original era un **conteo físico** como documento con estados (`BORRADOR` → `CERRADO`), que al cerrarse generaba un `AJUSTE` por cada diferencia. Eso tiene sentido cuando varias personas cuentan un depósito grande durante horas y hace falta guardar el conteo a medias. **No es este caso:** el sistema lo va a usar mayormente el dueño (C-13), y no planea hacer conteos formales.
>
> Lo que **sí** se conservó es la parte que importa: **se carga lo contado, no la diferencia.** Ver abajo.

**Objetivo:** que el dueño pueda corregir el stock cuando no coincide con la realidad, sin poder equivocarse de signo y sin que quede sin explicación.

**Lo que NO hizo falta:** ninguna migración. El tipo `AJUSTE` y los motivos de tipo `AJUSTE` ya existían desde la Fase 6. Es la señal de que el motor de movimientos quedó bien: una operación nueva es un servicio que lo llama, no un cambio en el kardex.

**Tareas**

1. Esquemas `LineaAjusteSchema` y `AjustarStockSchema` en `packages/shared`. La línea lleva `cantidadContada` y **no** lleva diferencia ni unidad.
2. Permiso nuevo `ajuste:crear` (dueño y encargado; **no** el empleado).
3. Servicio `ajustar(ctx, entrada)`: por cada insumo, en orden y **con el candado tomado**, lee el saldo, calcula `contado − saldo` y arma un `AJUSTE` solo si la diferencia no es cero.
4. `POST /api/movimientos/ajuste`, que responde **200** y no 201: si todas las cuentas coincidían no se creó nada, y el cuerpo es un **informe**.
5. Front: pantalla `/stock/ajuste` multi-línea, que muestra junto a cada insumo lo que dice el sistema y **la diferencia calculada en vivo** mientras se escribe.

**La decisión de diseño de la fase: se carga lo CONTADO, no la diferencia**

Pedirle la diferencia a la persona es pedirle una resta con signo: _"hay 62, el sistema dice 70, entonces cargo… ¿−8 o +8?"_. Equivocarse en el signo deja el stock **al doble de mal** que antes (78 en lugar de 62) y nadie se da cuenta.

Cargando lo contado hay una sola cosa que puede estar mal: el número que contó. Y queda un invariante con su test:

> **después de un ajuste, el saldo es exactamente lo que se contó.**

Dos consecuencias lindas de ese diseño:

- **Contar cero es válido**, y es el caso más común ("se terminó y nadie lo cargó"). Las otras cargas exigen una cantidad mayor que cero; un conteo no.
- **Un ajuste nunca puede dejar el stock en negativo**, sin necesidad de ninguna validación: como lo contado no puede ser negativo, el saldo resultante tampoco. Por eso el ajuste es el único movimiento de salida que **no lleva `forzar`** — y de hecho es la forma de arreglar un stock que quedó negativo.

**Terminado cuando:**

- Tengo 70 kg de harina, cuento 62 y el sistema registra un `AJUSTE` de −8 y deja el saldo en 62. ✅
- Cuento 8,5 donde el sistema decía 8 → `AJUSTE` de +0,5. ✅
- Cuento lo mismo que dice el sistema → **no se escribe ningún movimiento**, y el informe lo dice. ✅
- Cuento 0 → el saldo queda en 0. ✅
- Un ajuste sin motivo se rechaza, y un motivo de merma en un ajuste también. ✅
- El ajuste aparece en el historial y **se puede anular** con una reversa que devuelve el saldo. ✅
- Dos ajustes simultáneos del mismo insumo no se pisan: el saldo final es una de las dos cuentas, nunca una mezcla. ✅
- El empleado recibe 403. ✅

**Fuera de esta fase:** el documento de conteo físico con estados (anotado como mejora futura, en 3.12). Si alguna vez entra más gente a contar el depósito, el modelo está preparado: sería una tabla que agrupa líneas y, al cerrarse, llama al mismo servicio de ajuste.

**Commit sugerido:** `feat(stock): ajuste de stock contra lo contado, con motivo obligatorio`

---

### Fase 8 — Compras: orden, recepción y costo promedio ✅

**Objetivo:** registrar lo que se le pide al proveedor, recibirlo (total o parcial) y que eso sume stock con su costo.

**Decisiones del cliente al arrancar la fase (8 de octubre de 2026):**

| Pregunta                                            | Respuesta                                                                                                                              |
| --------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| ¿Quién registra una recepción?                      | **El dueño y el encargado** (en sus sucursales): el camión llega aunque el dueño no esté. Pedir y anular siguen siendo solo del dueño. |
| ¿Qué pasa con lo que nunca llega?                   | **Se cierra con faltante** (`CERRADA`): deja de figurar como pendiente y queda registrado cuánto faltó.                                |
| ¿La orden pasa por borrador?                        | **Las dos cosas:** nace pedida en el momento, o queda en borrador. Y además **plantillas** con nombre para los pedidos recurrentes.    |
| ¿Cómo se valúa el saldo inicial cargado sin precio? | **Toma el precio de la primera compra.**                                                                                               |

**Lo que se hizo**

1. Tablas `contador_documento`, `orden_compra`, `linea_orden_compra`, `recepcion_compra`, `linea_recepcion_compra`, `plantilla_pedido`, `linea_plantilla_pedido`; `insumo.costo_promedio`; `movimiento_stock.recepcion_compra_id`. Una migración con 16 `CHECK` agregados a mano. Cuatro se verificaron insertando filas imposibles (compra sin recepción, orden pedida sin fecha, borrador con cierre, costo negativo); el de la compra, además, lo ejercita el test que compara el `CHECK` del signo con TypeScript.
2. Numeración por empresa con un `INSERT ... ON CONFLICT DO UPDATE ... RETURNING`.
3. Orden de compra con su máquina de estados: crear (pedida o borrador), editar (sin recepciones), pedir, cancelar, cerrar con faltante. Líneas en **presentación** con el factor snapshot.
4. Recepción con orden (precarga lo pendiente, "llegó todo", corrige cantidad y precio) o **directa**. Remito y factura.
5. Al confirmar, en una transacción: movimientos `COMPRA` por el motor → costo promedio reconstruido → estado de la orden → último precio del proveedor → auditoría.
6. Anulación de recepción: reversas + costo promedio + último precio + estado de la orden. Pide `forzar` si la mercadería ya se usó.
7. `calcularCostoPromedio` (función pura) y `recalcularCostoPromedio` (la que la aplica con el candado del insumo).
8. El motor congela el costo en cada movimiento (compras: el real; salidas: el promedio del momento).
9. Comparación de precios entre proveedores por unidad base (C-6), en "quién me lo provee".
10. Front: Compras (órdenes pendientes / todas, recepciones), orden nueva y editada con precarga desde el proveedor, detalle con acciones de la máquina de estados, recibir, recepción sin orden, detalle de recepción con anulación, plantillas, costo promedio en la ficha del insumo, remito en el historial.
11. **Tests:** 45 unitarios del dominio y los esquemas de compras (más 3 de fechas y 1 de permisos), 40 de integración de compras (incluida la concurrencia) y 5 casos nuevos de aislamiento.

**Terminado cuando** — repasado punto por punto:

- ✅ Creo una orden de 10 bolsas de harina, recibo 4 → el stock sube 100 kg y la orden queda `PARCIAL` mostrando 6 pendientes. _(test + API corriendo: saldo 0 → 100, `PARCIAL`, faltan 6)_
- ✅ Recibo las 6 restantes → `RECIBIDA`, sin pendientes. _(saldo 250, `RECIBIDA`, faltan 0)_
- ✅ El costo promedio del insumo cambia exactamente como dice el ejemplo de 3.7. _(test unitario y de integración: 1.000 → 1.100)_
- ✅ Registro una recepción directa sin orden y suma stock igual. _(125 kg: saldo 250 → 375)_
- ✅ Anulo una recepción → el stock y el costo promedio vuelven al valor anterior. _(375 → 250 y $1.200 → $1.000, con test)_
- ✅ El historial del insumo muestra la compra con el número de remito.
- ✅ Si el precio por bolsa es $25.000 y la bolsa trae 25 kg, el costo unitario queda en $1.000/kg.
- ✅ (agregado) Dos recepciones simultáneas no repiten el número; dos recepciones de lo que falta no reciben de más; dos anulaciones simultáneas del mismo insumo no se traban. Los tres tests se comprobaron **rompiendo el código a propósito**.

**Qué aprendiste:** documentos con máquina de estados; lo pendiente se calcula; numeración concurrente; costo promedio ponderado y por qué se reconstruye; por qué el costo se congela en cada movimiento; los candados de las claves foráneas y `FOR NO KEY UPDATE`; un día no es un instante.

**Fuera de esta fase:** pagos, cuenta corriente del proveedor, facturación electrónica, IVA (C-11), devoluciones al proveedor (C-12).

**Commits:** `feat(compras): órdenes, recepciones parciales y costo promedio (API)` y `feat(compras): pantallas de órdenes, recepciones y plantillas`.

---

### Fase 9 — Transferencias entre sucursales ✅

**Objetivo:** mover insumos de la central a la sucursal con confirmación del que recibe.

**Decisiones del cliente al arrancar la fase (8 de octubre de 2026):**

| Pregunta                                                       | Respuesta                                                                                                                      |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Si llega menos de lo enviado, ¿cómo se registra la diferencia? | **Merma en el destino**: entra lo enviado y se registra una merma por la diferencia, con motivo "Diferencia en transferencia". |
| C-20 y C-30 (sin responder): ¿misma empresa, al costo?         | **Sí**, se sigue con el supuesto: mismo CUIT, movimiento interno al costo.                                                     |
| ¿Quién confirma la recepción?                                  | **El dueño y el encargado** de la sucursal que recibe (no el empleado).                                                        |

**Lo que se hizo**

1. Tablas `transferencia` y `linea_transferencia`; `movimiento_stock.transferencia_id`; `TRANSFERENCIA` en la numeración; motivo de merma "Diferencia en transferencia". Una migración con 9 `CHECK` (3 verificados a mano insertando filas imposibles: origen igual a destino, recibida sin datos de recepción, salida sin transferencia).
2. `POST /api/transferencias` (enviar), `/:id/recibir`, `/:id/anular`, `GET /api/transferencias` (bandejas entrantes y salientes de una sucursal), `GET /api/transferencias/:id`, `GET /api/sucursales`.
3. Validaciones: origen ≠ destino, las dos de la empresa, operar en el origen para enviar y anular y en el destino para recibir, stock suficiente (o `forzar`), cada línea recibida entre 0 y lo enviado, no recibir antes de enviar.
4. Los movimientos de una transferencia no se anulan sueltos desde el historial.
5. Front: bandejas "Vienen para acá" / "Salieron de acá" con lo en tránsito arriba, envío con "hay X kg" por insumo, detalle que muestra la recepción o la anulación según la sucursal activa, recepción con "llegó todo" y aviso en vivo de la merma, historial con la transferencia.
6. **Tests:** 7 unitarios del dominio, 22 de integración (conservación y concurrencia incluidas) y 3 casos nuevos de aislamiento. **Más el recorrido completo en Chromium headless** con dos usuarios.

**Terminado cuando** — repasado punto por punto:

- ✅ Transfiero 20 kg de Central a Sucursal → Central baja 20, Sucursal no cambia, y aparece "en tránsito" en las dos bandejas. _(test + navegador: Central 50 → 30, Laferrere 0)_
- ✅ El encargado de la sucursal confirma 18 → Sucursal sube 18 y queda una merma de 2 ~~en Central~~ **en la Sucursal** con motivo "Diferencia en transferencia". _(test + navegador, con una encargada que solo opera en Laferrere)_
- ✅ Intentar recibirla de nuevo → 409.
- ✅ Anular una ya recibida → 409; anular una enviada → el stock de Central vuelve.
- ✅ El test de conservación del stock pasa.
- ✅ (agregado) Dos confirmaciones simultáneas: una entra y la otra 409; recibir y anular a la vez: gana una. Comprobado sacando el candado a propósito.

**Qué aprendiste:** una operación en dos lugares son dos hechos; el stock en tránsito; un ejemplo con números como revisión de diseño; permisos que dependen de la punta; **probar las pantallas en un navegador de verdad** (nota 17).

**Fuera de esta fase:** remito imprimible, transferencias de productos terminados, pedidos internos de sucursal a central, mostrar "en camino" en la pantalla de stock del destino (anotado como mejora para la Fase 10).

**Commits:** `feat(transferencias): envío, recepción con diferencias y anulación (API)` y `feat(transferencias): bandejas, envío y recepción`.

---

### Fase 10 — Alertas de stock bajo y vista de reposición ✅

**Objetivo:** que el dueño abra el sistema y vea qué hay que comprar, por sucursal y por proveedor.

**Decisiones del cliente al arrancar la fase (8 de octubre de 2026):**

| Pregunta                                      | Respuesta                                                                                                                        |
| --------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| A Laferrere le falta harina: ¿qué se sugiere? | **Primero, que la mande la Central**, con lo que le sobra por encima de su propio mínimo. Lo que la Central no cubre, se compra. |
| ¿La cantidad sugerida se redondea?            | **Sí, a bultos enteros para arriba** de la presentación del proveedor preferido (faltan 60 kg en bolsas de 25 → 3 bolsas).       |

**Lo que se hizo**

1. Migración con la vista `v_stock_actual`, escrita a mano.
2. `planificarReposicion` (función pura): objetivo = máximo o mínimo; faltante = objetivo − saldo − **ya pedido** (órdenes PEDIDA/PARCIAL, menos lo recibido) − **en camino** (transferencias ENVIADAS); el sobrante de la Central se reparte entre las otras sucursales; el resto se compra en bultos enteros. Sin mínimo configurado, no hay alerta.
3. `GET /api/reposicion` (con `compra:ver`): los ítems por sucursal, las transferencias sugeridas por destino y las compras agrupadas por proveedor **y** sucursal (cada grupo es una orden). `GET /api/alertas?sucursalId=` (sin permiso: son cantidades) para el número del menú.
4. Número de alertas en el menú (en "Reposición", o en "Stock" para quien no ve compras), rojo si hay algo sin stock.
5. Pantalla de reposición: qué manda la Central (botón "Armar la transferencia", precargada), qué comprar por proveedor con total (botón "Crear orden con esto", precargada), y el detalle por sucursal plegado. Inicio con un resumen de "hoy".
6. `EXPLAIN ANALYZE` con 330.000 movimientos (en una transacción descartada): entra por el índice y lee solo los de la empresa. Ver la nota 18.
7. **Tests:** 20 unitarios de la reposición, 12 de integración, 1 caso de aislamiento y la prueba de Playwright del recorrido completo.
8. **Playwright** quedó en el proyecto (`e2e/`, `pnpm test:e2e`), con base propia (`panaderia_e2e`): 4 pruebas.

**Terminado cuando** — repasado punto por punto:

- ✅ Pongo el mínimo de la harina en 50 kg teniendo 40 → aparece en la alerta de esa sucursal, agrupada bajo su proveedor preferido, sugiriendo la cantidad a pedir. _(test: faltan 60 hasta el máximo → 3 bolsas, $75.000)_
- ✅ Un insumo en 0 aparece como crítico, arriba de los demás.
- ✅ Si tengo una orden pendiente por 100 kg, la vista lo muestra como "ya pedido" y no lo cuenta dos veces. _(comprobado rompiendo el descuento: fallan 3 tests)_
- ✅ La alerta de la sucursal A no mezcla insumos de la sucursal B.
- ✅ `EXPLAIN ANALYZE` no muestra un recorrido completo de `movimiento_stock`. _(Bitmap Index Scan, 30.000 de 330.000 filas, 9,6 ms)_
- ✅ Desde la vista puedo generar una orden de compra con las cantidades sugeridas. _(test de integración + Playwright: la orden se crea precargada y después la reposición la muestra como "cubierto")_
- ✅ (agregado) Desde la vista puedo armar la transferencia desde la Central, y lo que viene en camino deja de sugerirse.

**Qué aprendiste:** vistas SQL y cuándo valen la pena; JOIN entre datos configurados y derivados; leer un plan de `EXPLAIN` (y por qué con pocos datos miente); una pantalla ordenada en el orden en que se actúa; la regla del `<select>` controlado.

**Fuera de esta fase:** avisos por email/WhatsApp, predicción de consumo, punto de pedido automático por rotación, usar los días de entrega del proveedor para anticipar el pedido (mejora futura: hoy se muestran, no se calculan).

**Commit:** `feat(reposicion): alertas y vista de reposición por sucursal y proveedor`

---

### Fase 11 — Endurecimiento, deploy y backups 🟡 lista para desplegar

**Objetivo:** que el sistema pueda usarse de verdad en la panadería y que un desastre no se lleve los datos.

**Decisiones del cliente al arrancar la fase (9 de octubre de 2026):**

| Pregunta               | Respuesta                                                                                                                                                                     |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ¿Dónde se despliega?   | **Vercel** (front y API) y **Supabase** (la base). Las cuentas las crea y paga el cliente más adelante: queda todo listo y un paso a paso (`docs/deploy-vercel-supabase.md`). |
| ¿Dependencias nuevas?  | **helmet**, **pino** y **pino-http**.                                                                                                                                         |
| ¿Integración continua? | **Sí**, GitHub Actions.                                                                                                                                                       |

**Lo que se hizo**

1. Índices con volumen realista: 3 años simulados (75.000 movimientos + 500.000 de otra empresa). Las cuatro consultas principales entran por índice; la más lenta, 14 ms. Ningún índice nuevo.
2. Logs JSON (pino) con id de pedido (`X-Request-Id`), cookie y contraseñas ocultas; error inesperado → mensaje genérico con el código, detalle completo solo en el log. Un cuerpo inválido es 400 y uno enorme 413 (antes caían como 500).
3. helmet en la API; cabeceras del front en `vercel.json` (CSP sin scripts en línea, HSTS, sin iframes); límite general de pedidos por IP; cookies `Secure` en producción; `TRUST_PROXY` para la IP real detrás de Vercel. CORS: no hace falta (front y API en el mismo dominio) y queda cerrado.
4. Configuración de producción documentada en `.env.example` y validada al arrancar (`LOG_LEVEL`, `DB_POOL_MAX`, `TRUST_PROXY`, `LIMITE_PEDIDOS_POR_MINUTO`, `DIRECT_URL`). Secretos fuera del repo.
5. Migraciones en el build de Vercel con `prisma migrate deploy`, **solo** en producción (las previews no migran) y por conexión directa (`DIRECT_URL`).
6. **Backups:** `pnpm db:backup` (7 diarios + 4 semanales, verifica que tenga tablas) y `pnpm db:restaurar` (en una base nueva). **Restauración probada:** el simulacro encontró un bug del restore (corregido) y después las 25 tablas quedaron idénticas, con la API andando contra la base restaurada. Backup diario de producción en GitHub Actions, **cifrado** (el repo es público).
7. `docs/operacion.md`: verificar, crear usuarios, backup, restaurar, desplegar, volver atrás, qué no hacer nunca.
8. CI en GitHub Actions: formato, tipos, lint, tests y Playwright en cada push, contra **Postgres 17** (la versión de Supabase). Playwright corre contra el **build de producción** con las cabeceras de `vercel.json`.
9. Vercel + Supabase preparados: `vercel.json`, `api/index.js` (probado simulando Vercel), **RLS en todas las tablas** con su test (Supabase publica las tablas por una API REST pública), alta de producción (`pnpm --filter @panaderia/api alta empresa|usuario`) y la semilla bloqueada fuera de la base local.

**Terminado cuando** — repasado punto por punto:

- ✅ Borro la base local, restauro el último backup y el sistema arranca con todos los datos. _(En una base nueva, para no borrar los datos de prueba del cliente: 25 tablas idénticas y la API entra y muestra el stock.)_
- ⏳ El sistema anda en la URL de producción y el dueño puede loguearse desde la tablet de la panadería. _(Pendiente: faltan las cuentas. Simulado localmente: función de Vercel en modo producción, cookie `Secure`, cabeceras e IP real.)_
- ✅ Un error inesperado devuelve un mensaje genérico al usuario y el detalle completo queda en los logs. _(test)_
- ⏳ El backup corre solo y existe un archivo de ayer. _(El workflow está; no hace nada hasta que estén los secretos de Supabase.)_
- 🟡 Existe el documento de operación y alguien que no sea vos lo puede seguir. _(Existe; que lo siga otra persona no se puede verificar desde acá.)_

**Qué aprendiste:** desarrollo vs producción (12-factor); logs útiles vs ruido; cabeceras de seguridad y CSP; backup y restore (y por qué hay que probarlo); RLS y la API pública de Supabase; integración continua; serverless y el pooler de conexiones (nota 19).

**Commits:** `chore(api): endurecimiento…`, `chore(ops): backups…`, `chore(deploy): Vercel listo…`, `chore(deploy): Supabase listo…`.

---

### Fase 12 y siguientes — fuera de esta etapa

Recetas, producción, productos terminados, POS/caja, pedidos, clientes, venta mayorista, personal, reportes avanzados, avisos, facturación ARCA y funcionamiento offline. El diseño de la sección 3.12 explica cómo entra cada uno. **No se escribe una línea de código de estos módulos hasta cerrar la Fase 11.**

---

## 5. Preguntas abiertas para el cliente

Hacelas **antes de la Fase 4** (la Fase 0 a 3 no dependen de ninguna). Para cada una hay un supuesto por defecto, así ninguna respuesta pendiente bloquea el trabajo: si el cliente no contesta, seguimos con el supuesto y queda documentado.

> **IMPORTANTE:** la sección **5.1** tiene las respuestas que ya dio el cliente. Donde hay respuesta, **manda la respuesta** y el supuesto de las tablas de abajo queda sin efecto.

---

### 5.1 Respuestas del cliente — 8 de octubre de 2026

| #    | Respuesta                                                                                                                                                               | Qué cambia                                                                                                                                                                                                                  |
| ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| C-1  | No lo sabe con precisión; **menos de 100** insumos.                                                                                                                     | Confirma el diseño: con <100 el listado paginado y el buscador alcanzan. **No** hace falta importación masiva ni conteo rotativo por categoría.                                                                             |
| C-2  | Depende del insumo: **el sistema tiene que dejar elegir la unidad** (gramos, litros, otra). Al proveedor le compra **por cantidad / por mayor**.                        | Ya resuelto: la unidad base la elige quien da de alta el insumo, y la presentación guarda cuántas unidades base trae el bulto. Ver la investigación en **5.2**.                                                             |
| C-3  | No lo sabe.                                                                                                                                                             | **La investigación dice que SÍ pasa** (el aceite se compra en litros y en la receta se pesa). La solución no necesita densidad en el sistema: se resuelve en la **presentación**. Ver **5.2**, es lo más importante de acá. |
| C-4  | Sí, lo anota en algún lado, pero **tiene que poder cargarse a mano desde la web**.                                                                                      | La carga manual es el camino principal. La importación desde Excel queda como mejora futura, no como requisito.                                                                                                             |
| C-5  | Los identifica **por nombre**.                                                                                                                                          | Ya resuelto: el código del insumo es opcional.                                                                                                                                                                              |
| C-6  | No sabe cuántos, pero si le compra el mismo insumo a dos proveedores **quiere ver cuál salió más barato o más caro**.                                                   | **Requisito nuevo:** en "quién me lo provee" hay que marcar el precio más barato y el más caro. Pendiente, anotado en 5.3.                                                                                                  |
| C-7  | El precio **se carga cada vez que carga una compra** a ese proveedor.                                                                                                   | Confirma la Fase 8: la recepción actualiza `ultimo_precio` y `ultimo_precio_at` sola. El precio cargado a mano en la Fase 5 es solo el arranque.                                                                            |
| C-8  | No sabe los plazos, pero al pedir un lote **quiere cargar precio y fecha de entrega estimada**, y que el sistema contemple que no entregue, o que entregue **parcial**. | Confirma la orden de compra de la Fase 8 y **agrega el campo `fecha_entrega_estimada`**. La entrega parcial ya estaba prevista.                                                                                             |
| C-9  | Quiere poder cargar el precio al pedir **y** al recibir, **mejor en el momento en que lo solicita**.                                                                    | La orden de compra lleva precio por línea, y la recepción puede corregirlo. Fase 8.                                                                                                                                         |
| C-10 | Debe indicar **cuánto entregó y cuánto falta**, y lo que falta **queda pendiente** (puede llegar otro día, otra vez parcial).                                           | Confirma la orden `PARCIAL` con saldo pendiente y varias recepciones por orden. Fase 8.                                                                                                                                     |
| C-11 | **Que el sistema no contemple nada de IVA ni condición fiscal por ahora.**                                                                                              | **Saca el IVA del alcance.** El campo `empresa.costo_incluye_iva` queda sin usar (no se borra: la columna ya existe y borrarla es una migración sin beneficio). El costo es, simplemente, lo que pagó.                      |
| C-12 | No contemplar devoluciones al proveedor.                                                                                                                                | Confirma: fuera de alcance. Si llega mal, se anula la recepción o se carga una merma.                                                                                                                                       |
| C-13 | **Solo el dueño** compra. Y el sistema lo va a usar **mayormente el dueño**, al menos al principio.                                                                     | Los permisos de compra de la Fase 8 son solo `DUENO`. Y cambia una prioridad de diseño: **el camino del dueño tiene que ser el más corto**, no el del empleado.                                                             |
| C-14 | Pregunta si la materia prima **no debería descontarse sola por la producción de las recetas**.                                                                          | **La expectativa más importante de registrar.** Sí, así debería ser — y es exactamente el módulo de producción, que está **fuera de esta etapa**. El consumo manual de la Fase 6 es el puente hasta entonces. Ver 5.3.      |
| C-15 | **No piensa contar**: espera que el control de stock lo evite. Quiere poder **hacer un ajuste cuando quiera, con una nota**.                                            | **Cambia la Fase 7.** El conteo físico con documento y estados deja de ser el camino principal. Ver la Fase 7 reescrita.                                                                                                    |
| C-16 | La carga inicial **la hace él o el dueño, a mano**, con planilla o sin planilla.                                                                                        | Confirma el saldo inicial manual de la Fase 6. No hace falta un conteo físico para arrancar.                                                                                                                                |
| C-17 | **Tiene que poder configurarse: el dueño decide.**                                                                                                                      | Hoy ya se resuelve con la fecha del movimiento editable. Un "hasta qué hora es hoy" configurable queda anotado como mejora (5.3).                                                                                           |
| C-18 | **Sí** transfiere insumos entre sucursales.                                                                                                                             | Confirma la Fase 9.                                                                                                                                                                                                         |
| C-19 | **Sí**: el que recibe confirma.                                                                                                                                         | Confirma los dos pasos de la transferencia (enviada → recibida).                                                                                                                                                            |

Sin responder todavía: **C-20 a C-30**. Siguen con su supuesto.

---

### 5.2 Investigación: cómo compra sus insumos una panadería _(para C-2 y C-3)_

Esto se buscó en distribuidores mayoristas argentinos reales y en material técnico de panadería. Lo que importa para el sistema no son los precios (cambian), sino **en qué viene cada cosa**.

#### En qué se compra

| Insumo                      | Presentación típica del mayorista                | Unidad base razonable |
| --------------------------- | ------------------------------------------------ | --------------------- |
| Harina 000 / 0000           | **Bolsa de 25 kg** (el estándar argentino)       | kg                    |
| Harina integral             | Bolsa de 25 kg (algunos la venden de 30 kg)      | kg                    |
| Azúcar                      | Bolsa de 50 kg y de 25 kg                        | kg                    |
| Levadura fresca             | **Pan de 500 g**, caja de 10 kg                  | kg                    |
| Margarina para hojaldre     | **Placa de 2 kg**                                | kg                    |
| Margarina / manteca de masa | **Pan o envase de 5 kg**, caja de 10 kg          | kg                    |
| Dulce de leche repostero    | **Balde de 10 kg** (es el formato universal acá) | kg                    |
| Aceite                      | **Balde de 10, 18 o 20 litros**                  | ver abajo ⚠️          |
| Leche                       | Sachet de 1 l, bidón de 10 l                     | l                     |
| Huevo                       | **Maple de 30 u**, caja de 360 u                 | u                     |
| Cajas, bolsas de papel      | Paquete de 50, 100 o 500 unidades                | u                     |

Dos conclusiones directas:

1. **Se compra por bulto y se usa por unidad chica.** Nunca se compra "1 kg de harina": se compran bolsas. Eso es exactamente lo que resuelve `presentacion_insumo`, y confirma que la decisión de la Fase 4 estaba bien.
2. **El seed del proyecto ya refleja estas presentaciones reales.** No hay que cambiarlo.

#### ⚠️ El hallazgo importante: peso contra volumen

En una panadería profesional **se pesa todo, incluidos los líquidos**. Las recetas se escriben con el _porcentaje panadero_: la harina es el 100% y todo lo demás es una proporción **en gramos**. Un ejemplo de ficha técnica:

| Ingrediente     | Peso   | %    |
| --------------- | ------ | ---- |
| Harina          | 1000 g | 100% |
| Agua            | 650 g  | 65%  |
| Sal             | 20 g   | 2%   |
| Levadura fresca | 20 g   | 2%   |
| Aceite          | 40 g   | 4%   |

Y el aceite **se compra en litros** (balde de 20 l) pero **se usa en gramos**. Esa es literalmente la pregunta C-3, y la respuesta es **sí, pasa**.

**Cómo se resuelve sin meter densidad en el sistema:** la presentación ya guarda _cuántas unidades base trae el bulto_, así que la densidad se escribe **una sola vez, ahí**:

```
Insumo: Aceite de girasol      unidad base: kg
  Presentación "Balde 20 l"    cantidadBase: 18.4      (20 l × 0,92 kg/l)
```

De ahí en adelante el stock se lleva en kg, el consumo se carga en gramos o kg, y **el sistema nunca tiene que adivinar una densidad**: la cuenta la hizo una persona al dar de alta la presentación, con el dato del envase en la mano.

La regla, entonces, es la que ya estaba y ahora tiene fundamento:

> **Cada insumo elige UNA dimensión para su stock, la que se usa en la receta.** Si se compra en otra, la conversión vive en la presentación, no en una tabla de densidades.

La alternativa —una columna `densidad` en `insumo` y conversión PESO↔VOLUMEN automática— sigue descartada: la densidad de la harina suelta varía con la humedad y la compactación, así que el número sería falsa precisión. Queda anotada en 3.12 como mejora futura si alguna vez hace falta.

**Decisión pendiente para el alta real del catálogo:** el aceite está hoy en el seed con unidad base **litro** (no kg). Para el cliente real hay que preguntarle si la receta lo pesa o lo mide; si lo pesa, el insumo se da de alta en kg y la presentación "Bidón 10 l" lleva `cantidadBase: 9.2`.

Fuentes: [MGC Distribuidora](https://distribuidoramgc.com.ar/) · [Alsedo Lorenzo (La Plata)](https://www.alsedolorenzo.com/) · [Shopping del panadero](https://shoppingdelpanadero.com/) · [Mayorista de Legumbres](https://www.mayoristadelegumbres.com.ar/producto/harina-000-x-25-kg/) · [SMP Descartables](https://www.smpdescartables.com/collections/panaderia) · [Dulce de leche repostero balde 10 kg](https://www.vacalincomoencasa.com/productos/dulce-de-leche-repostero-vacalin-de-10-kilos/) · [Porcentaje panadero](https://calculover.com/es/food-cooking/cooking/bakers-percentage/) · [SG Systems — hidratación y pesaje gravimétrico](https://sgsystemsglobal.com/es/?p=16839)

---

### 5.3 Pendientes que salieron de las respuestas

| Qué                                                                                                                                                                                                                           | De dónde sale  | Cuándo                                      |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------- | ------------------------------------------- |
| ~~**Comparar precios entre proveedores**~~ **HECHO (Fase 8)**: "más barato" / "más caro" por unidad base en "quién me lo provee".                                                                                             | C-6            | Fase 8 (cuando el precio se actualice solo) |
| ~~**`fecha_entrega_estimada`**~~ **HECHO (Fase 8)**: la orden pedida con la fecha vencida aparece "atrasada".                                                                                                                 | C-8            | Fase 8                                      |
| **El IVA sale del alcance.** No tocar `costo_incluye_iva`; el costo es lo que pagó.                                                                                                                                           | C-11           | ya                                          |
| ~~**Permisos de compra solo para `DUENO`**~~ **HECHO (Fase 8)**: pedir y anular, solo el dueño; recibir, también el encargado (decisión del cliente).                                                                         | C-13           | Fase 8                                      |
| **El consumo automático por recetas es la expectativa número uno del cliente.** Hay que decírselo explícitamente: en esta etapa el consumo se carga a mano, y el módulo de producción va a usar el mismo motor sin cambiarlo. | C-14           | fuera de esta etapa                         |
| **"Hasta qué hora es hoy"** configurable por empresa (hoy se resuelve con la fecha editable).                                                                                                                                 | C-17           | Fase 11                                     |
| ~~**Modo claro y modo oscuro elegibles**~~ **HECHO**: selector de tres opciones (claro / oscuro / automático) en el encabezado y en el login, recordado en `localStorage`.                                                    | pedido directo | ver abajo ⬇️                                |
| ~~**Revisar la paleta y el contraste**~~ **HECHO**: 4 combinaciones estaban por debajo de WCAG AA (la peor, 2,28:1). Ahora todas pasan 4,5:1. Fuente base 17 px. Ver `docs/aprendizaje/14`.                                   | pedido directo | ver abajo ⬇️                                |

> Los dos últimos son de **usabilidad, no de funcionalidad**, y son los únicos que el cliente pidió mirando la pantalla. Conviene hacerlos como un paso propio y corto, no mezclados con una fase de negocio.

### A. Insumos y unidades

| #   | Pregunta                                                                                      | Por qué importa                                                                                                                   | Si no contesta, asumimos                                                      |
| --- | --------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| C-1 | ¿Cuántos insumos distintos maneja? (¿20, 80, 300?)                                            | Define si el catálogo necesita búsqueda avanzada, carga masiva desde Excel y conteo rotativo por categoría.                       | ~40 insumos.                                                                  |
| C-2 | Para cada insumo: ¿en qué unidad lo **usa** y en qué presentación lo **compra**?              | Es la carga inicial del catálogo y de las presentaciones. Es la pregunta más importante de todas.                                 | Harinas y azúcar en kg (bolsa 25 kg), líquidos en litros, envases por unidad. |
| C-3 | ¿Hay insumos que compra por volumen y usa por peso (aceite, leche, huevo líquido) o al revés? | Si pasa, el sistema necesita la **densidad** del insumo para convertir PESO↔VOLUMEN. Hoy el diseño **no** lo permite a propósito. | No pasa: cada insumo se maneja en una sola dimensión.                         |
| C-4 | ¿Tiene los insumos anotados en algún lado (Excel, cuaderno, sistema viejo)?                   | Si hay un Excel, conviene una importación en vez de cargar 80 insumos a mano.                                                     | No hay: se carga a mano con el seed como base.                                |
| C-5 | ¿Usa códigos internos para los insumos, o los identifica por nombre?                          | Define si el código es obligatorio y si hay que generarlo.                                                                        | Solo por nombre; el código queda opcional.                                    |

### B. Proveedores y compras

| #    | Pregunta                                                                                            | Por qué importa                                                                                                                          | Si no contesta, asumimos                                                                    |
| ---- | --------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| C-6  | ¿Cuántos proveedores tiene y le compra el mismo insumo a más de uno?                                | Justifica (o no) el proveedor preferido y la comparación de precios.                                                                     | 5–10 proveedores, algunos insumos con 2 proveedores.                                        |
| C-7  | ¿Tiene precios acordados o le cambian en cada entrega?                                              | Con inflación, define si el precio del catálogo es referencia o dato en serio, y si hace falta historial de precios.                     | Varía en cada compra; el catálogo guarda el último precio con su fecha.                     |
| C-8  | ¿Cada cuánto le compra a cada proveedor y cuántos días tarda en entregar?                           | Es lo que convierte la alerta de stock mínimo en una sugerencia útil ("pedí hoy porque tarda 3 días").                                   | Semanal; 2 días de entrega.                                                                 |
| C-9  | ¿Hace pedidos formales o los pide por teléfono/WhatsApp?                                            | Decide si la orden de compra se va a usar de verdad o si en la práctica solo se van a cargar recepciones.                                | Mixto: por eso la orden es opcional (decisión 5).                                           |
| C-10 | ¿Le llegan entregas incompletas seguido? ¿Qué hace con lo que falta: lo espera o lo da por perdido? | Define el comportamiento de la orden parcial: ¿queda abierta para siempre o se cierra manualmente?                                       | Pasa a veces; la orden queda `PARCIAL` y se puede cerrar a mano.                            |
| C-11 | ¿Es responsable inscripto o monotributista? ¿Los precios que maneja son con IVA o sin IVA?          | **Define el costo del inventario.** Si recupera el IVA, el costo es el neto; si no, el IVA es parte del costo. Afecta toda la valuación. | Monotributista: el precio pagado (con IVA) es el costo. `empresa.costo_incluye_iva = true`. |
| C-12 | ¿Devuelve mercadería al proveedor (llegó mal, vencida, no era lo pedido)?                           | Si pasa seguido, hace falta un documento de devolución. Hoy se resolvería con una merma o una anulación.                                 | Es raro; se resuelve anulando la recepción o con una merma.                                 |
| C-13 | ¿Quién decide y autoriza una compra? ¿El encargado puede comprar sin avisar?                        | Define los permisos de la Fase 8 y si hace falta un circuito de aprobación.                                                              | El dueño compra; el encargado puede cargar recepciones.                                     |

### C. Stock, consumo y conteos

| #    | Pregunta                                                                           | Por qué importa                                                                                                                                | Si no contesta, asumimos                                            |
| ---- | ---------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| C-14 | ¿Cómo registra hoy el consumo de insumos? ¿Quién lo anota y cuándo?                | Es la fase 6 entera. Si nadie lo anota hoy, el sistema va a cambiarle la rutina y hay que diseñar la pantalla para que lleve 2 minutos, no 20. | No se registra; el encargado cargará el consumo al final del turno. |
| C-15 | ¿Cada cuánto cuenta el stock? ¿Cuenta todo o por sectores? ¿Quién cuenta?          | Define si el conteo tiene que poder filtrarse por categoría y si debe guardarse parcialmente.                                                  | Mensual, todo junto, lo hace el encargado con una tablet.           |
| C-16 | ¿Tiene hoy un stock inicial confiable, o arrancamos contando?                      | Define cómo se carga el día 1: planilla o conteo físico.                                                                                       | Arrancamos con un conteo físico que carga el saldo inicial.         |
| C-17 | ¿Hasta qué hora se considera "el día de hoy"? (si cierra 22 h y carga a las 23:30) | Si la fecha del movimiento se toma automáticamente, un cierre tardío cae en el día siguiente y los números del día no cierran.                 | La fecha del movimiento es editable y por defecto es "ahora".       |

### D. Transferencias y mermas

| #    | Pregunta                                                                                                                                | Por qué importa                                                                                                                                           | Si no contesta, asumimos                                                          |
| ---- | --------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| C-18 | ¿Transfiere **insumos** entre sucursales o solo producto terminado? Y cuando llega menos de lo que salió, ¿quién absorbe la diferencia? | Es toda la Fase 9. Si solo transfiere producto terminado, la fase se simplifica o se posterga. La diferencia define en qué sucursal se registra la merma. | Sí transfiere insumos; la diferencia es merma de la sucursal que envía.           |
| C-19 | ¿Usa remito para mover mercadería entre sucursales? ¿El que recibe verifica?                                                            | Define si la recepción es un paso obligatorio de otra persona o un trámite.                                                                               | Sí: la sucursal que recibe confirma lo que llegó.                                 |
| C-20 | ¿La central le "vende" los insumos a la sucursal (con margen) o es un movimiento interno al costo?                                      | Si hay margen, la transferencia es una operación comercial con precio, no un simple movimiento.                                                           | Movimiento interno al costo.                                                      |
| C-21 | ¿Qué motivos de merma usa realmente? ¿Una merma grande necesita autorización?                                                           | Define el seed de motivos y si hace falta un circuito de aprobación.                                                                                      | Vencido, roto/derramado, plaga/humedad, error de carga, prueba. Sin autorización. |

### E. Usuarios, permisos y operación

| #    | Pregunta                                                                                         | Por qué importa                                                                                                                                                               | Si no contesta, asumimos                                      |
| ---- | ------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| C-22 | ¿Cuántas personas van a usar el sistema? ¿Cada una con su usuario o uno compartido por sucursal? | Un usuario compartido destruye la auditoría: "¿quién cargó esta merma?" deja de tener respuesta.                                                                              | Un usuario por persona: 1 dueño, 2 encargados, 2–3 empleados. |
| C-23 | ¿Un empleado puede ver precios de compra y el valor del stock?                                   | **Es una decisión de negocio, no técnica.** Define la matriz de permisos y qué columnas se le envían al front (ocultar en la pantalla no alcanza: hay que no enviar el dato). | No: el empleado ve cantidades, no precios.                    |
| C-24 | ¿Quién puede anular un movimiento o forzar stock negativo?                                       | Son los dos permisos peligrosos del sistema.                                                                                                                                  | Dueño y encargado.                                            |
| C-25 | ¿Con qué dispositivos se va a usar? ¿Hay una tablet en el depósito?                              | Define las prioridades del diseño responsive y el tamaño de los controles.                                                                                                    | PC en la oficina, tablet en el depósito.                      |
| C-26 | ¿Internet estable en las dos sucursales? ¿Qué hacen si se corta durante un conteo?               | El funcionamiento offline está fuera de alcance, pero hay que saber si es un problema real para al menos avisar bien y no perder lo cargado.                                  | Internet estable; los cortes son excepcionales.               |
| C-27 | ¿Necesita controlar vencimientos de insumos ya, o puede esperar?                                 | Es la decisión 1. Si contesta que sí y es urgente, hay que replanificar: lotes cambian el kardex.                                                                             | Puede esperar.                                                |

### F. Futuro y contexto

| #    | Pregunta                                                                                                  | Por qué importa                                                                                                                                                             | Si no contesta, asumimos             |
| ---- | --------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------ |
| C-28 | Después del stock de insumos, ¿qué es lo primero que va a querer: producción, caja o pedidos de clientes? | Define qué dejamos mejor preparado y en qué orden sigue el proyecto.                                                                                                        | Producción (recetas) primero.        |
| C-29 | ¿Va a querer facturar desde el sistema (ARCA/AFIP)?                                                       | Cambia el modelo de clientes, comprobantes y numeración. Hoy está fuera de alcance.                                                                                         | No por ahora.                        |
| C-30 | ¿Las dos panaderías son la misma empresa/CUIT o son dos?                                                  | Si son dos CUIT, podrían ser dos `empresa` — y entonces las "transferencias" serían compras y ventas entre empresas, no movimientos internos. **Esto cambiaría la Fase 9.** | Una sola empresa con dos sucursales. |

---

## 6. Riesgos y decisiones a revisar

### Riesgos técnicos

| Riesgo                                              | Qué pasa si se ignora                                                                                                                                                                                                                               | Mitigación                                                                                                                                                                                          |
| --------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Condición de carrera en el stock**                | Dos usuarios registran una salida del mismo insumo al mismo tiempo; los dos leen "hay 10 kg", los dos sacan 8, y el stock queda en -6 aunque la validación "funcionaba". Es el bug clásico: **nunca aparece en desarrollo**, siempre en producción. | Bloqueo de fila (`SELECT ... FOR UPDATE`) sobre `insumo_sucursal` dentro de la transacción, antes de calcular el saldo. Fase 6, con un test que reproduce la carrera.                               |
| **Fuga de datos entre empresas**                    | Un `where` al que se le olvidó el `empresa_id` le muestra a una panadería el stock de otra. Es el riesgo más grave de un sistema multi-empresa.                                                                                                     | `empresa_id` siempre desde la sesión; una función de repositorio que lo inyecta; test de aislamiento en cada módulo; a futuro, Row Level Security de Postgres como red de seguridad en la base.     |
| **Precisión decimal y redondeo**                    | Convertir bolsas → kg → gramos y volver acumula centésimos; el stock "no cierra" por 0,003 kg y nadie entiende por qué.                                                                                                                             | `NUMERIC` en la base, librería decimal en el código, escala definida y documentada (6 decimales en cantidades), tests de ida y vuelta. Nunca `float`, nunca `parseFloat` para calcular.             |
| **El costo promedio es un valor derivado guardado** | Si se desincroniza (por un bug, una anulación o un movimiento cargado a mano), el valor del inventario miente y nadie se da cuenta.                                                                                                                 | `recalcularCostoPromedio(insumoId)` reconstruye desde los movimientos; se usa en las anulaciones y queda como herramienta de reparación; test que compara el valor guardado contra el reconstruido. |
| **Saldo calculado con `SUM` cada vez**              | Con muchos movimientos la pantalla de stock se pone lenta.                                                                                                                                                                                          | Hoy es irrelevante (miles de filas). Índices desde el día uno, `EXPLAIN` en la Fase 10, y el camino a tabla de saldos está documentado en 3.11. **No optimizar antes de medir.**                    |
| **Migraciones en producción**                       | Una migración mal hecha con datos reales adentro puede perder información y no hay "control Z".                                                                                                                                                     | Backup **antes** de cada migración; probar la migración sobre una copia del backup; `migrate deploy` (nunca `migrate dev`) en producción; nunca editar una migración ya aplicada.                   |
| **Backups que nunca se probaron**                   | Es el riesgo que termina proyectos: el día del incendio, el `pg_dump` estaba vacío desde hacía 3 meses.                                                                                                                                             | La Fase 11 no se cierra hasta haber **restaurado** un backup en una base vacía y haberlo documentado.                                                                                               |
| **Zona horaria**                                    | Movimientos que caen en el día equivocado; reportes diarios que no cuadran.                                                                                                                                                                         | `timestamptz` en UTC, conversión solo en la capa de presentación, `fecha` del movimiento editable y separada de `created_at`.                                                                       |
| **Borrar en lugar de desactivar**                   | Borrar un insumo rompe el historial de movimientos (o la base lo impide y el usuario se frustra).                                                                                                                                                   | `activo boolean` en todos los catálogos; el borrado real no se expone nunca en la API.                                                                                                              |
| **Dependencias nuevas sin criterio**                | El proyecto termina con 40 librerías que no entendés y una de ellas sin mantenimiento.                                                                                                                                                              | Regla en `CLAUDE.md`: toda dependencia nueva se pregunta y se justifica antes de instalarla.                                                                                                        |

### Riesgos de proyecto

| Riesgo                                                                                                              | Mitigación                                                                                                                                                                                                |
| ------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Alcance que se expande** ("¿y si le agregamos la caja?"). Es la causa número uno de proyectos que nunca terminan. | El alcance está escrito en este documento. Lo que se pide de más se anota como "mejora futura" y se decide **después** de la Fase 11. La regla está en `CLAUDE.md`.                                       |
| **El cliente no usa el sistema** porque cargar el consumo lleva 20 minutos por día.                                 | Diseñar la carga de consumo y el conteo para tablet, con la menor cantidad de toques posible. Mostrarle una pantalla real al dueño en la Fase 6 y escuchar.                                               |
| **Datos iniciales malos** (nombres duplicados, "Harina" y "harina 000" como dos insumos).                           | Nombre único por empresa; carga inicial acompañada, no por mail; un conteo físico como arranque.                                                                                                          |
| **Aprender y entregar al mismo tiempo**                                                                             | Fases cortas con un criterio de "terminado" verificable, un commit por paso que funciona y una nota en `docs/aprendizaje/` por concepto nuevo. Si una fase se estira más de lo previsto, se parte en dos. |

### Decisiones a revisar más adelante (no ahora)

1. **Costo promedio por empresa vs por sucursal** (sección 3.7). Revisar cuando el cliente pida ver el valor del inventario _por sucursal_. Migración: mover la columna a `insumo_sucursal` y hacer que las transferencias trasladen el costo.
2. **Órdenes parciales que quedan abiertas para siempre.** Revisar en la Fase 8 según la respuesta a C-10: tal vez haga falta un estado `CERRADA_MANUALMENTE`.
3. **Tabla de saldos (caché) vs `SUM`.** Revisar solo si una consulta real pasa de ~300 ms.
4. **Sesión en base vs JWT.** Si en el futuro hay app móvil o varios servidores, revisar (un JWT corto + refresh token en base es el paso siguiente natural).
5. **Row Level Security de Postgres.** Es la defensa definitiva contra la fuga entre empresas. Hoy sería complejidad extra sobre un modelo que todavía está cambiando; vale la pena cuando haya clientes reales distintos.
6. **Lotes y vencimientos** (decisión 1). Revisar con la respuesta a C-27; es el cambio más grande que puede venir.
7. **Si las dos panaderías son dos CUIT distintos** (C-30), las transferencias dejan de ser movimientos internos. _Revisado al arrancar la Fase 9: se siguió con el supuesto (misma empresa, al costo). Si el cliente responde otra cosa, se revisa._

---

## 7. Definición de "terminado" de la etapa completa

La etapa de stock de materia prima está cerrada cuando el dueño puede, en el sistema y sin ayuda:

1. Entrar con su usuario y elegir sucursal.
2. Ver el catálogo de insumos con su unidad, su presentación de compra y su mínimo por sucursal.
3. Ver el stock actual de cada insumo en cada sucursal, y cuánto vale.
4. Registrar una compra (con o sin orden previa, total o parcial) y ver el stock subir con su costo.
5. Registrar el consumo del día y las mermas con su motivo.
6. Hacer un conteo físico desde la tablet y que el sistema genere los ajustes.
7. Transferir insumos de la central a la sucursal y que la sucursal confirme lo recibido.
8. Abrir la pantalla de reposición y saber qué pedirle a cada proveedor.
9. Ver el historial completo de un insumo: quién, cuándo, cuánto y por qué.
10. Y vos poder borrar la base, restaurar el backup y seguir trabajando.

Con, además: `pnpm typecheck && pnpm lint && pnpm test` en verde, toda la lógica de stock y conversiones cubierta por tests, y una nota de aprendizaje por cada concepto nuevo en `docs/aprendizaje/`.

---

## 8. Próximo paso

Arrancar por la **Fase 0**. Nada más. Cuando esté verde y commiteada, seguimos con la Fase 1.
