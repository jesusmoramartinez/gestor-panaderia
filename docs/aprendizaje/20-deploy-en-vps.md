# Fase 11 (segunda parte): desplegar en un VPS propio

_Escrita el 29/10/2026, cuando el despliegue cambió de Vercel + Supabase al
VPS de DigitalOcean que ya corre la clínica. Cinco ideas: qué cambia de
"funciones en la nube" a "un servidor tuyo", qué es una **imagen de Docker en
dos etapas**, qué hace un **proxy inverso**, cómo se cachea una SPA, y la más
importante: **ensayar el deploy antes del deploy**, que encontró dos
problemas._

---

## 1. De "funciones" a un servidor propio

En Vercel no había un servidor: cada pedido podía levantar una función nueva,
y eso obligaba a cosas raras (una conexión a la base por función, un
"pooler" en el medio, el límite de pedidos que no servía porque cada función
tenía su propia memoria).

En el VPS hay **un proceso** de la API, siempre prendido, en un contenedor:

| Tema                 | Vercel + Supabase            | VPS                                     |
| -------------------- | ---------------------------- | --------------------------------------- |
| Conexiones a la base | 1 por función, por el pooler | un pool de 10, directo a la base        |
| Límite de pedidos    | inútil (memoria por función) | funciona (un solo proceso)              |
| Migraciones          | en el build de Vercel        | antes de activar la versión, con backup |
| La web               | la servía Vercel             | la sirve la misma API                   |
| Quién administra     | la plataforma                | **vos** (parches, backups, espacio)     |

Lo último es el precio: la plataforma ya no cuida el servidor. Por eso existe
el repo `infra`, con su plan de backups y de monitoreo.

---

## 2. ⭐ La imagen de Docker en dos etapas

Una **imagen** es una "foto" de todo lo que hace falta para correr el
programa: el sistema base (Alpine Linux), Node, las dependencias y el código.
Un **contenedor** es esa foto en ejecución. La misma imagen corre igual en la
laptop y en el servidor.

Para **compilar** hacen falta TypeScript, Vite y las dependencias de
desarrollo (cientos de MB). Para **correr**, no. Por eso el `Dockerfile` tiene
dos etapas:

```
FROM node:26.8.2-alpine AS compilar     ← instala TODO y compila
  pnpm install, build de shared, api y web
  pnpm deploy --prod                    ← separa solo las dependencias de producción

FROM node:26.8.2-alpine                 ← empieza de CERO
  COPY --from=compilar  …lo compilado…  ← y se lleva solo lo necesario
```

La imagen final no tiene TypeScript, ni Vite, ni el código fuente: solo el
JavaScript compilado, las dependencias de producción y la web ya armada.

**La lista explícita.** La etapa final no copia "todo", copia archivo por
archivo. Es a propósito: la semilla (`prisma/seed.ts`) crea usuarios con la
contraseña `panaderia123`, y una imagen de producción que la trae es una
imagen donde alguien, algún día, la puede correr. Con la lista, un archivo
nuevo **no entra** salvo que alguien lo agregue a propósito. El CI lo verifica
(`test ! -e prisma/seed.ts`). Por eso el alta se mudó a `src/alta/` y su
catálogo base a `catalogo-base.ts`: para poder entrar en la imagen **sin**
arrastrar la semilla.

**Versiones fijas** (`node:26.8.2-alpine`, `postgres:18.6-alpine`): con
`node:latest`, el mismo commit podría dar otra imagen mañana.

---

## 3. El proxy inverso (Caddy)

Un **proxy inverso** es un programa que recibe los pedidos de internet y se los
pasa al programa que corresponde. En el VPS es Caddy:

```
https://consultorios-j.duckdns.org  ──►  clinica-app:8000
https://panaderia-j.duckdns.org     ──►  panaderia-api:3000
```

Le resuelve tres cosas a cada app:

- **El HTTPS**: saca y renueva solo los certificados de Let's Encrypt. La API
  habla HTTP común, adentro.
- **Un solo punto de entrada**: Caddy es el único que publica puertos (80 y
  443). Las apps y las bases no publican nada: están en redes de Docker
  (`web` y `interna`) a las que no se llega desde afuera. Esto importa porque
  **Docker se saltea el firewall** del servidor en los puertos que publica.
- **Las cabeceras comunes** (HSTS, nosniff…), iguales para la clínica y la
  panadería.

Como entre internet y la API hay alguien en el medio, la API ve todos los
pedidos llegar desde la IP de Caddy. La IP real viene en la cabecera
`X-Forwarded-For`, y la API le cree solo porque `TRUST_PROXY=true` (y nadie
más que Caddy le puede hablar).

**¿Y si Caddy y la app ponen la misma cabecera?** Se probó: cada cabecera llega
una sola vez, y gana la de Caddy (como el bloque tiene un `-Server`, Caddy
aplica sus cabeceras al final, por encima de lo que mandó la app).

---

## 4. Cachear una SPA

Vite le pone a cada archivo un **hash** de su contenido en el nombre:
`index-DDkymBtz.js`. Si el archivo cambia, cambia el nombre. Entonces:

- `/assets/*` se guarda **un año** (`immutable`): el mismo nombre es siempre
  el mismo contenido.
- `index.html` **nunca** se guarda (`no-cache`): es el que dice qué assets
  pedir. Si quedara viejo en la tablet, después de un deploy seguiría pidiendo
  los archivos de la versión anterior.
- Cualquier otra ruta (`/stock`, `/compras/123`) devuelve `index.html`: la
  ruta la resuelve React Router en el navegador. Sin eso, recargar en `/stock`
  da 404. Pero `/api/loquesea` y `/assets/loquesea.js` que no existen dan
  **404 de verdad**: si no, el navegador recibiría HTML donde esperaba JSON o
  JavaScript.

---

## 5. ⭐⭐ Ensayar el deploy antes del deploy

Antes de tocar el servidor, se armó **el mismo circuito en la laptop**: la
imagen, el `compose.yaml` y el `actualizar.sh` del repo `infra`, un Caddy con
el mismo bloque y un navegador. Encontró dos cosas.

### La API compilada no arrancaba

```
Error [ERR_MODULE_NOT_FOUND]: Cannot find module '/app/dist/generated/prisma/enums.ts'
```

En la laptop, el cliente de Prisma generado importa `./enums.js`. En la
imagen importaba `./enums.ts`, que no existe en `dist/`. ¿Por qué distinto?
Prisma **deduce** la extensión leyendo el `tsconfig.json`. En el Dockerfile,
el `pnpm install` (que corre `prisma generate`) va **antes** de copiar el
código, para aprovechar la caché de Docker. En ese momento el tsconfig todavía
no existe, y Prisma eligió otra cosa.

Ningún test lo podía ver: los tests corren con `tsx`, que entiende `.ts`.
Nunca se había arrancado la API desde `dist/`.

El arreglo es dejar de depender de la deducción:
`importFileExtension = "js"` en el `schema.prisma`. **Un build tiene que dar
lo mismo en cualquier máquina**; si depende de qué archivos había por ahí,
tarde o temprano no da.

### El ensayo pisó la base de desarrollo

El primer intento usó el `compose.yaml` del servidor tal cual, que dice
`name: panaderia`. La base de desarrollo **también** es el proyecto
`panaderia` (el nombre de la carpeta), con un servicio que **también** se
llama `db`. Para Docker Compose, eran el mismo contenedor con otra
configuración, y lo reemplazó.

No se perdió nada: los datos viven en un **volumen**, que Compose no borra al
recrear un contenedor (y eran los de la semilla). Pero la lección vale: **para
Docker Compose, la identidad de un contenedor es "proyecto + servicio"**, no
la carpeta ni el archivo. El ensayo se repitió con
`COMPOSE_PROJECT_NAME=panaderia-sim`. En el servidor no pasa: ahí hay un solo
proyecto `panaderia`.

### Lo que el ensayo no puede ver

El certificado de Let's Encrypt (necesita el dominio de verdad), el servidor
de verdad y la tablet de la panadería. Eso se verifica al desplegar, con la
lista de `docs/deploy-vps.md`.

---

## 6. Achicar la imagen: de 715 a 306 MB

La imagen viaja entera por SSH en cada deploy, así que su tamaño importa. Al
medir qué ocupaba lugar, el 60 % era la **CLI de Prisma** y lo que arrastra:
Prisma Studio (una app web entera), PGlite (un Postgres que corre en
JavaScript), TypeScript y `effect`. ¿Para qué estaba? Solo para correr
`prisma migrate deploy`: aplicar diez archivos SQL.

Dos cambios:

1. **Un migrador propio** (`src/migraciones/migrador.ts`, 150 líneas). Hace
   lo mismo que `migrate deploy` y es **compatible** con Prisma: anota cada
   migración en la misma tabla `_prisma_migrations`, con el mismo checksum
   (el sha256 del archivo; se verificó contra la base de desarrollo) y el
   mismo candado. El test lo prueba contra la CLI de verdad: después de
   migrar con lo nuestro, `prisma migrate status` dice "up to date". Y antes
   de confiar en ese test, se comprobó que **puede fallar**: contra una base
   sin migrar, dice "have not yet been applied".
2. **Podar lo que no se usa** (`scripts/podar-dependencias.mjs`). Sacar la
   CLI de las dependencias no alcanzó: `@prisma/client` la declara como
   dependencia _opcional_ y pnpm la enlazaba igual. En vez de borrar paquetes
   por nombre (se rompe el día que Prisma agregue uno), el script recorre el
   árbol desde lo que la app usa de verdad y borra lo que no se alcanza. La
   regla se explica sola: **lo que la app no puede alcanzar, no viaja**.

Quedó `node_modules` en 38 MB (eran 344). El resto de los 306 MB es la imagen
base de Node. El CI importa la app, el alta y el migrador dentro de la imagen
podada: si algún día falta algo, falla al armarla, no en el servidor.

---

## Resumen en una línea por idea

- En un servidor propio hay un proceso siempre prendido: menos trucos, más
  responsabilidad.
- Imagen en dos etapas: compilar con todo, correr con lo justo.
- La imagen copia una lista explícita: la semilla no viaja.
- Caddy es la única puerta: HTTPS, cabeceras y ningún otro puerto abierto.
- Assets con hash, un año; `index.html`, nunca.
- Un build no puede depender de qué archivos había por ahí.
- Para Compose, un contenedor es "proyecto + servicio".
- El deploy se ensaya antes, con los mismos archivos.
- Lo que la app no puede alcanzar, no viaja en la imagen.
