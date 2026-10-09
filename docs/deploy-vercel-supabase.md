# Desplegar en Vercel + Supabase, paso a paso

Esta guía lleva el sistema de "anda en mi máquina" a "anda en internet". Todo
lo que depende del código ya está hecho y probado (ver al final, **Qué ya está
listo**). Lo que queda es crear las cuentas, conectar las piezas y cargar las
claves: eso solo lo puede hacer quien paga las cuentas.

**Tiempo estimado:** 45 minutos la primera vez.
**Orden:** primero Supabase (la base), después Vercel (la aplicación), al final
GitHub (los backups). No cambies el orden: Vercel necesita la base para
desplegar.

> Los nombres de los menús de Supabase y Vercel cambian con el tiempo. Si un
> botón no se llama exactamente igual, buscá el que hace lo mismo: cada paso
> dice **para qué** sirve.

---

## Cómo queda armado

```
                        ┌──────────────── Vercel (un proyecto, un dominio) ───────────────┐
  navegador / tablet ──►│  /            → el front (archivos estáticos de apps/web/dist)  │
                        │  /api/*       → la API (una función: api/index.js → Express)    │──► Supabase
                        └──────────────────────────────────────────────────────────────────┘    (Postgres 17)
```

- **Un solo dominio** para el front y la API: la cookie de sesión es del mismo
  sitio, así que no hace falta configurar CORS ni cookies cruzadas.
- La API **no** usa la "Data API" de Supabase ni su cliente de JavaScript: se
  conecta a Postgres directo, como hasta ahora. Supabase es, para nosotros, un
  Postgres administrado (con backups).

---

## 1. Supabase: crear la base

1. Entrá a [supabase.com](https://supabase.com) → **New project**.
2. **Region:** _South America (São Paulo)_. Es la más cercana a Argentina:
   cada consulta va y vuelve, y la distancia se nota.
3. **Database password:** generá una larga (el botón "Generate") y **guardala en
   un gestor de contraseñas**. No la vas a poder volver a ver; si la perdés, se
   puede resetear, pero hay que actualizarla en todos lados.
4. Esperá a que el proyecto termine de crearse (un par de minutos).

### 1.1 Las dos direcciones de conexión

Arriba en el proyecto, botón **Connect**. Vas a ver varias cadenas de conexión.
Necesitás **dos**, las dos del **pooler** (Supavisor):

| Para qué                     | Cuál                   | Puerto | Se va a llamar |
| ---------------------------- | ---------------------- | ------ | -------------- |
| La API (Vercel)              | **Transaction pooler** | `6543` | `DATABASE_URL` |
| Migraciones, altas y backups | **Session pooler**     | `5432` | `DIRECT_URL`   |

Las dos se ven así (reemplazá `[YOUR-PASSWORD]` por la contraseña del paso 1.3):

```
postgresql://postgres.abcdefghijkl:[YOUR-PASSWORD]@aws-0-sa-east-1.pooler.supabase.com:6543/postgres
postgresql://postgres.abcdefghijkl:[YOUR-PASSWORD]@aws-0-sa-east-1.pooler.supabase.com:5432/postgres
```

**¿Por qué dos?** En Vercel cada pedido puede levantar una función nueva, y
cada una abre su conexión. El modo _transaction_ las reparte: una conexión real
se presta solo mientras dura una transacción. Pero una migración necesita una
sesión entera para ella, y eso es el modo _session_.

**¿Por qué no la "Direct connection"?** Es solo IPv6, y ni GitHub Actions ni
muchas redes domésticas tienen IPv6. El _session pooler_ hace lo mismo por IPv4.

> Si la contraseña tiene caracteres como `@`, `#`, `/` o `?`, hay que
> "escaparlos" en la URL (`@` → `%40`, `#` → `%23`). Más fácil: generá una
> contraseña con solo letras y números.

### 1.2 Apagar la Data API (importante)

Supabase publica automáticamente las tablas por una API REST pública. No la
usamos, y dejarla prendida es una puerta abierta de más.

**Project Settings → Data API** (o **API**) → desactivá **Enable Data API**.
Si no aparece ese interruptor, sacá `public` de **Exposed schemas**.

> Aunque te olvides de esto, la base no queda abierta: la migración
> `seguridad_supabase` activa **RLS** en todas las tablas y les saca los
> permisos a los roles públicos (`anon`, `authenticated`). Pero las defensas
> van en capas: apagala igual.

### 1.3 Crear las tablas (migraciones)

Desde tu máquina, en la raíz del repo:

```bash
DIRECT_URL='<session pooler, puerto 5432>' \
DATABASE_URL='<session pooler, puerto 5432>' \
  pnpm --filter @panaderia/api exec prisma migrate deploy
```

Tiene que terminar con algo como _"All migrations have been successfully
applied"_ (son 10). Las variables puestas así le ganan al `.env`, así que no
hay riesgo de migrar tu base local por error.

> Después de la primera vez, las migraciones se aplican **solas** en cada
> despliegue de producción (ver el paso 2.3). Esto es solo para arrancar.

**Verificá:** en Supabase, **Table Editor**: tienen que aparecer las tablas
(`empresa`, `insumo`, `movimiento_stock`...) con un candado (RLS activo).

### 1.4 Dar de alta la empresa y el dueño

La semilla de desarrollo **no se usa en producción** (crea usuarios con la
contraseña `panaderia123`, y además se niega a correr contra una base que no
sea local). Para producción está el **alta**:

1. Copiá `docs/ejemplos/empresa.json` a un lugar **fuera del repo** (tiene el
   email real del dueño) y completalo: nombre de la panadería, CUIT,
   sucursales (una con `"esCentral": true`) y el dueño.
2. Corré:

```bash
ALTA_PASSWORD='la contraseña del dueño (8 o más caracteres)' \
DATABASE_URL='<session pooler, puerto 5432>' \
  pnpm --filter @panaderia/api alta empresa /ruta/a/empresa.json
```

3. Imprime el **id de la empresa**. Guardalo: hace falta para crear los demás
   usuarios (ver `docs/operacion.md`).

La contraseña va por variable de entorno y no en el archivo a propósito: un
archivo se copia, se manda por WhatsApp y se olvida en una carpeta.

---

## 2. Vercel: desplegar la aplicación

1. [vercel.com](https://vercel.com) → **Add New… → Project** → importá el repo
   de GitHub `gestor-panaderia`.
2. **Framework Preset:** _Other_. **Root Directory:** la raíz (`./`).
   Los comandos de instalación y build, y la carpeta de salida, **no se tocan**:
   salen de `vercel.json`.
3. **Antes de apretar Deploy**, abrí **Environment Variables** (paso 2.1).

### 2.1 Variables de entorno

Cargalas para el entorno **Production**:

| Variable                       | Valor                             | Por qué                                                     |
| ------------------------------ | --------------------------------- | ----------------------------------------------------------- |
| `DATABASE_URL`                 | el _transaction pooler_ (`:6543`) | la conexión de la API                                       |
| `DIRECT_URL`                   | el _session pooler_ (`:5432`)     | las migraciones del build                                   |
| `NODE_ENV`                     | `production`                      | cookies `Secure`, sin datos de desarrollo                   |
| `TRUST_PROXY`                  | `true`                            | la IP real viene de Vercel en `X-Forwarded-For`             |
| `DB_POOL_MAX`                  | `1`                               | una conexión por función (si no, se agotan las de Supabase) |
| `LOG_LEVEL`                    | `info`                            |                                                             |
| `ENABLE_EXPERIMENTAL_COREPACK` | `1`                               | para que Vercel use pnpm 12 (el del `packageManager`)       |

> **No** marques `DIRECT_URL` para **Preview**: aunque el script de migración
> ya se niega a migrar fuera de producción, mejor que las previews ni siquiera
> tengan la llave.

### 2.2 Ajustes del proyecto

- **Settings → Build and Deployment → Node.js Version:** `24.x` (la más nueva
  que ofrezca; el proyecto pide 22 o más).
- **Settings → Functions → Function Region:** _São Paulo (gru1)_, al lado de la
  base. Si la función está en Estados Unidos y la base en São Paulo, cada
  consulta cruza el continente dos veces.

### 2.3 Desplegar

Apretá **Deploy**. En el log del build vas a ver, en orden:

1. `[migrar] aplicando migraciones pendientes en producción...` →
   _"No pending migrations to apply"_ (ya las aplicaste en 1.3).
2. La compilación del paquete compartido, de la API y del front.

**Desde ahora, cada push a `main` despliega solo**, y si hay migraciones nuevas
las aplica antes de compilar. **Antes de pushear una migración nueva, hacé un
backup** (ver `docs/operacion.md`).

### 2.4 Verificar que anda

Con la URL que te da Vercel (`https://gestor-panaderia-xxxx.vercel.app`):

1. Abrí `https://…/api/health`. Tiene que decir `"db":"ok"`.
   - Si dice error de base: revisá `DATABASE_URL` (puerto **6543**, contraseña
     escapada).
2. Abrí la URL principal y entrá con el dueño del paso 1.4.
3. En la tablet de la panadería: entrá, mirá **Stock** y **Reposición**.
4. En el navegador, herramientas de desarrollo → **Application → Cookies**: la
   cookie `panaderia_sesion` tiene que tener **Secure** y **HttpOnly** tildados.

Si algo falla: **Vercel → el despliegue → Logs** (o **Runtime Logs**). Cada
línea es un JSON con un `idPedido`; si la pantalla mostró "avisá con este
código: 5196a08a", buscá ese texto en los logs y está todo lo que pasó.

### 2.5 Freno contra ataques al login (con el plan Pro)

El limitador de intentos del login vive en la memoria de cada función, y en
Vercel hay muchas: no alcanza solo. El freno de verdad es el firewall:

**Firewall → Configure → New Rule:**

- **If** _Request Path_ **equals** `/api/auth/login`
- **Then** _Rate Limit_: `10` pedidos cada `60` segundos, por **IP** → **Deny**
  (429).

### 2.6 Dominio propio (opcional)

**Settings → Domains → Add**, con un dominio que compres (por ejemplo en
nic.ar). Vercel te dice qué registro DNS crear y pone el certificado HTTPS solo.

---

## 3. GitHub: los backups automáticos

Supabase Pro ya guarda backups diarios por 7 días. Pero un backup que vive en
el mismo lugar que la base no te protege de perder el acceso a ese lugar (una
tarjeta rechazada, una cuenta bloqueada). Por eso hay un segundo backup en
GitHub, **cifrado**.

### 3.1 Pasá el repo a privado (recomendado, antes de seguir)

**El repo hoy es público.** En un repo público, los archivos que genera una
GitHub Action los puede bajar **cualquiera con cuenta de GitHub**. Los backups
van cifrados, así que sin la clave no sirven de nada, pero no hay razón para
dejarlos al alcance de cualquiera.

**Settings → General → Danger Zone → Change visibility → Private.**

Los repos privados tienen 2.000 minutos gratis de Actions por mes. El CI usa
unos 6 minutos por push y el backup 1 por día: alcanza.

### 3.2 Los secretos

**Settings → Secrets and variables → Actions → New repository secret:**

| Secreto             | Valor                                   |
| ------------------- | --------------------------------------- |
| `SUPABASE_DB_URL`   | el _session pooler_ (`:5432`)           |
| `BACKUP_PASSPHRASE` | una clave larga y aleatoria (ver abajo) |

Para generar la clave: `openssl rand -base64 32`.

> **Guardá `BACKUP_PASSPHRASE` en el gestor de contraseñas, junto a la de la
> base.** Sin esa clave, los backups son basura cifrada: no los puede abrir
> nadie, tampoco vos.

### 3.3 Probalo ya, no el día que lo necesites

1. **Actions → Backup diario → Run workflow.**
2. Cuando termine, en ese run, sección **Artifacts**, bajá
   `panaderia-diario-AAAA-MM-DD`.
3. Restauralo en tu máquina (paso a paso en `docs/operacion.md`, sección
   **Restaurar**). Si podés entrar al sistema con los datos de producción, el
   backup sirve.

Desde ahí corre solo todos los días a las 03:00 (hora de Argentina). Los
diarios duran 7 días y la copia de los domingos, 28.

---

## Qué ya está listo (y probado) del lado del código

- `vercel.json`: front estático + API como función, cabeceras de seguridad
  (CSP sin scripts en línea, HSTS, sin iframes), caché larga para los assets.
- `api/index.js`: la app de Express como función (probada simulando Vercel:
  cabeceras, cookie `Secure`, IP real detrás del proxy, rutas de la SPA).
- Migraciones en el build, solo en producción (`scripts/migrar-en-vercel.sh`).
- Logs JSON con id de pedido; errores inesperados con mensaje genérico y el
  detalle completo solo en el log.
- RLS en todas las tablas, con un test que falla si una tabla nueva no lo tiene.
- El CI corre todo contra **Postgres 17** (la versión de Supabase), incluidas
  las pruebas de Playwright contra el build de producción con las cabeceras de
  `vercel.json`.
- Backup y restauración probados: las 25 tablas idénticas fila por fila.

## Lo que NO se pudo probar sin las cuentas

Hay que verificarlo en el primer despliegue (los pasos 2.4 y 3.3):

- que Vercel empaquete bien la función (Prisma 7 trae su motor como
  WebAssembly embebido en un módulo, que es lo que el empaquetador de Vercel
  sabe seguir, pero no se probó en Vercel mismo);
- la conexión por el pooler de Supabase y el backup desde GitHub contra la base
  real.
