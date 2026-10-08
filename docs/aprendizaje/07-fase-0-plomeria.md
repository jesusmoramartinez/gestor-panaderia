# Fase 0: la plomería (y los conceptos que aparecieron al armarla)

_Escrita después de hacer la Fase 0. Cada sección es algo que apareció de verdad
mientras armábamos el proyecto, no teoría._

---

## 1. Por qué una "rebanada vertical" antes de la lógica

La Fase 0 no construye nada del negocio. Construye un endpoint que pregunta
`SELECT 1` y una pantalla que lo muestra. Parece poco, pero atraviesa **todas**
las capas del sistema:

```
navegador → Vite (proxy) → Express → pool de pg → PostgreSQL (Docker)
    ↑                                                      │
    └──────────── y la respuesta vuelve ───────────────────┘
```

Eso se llama **rebanada vertical**: una tajada finita que toca todos los pisos.

¿Por qué primero? Porque la plomería es la parte más frustrante y la que menos
tiene que ver con programar: variables de entorno, CORS, puertos, tipos entre
paquetes, permisos de Docker. Si la resolvés con un endpoint que devuelve un 1,
cuando después falle algo vas a saber que es **tu** código. Si en cambio armás
primero el módulo de insumos y no funciona, tenés que averiguar si el problema
está en tu lógica, en la conexión, en el proxy o en la configuración — cuatro
sospechosos en lugar de uno.

Y de hecho pasó: en esta fase aparecieron cinco problemas de plomería (están más
abajo). Ninguno tenía que ver con panaderías.

---

## 2. Variables de entorno, y por qué se validan al arrancar

Una **variable de entorno** es configuración que viene de afuera del código. En
este proyecto vive en `.env` (que **no** se commitea, porque tiene la contraseña
de la base) y hay un `.env.example` versionado que dice qué variables hacen falta.

¿Por qué no poner la contraseña en el código? Por dos razones: cualquiera que
vea el repositorio la tendría, y el mismo código tiene que poder correr en tu
máquina y en el servidor con valores distintos sin cambiar una línea.

Lo interesante es **validarlas**. Mirá `apps/api/src/config/env.schema.ts`:

```ts
PORT: z.coerce.number().int().positive().max(65535).default(3000),
```

Dos cosas que pasan ahí:

- **`coerce`**: en `process.env` _todo es texto_. `PORT` llega como `"3000"`, no
  como `3000`. Sin convertir, `PORT + 1` daría `"30001"`.
- **Si algo está mal, el proceso no arranca.** Sin esta validación, un
  `DATABASE_URL` mal escrito no da error al iniciar: el servidor levanta igual y
  falla recién cuando alguien usa una pantalla, con un mensaje incomprensible.

Fijate también cómo está partido en dos archivos:

| Archivo         | Qué hace                                                    | Se puede testear |
| --------------- | ----------------------------------------------------------- | ---------------- |
| `env.schema.ts` | Define el esquema y la función que valida. **Puro.**        | ✅ sí            |
| `env.ts`        | Llama a la función con `process.env` de verdad. **Impuro.** | ❌ no hace falta |

Ese patrón —**núcleo puro, borde impuro**— es el que hace testeable un sistema.
El test de `env.schema.test.ts` prueba 6 casos sin tocar el sistema operativo.

---

## 3. CORS y el proxy de desarrollo

En desarrollo hay **dos** servidores: Vite en el 5173 (el frontend) y Express en
el 3000 (la API). Para el navegador, `localhost:5173` y `localhost:3000` son
**orígenes distintos** (un origen = protocolo + dominio + puerto).

Y los navegadores bloquean por seguridad que una página de un origen lea datos
de otro, salvo que el segundo lo autorice explícitamente. Ese mecanismo se llama
**CORS** (_Cross-Origin Resource Sharing_). Existe para que una web maliciosa no
pueda leer, desde tu navegador y con tus cookies, los datos de tu banco.

Hay dos formas de resolverlo:

1. Configurar CORS en el backend (decirle a Express "aceptá pedidos del 5173").
2. **Un proxy**: que Vite reciba `/api/...` y lo reenvíe al 3000.

Elegimos el proxy (`apps/web/vite.config.ts`). Para el navegador, **todo** viene
del 5173, así que CORS no se activa: no hay nada que configurar y no hay riesgo
de dejar un CORS abierto de más. En producción tampoco hace falta, porque el
frontend y la API van a estar en el mismo dominio.

El frontend, entonces, nunca escribe `http://localhost:3000`. Escribe
`fetch('/api/health')`: una ruta relativa que funciona igual en desarrollo y en
producción.

---

## 4. El pool de conexiones

En `apps/api/src/lib/db.ts` no hay "una conexión a Postgres", hay un **pool**:
un conjunto de conexiones abiertas que se prestan y se devuelven.

¿Por qué? Porque abrir una conexión a Postgres cuesta decenas de milisegundos y
consume memoria del lado del servidor. Si abrieras una por pedido, con 5 usuarios
cargando movimientos el sistema pasaría más tiempo abriendo conexiones que
trabajando. El pool las mantiene vivas: cada pedido toma una prestada, la usa y
la devuelve.

Y una línea que parece decorativa pero no lo es:

```ts
pool.on('error', (error) => {
  console.error('[db] error en reposo:', error.message);
});
```

Si una conexión en reposo se cae (por ejemplo, reiniciás el contenedor de
Postgres), `pg` emite un evento `'error'`. **Sin ese listener, Node considera
que es un error no manejado y mata el proceso.** O sea: reiniciar la base
tiraría la API. Con el listener, la API sigue viva y abre una conexión nueva en
el próximo pedido.

---

## 5. Las 4 capas, en 15 líneas

El endpoint de salud está dividido en cuatro archivos minúsculos a propósito,
para que veas el patrón con algo trivial antes de usarlo con algo complicado:

| Archivo         | Capa        | Qué hace                                             | Qué NO hace            |
| --------------- | ----------- | ---------------------------------------------------- | ---------------------- |
| `routes.ts`     | Rutas       | `GET /health` → el controlador                       | Nada más               |
| `controller.ts` | Controlador | Llama al servicio y elige el código HTTP (200 o 503) | No sabe de Postgres    |
| `service.ts`    | Servicio    | Arma la respuesta, decide qué pasa si la base falla  | No toca `req` ni `res` |
| `repo.ts`       | Datos       | `SELECT 1`                                           | No decide nada         |

La prueba de que la separación sirve: el servicio se puede testear llamándolo
como una función común, sin levantar un servidor HTTP. Cuando en la Fase 6
hagamos el motor de movimientos, esa va a ser la diferencia entre poder testear
las reglas de stock y no poder.

---

## 6. Los `.js` en los imports (el detalle más confuso)

En `apps/api` y `packages/shared` los imports relativos llevan `.js`, aunque el
archivo sea `.ts`:

```ts
import { verificarConexion } from './repo.js'; // el archivo es repo.ts
```

Pero en `apps/web` no:

```ts
import { obtenerSalud } from './lib/api'; // sin extensión
```

No es una inconsistencia por descuido: cada uno sigue la regla de su entorno.

- **Node (api y shared)** usa **ESM**, el sistema de módulos estándar de
  JavaScript, que exige la extensión del archivo que va a existir **en tiempo de
  ejecución**. Y en ejecución el archivo es `repo.js` (el compilado), no
  `repo.ts`. TypeScript entiende esto y resuelve al `.ts` correcto.
- **El navegador (web)** no resuelve módulos: lo hace Vite antes, con
  `moduleResolution: "bundler"`, y los bundlers completan la extensión solos.

Si te olvidás el `.js` en api, el error aparece recién al ejecutar
(`Cannot find module`), no al compilar. Vale la pena acordarse.

---

## 7. `tsconfig.json` vs `tsconfig.build.json`

Esto salió de un problema concreto. El primer `pnpm test` reportó **6 tests en
`shared` cuando habíamos escrito 3**.

La causa: el build compilaba los archivos `.test.ts` a `dist/`, y Vitest
encontraba el test dos veces — una en `src/` y otra en `dist/`. Además de los
números raros, era peligroso: el de `dist/` podía ser una versión vieja.

La solución son dos configuraciones con responsabilidades distintas:

| Archivo               | Lo usa                              | Emite archivos | Incluye los tests                              |
| --------------------- | ----------------------------------- | -------------- | ---------------------------------------------- |
| `tsconfig.json`       | el editor, ESLint, `pnpm typecheck` | no             | **sí** (los tests también tienen que compilar) |
| `tsconfig.build.json` | `pnpm build`                        | sí, a `dist/`  | **no**                                         |

Regla general: **los tests se verifican pero no se publican.**

---

## 8. `AggregateError`: cuando `error.message` está vacío

Al probar el endpoint con la base apagada, el campo `detalleError` salió
**vacío**. El código era el obvio:

```ts
detalleError: error instanceof Error ? error.message : 'Error desconocido';
```

Investigando el error real apareció esto:

```
constructor      : AggregateError
message          : ""              ← ¡vacío!
code             : "ECONNREFUSED"
   sub: "connect ECONNREFUSED ::1:5432"
   sub: "connect ECONNREFUSED 127.0.0.1:5432"
```

`localhost` resuelve a **dos** direcciones: `::1` (IPv6) y `127.0.0.1` (IPv4).
Node intenta las dos, las dos fallan, y agrupa los dos fallos en un
**`AggregateError`**, cuyo propio `message` es `""` porque el mensaje está en los
sub-errores.

De ahí salió `apps/api/src/lib/errores.ts`, con la función `describirError` que
maneja: `AggregateError`, errores sin mensaje pero con código del sistema
(`ECONNREFUSED`), y el hecho de que en JavaScript se puede lanzar **cualquier
cosa** (`throw 'texto'`, `throw 42`) — por eso el parámetro es `unknown` y hay
que ir descartando casos.

La lección general: **`error.message` no siempre dice algo.** Un mensaje de error
vacío es peor que uno técnico, porque el usuario no tiene ni por dónde empezar.

---

## 9. Dos cosas de pnpm que vas a volver a ver

**El catálogo.** En `pnpm-workspace.yaml`:

```yaml
catalog:
  typescript: ^6.0.3
```

y en cada `package.json`: `"typescript": "catalog:"`. La versión se declara una
vez y los tres paquetes usan exactamente la misma. Dos versiones distintas de
TypeScript en un mismo monorepo producen errores de tipos que no se entienden.

**`allowBuilds`.** pnpm **bloquea por defecto** los scripts de instalación de las
dependencias, porque un paquete puede ejecutar código al instalarse y eso es una
vía de ataque conocida. Hay que habilitarlos uno por uno:

```yaml
allowBuilds:
  esbuild: true
```

En el mismo archivo vas a ver `minimumReleaseAgeExclude`: pnpm tampoco instala
versiones publicadas hace muy poco (si alguien publica una versión maliciosa,
suele detectarse en horas). Esas excepciones las agregó pnpm solo, porque el
linter y el plugin de React estaban recién publicados.

---

## 10. PostgreSQL 18 cambió dónde van los datos (y el contenedor moría en bucle)

El primer `docker compose up -d` dejó el contenedor **reiniciándose en bucle**.
`docker compose ps` mostraba `Restarting (1)` y nada funcionaba.

La causa estaba en los logs, y la imagen de Postgres la explica bien:

```
Error: in 18+, these Docker images are configured to store database data in a
       format which is compatible with "pg_ctlcluster" (specifically, using
       major-version-specific directory names).
       Counter to that, there appears to be PostgreSQL data in:
         /var/lib/postgresql/data (unused mount/volume)
```

Durante años, el `docker-compose.yml` de cualquier tutorial de Postgres dice:

```yaml
volumes:
  - mi_volumen:/var/lib/postgresql/data # <- asi era hasta la 17
```

**Desde la versión 18 el mount va un nivel más arriba:**

```yaml
volumes:
  - mi_volumen:/var/lib/postgresql # <- asi es desde la 18
```

Y Postgres guarda los datos en un subdirectorio por versión
(`/var/lib/postgresql/18/docker`). El motivo es poder hacer `pg_upgrade --link`
entre dos versiones mayores sin que el límite del punto de montaje se interponga:
con el esquema viejo, la 17 y la 18 querían exactamente el mismo directorio.

Dos lecciones que valen más que el dato puntual:

1. **Leé los logs del contenedor antes de buscar en internet.** El mensaje decía
   exactamente qué pasaba y por qué. Nos tomó una sola orden
   (`docker compose logs db`) y cero búsquedas.
2. **Los tutoriales envejecen.** Este cambio es reciente, así que casi todo lo
   que encuentres escrito sobre Postgres en Docker todavía dice `.../data`.
   Cuando algo que "debería funcionar" no funciona, mirá qué versión asume lo
   que estás copiando.

Nota práctica: después de corregir la ruta hubo que hacer `docker compose down -v`
para **borrar el volumen**, porque había quedado con la estructura vieja. En
desarrollo no es problema. En producción eso mismo sería una migración
planificada, con backup previo y probado (Fase 11).

---

## 11. Por qué TypeScript 6 y no 7

Cuando armamos el proyecto, TypeScript 7 ya estaba publicado como versión
estable. Igual fijamos la **6.0.3**, por un motivo concreto:

```
typescript-eslint requiere: typescript >=4.8.4 <6.1.0
```

El linter todavía no soporta TS 7. Se puede tener lo último o se puede tener el
linter, no las dos cosas. Elegimos el linter: las reglas con información de
tipos (como `no-floating-promises`, que avisa cuando te olvidás un `await`)
valen más que estar en la última versión.

**Eso es una decisión temporal con fecha de revisión:** cuando
`typescript-eslint` soporte TS 7, se sube. Está anotado para no olvidarlo.

Y es un patrón que vas a repetir toda tu carrera: la versión que podés usar no
es la más nueva, es la más nueva que **todo tu toolchain** soporta.
