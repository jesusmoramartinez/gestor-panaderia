# Fase 1: Prisma, migraciones y el primer seed

_Escrita después de hacer la Fase 1. Son los conceptos que aparecieron al poner
las primeras cuatro tablas en la base._

---

## 1. Qué hace un ORM (y qué no)

Un **ORM** (_Object–Relational Mapper_) traduce entre tablas de SQL y objetos de
tu lenguaje. Con Prisma describís el modelo una vez en `schema.prisma` y obtenés
dos cosas:

1. **Las migraciones**: el SQL que lleva la base del estado anterior al nuevo.
2. **Un cliente tipado**: `prisma.usuario.findUnique(...)` existe y
   `prisma.usuarioo` no compila.

Lo que un ORM **no** hace es pensar por vos. El `schema.prisma` que escribimos
es una decisión de diseño por línea: qué va `NOT NULL`, qué índice hace falta,
qué pasa cuando se borra una fila relacionada. El ORM solo lo ejecuta.

Por eso la tarea obligatoria de esta fase fue **leer el SQL generado**. Si no lo
leés, no sabés qué pediste.

---

## 2. Migración vs esquema: historial vs estado

Son dos cosas distintas y conviene no mezclarlas:

|                 | Qué es                                       | Dónde está                                         |
| --------------- | -------------------------------------------- | -------------------------------------------------- |
| **Esquema**     | El **estado actual** deseado                 | `prisma/schema.prisma`                             |
| **Migraciones** | El **historial** de cambios, uno por archivo | `prisma/migrations/<fecha>_<nombre>/migration.sql` |

Y hay una tercera pieza que apareció sola en la base:

```
 public | _prisma_migrations | table
```

Esa tabla es el **registro de qué migraciones ya se aplicaron** en _esta_ base.
Es cómo Prisma sabe, al arrancar, si falta aplicar algo. Si la borrás, Prisma
cree que la base está vacía e intenta crear tablas que ya existen.

La diferencia práctica entre los dos comandos que vas a usar:

- `prisma migrate dev` — **desarrollo**: compara el schema con la base, genera
  una migración nueva y la aplica. Puede proponer borrar datos.
- `prisma migrate deploy` — **producción**: solo aplica las migraciones
  pendientes. Nunca genera ni borra nada. Es el único que se usa en un servidor.

---

## 3. El SQL que generamos, línea por línea

Esto es lo que produjo nuestra migración `nucleo`, con lo que significa cada
parte:

```sql
CREATE TYPE "rol_usuario" AS ENUM ('DUENO', 'ENCARGADO', 'EMPLEADO');
```

El `enum` del schema se convirtió en un **tipo de dato real de Postgres**. La
base rechaza cualquier valor que no sea uno de esos tres: no hace falta un
`CHECK` ni confiar en la aplicación.

```sql
"id" UUID NOT NULL DEFAULT gen_random_uuid(),
```

`gen_random_uuid()` viene incluido en Postgres (desde la versión 13). El id lo
genera la base, así que no hay forma de insertar una fila sin id.

```sql
"created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
"updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
```

`TIMESTAMPTZ` es fecha y hora **con zona**: Postgres guarda el instante
absoluto. El `(6)` es la precisión, microsegundos.

> Acá hubo una corrección real. La primera versión dejaba `updated_at NOT NULL`
> **sin default**, porque Prisma lo escribe desde la aplicación (`@updatedAt`).
> El problema: un `INSERT` hecho desde `psql` o desde un script de migración de
> datos fallaría. Agregamos `@default(now())` y quedó resuelto. Lección: un
> esquema tiene que ser usable también **sin** pasar por el ORM.

```sql
CREATE UNIQUE INDEX "sucursal_empresa_id_codigo_key" ON "sucursal"("empresa_id", "codigo");
```

La unicidad **empieza por `empresa_id`**. Si fuera `UNIQUE (codigo)`, la segunda
panadería que quisiera una sucursal con código `CEN` recibiría "código
duplicado" por una fila que no puede ni ver. En este sistema **toda**
restricción de unicidad arranca con `empresa_id`.

```sql
CONSTRAINT "usuario_sucursal_pkey" PRIMARY KEY ("usuario_id","sucursal_id")
```

**Clave primaria compuesta**: la identidad de la fila la dan las dos columnas
juntas. Es lo que hace imposible que el mismo usuario esté dos veces en la misma
sucursal, sin necesidad de ninguna validación en el código.

---

## 4. `ON DELETE RESTRICT` vs `ON DELETE CASCADE`

Las dos aparecen en la misma migración, a propósito:

```sql
-- sucursal → empresa
FOREIGN KEY ("empresa_id") REFERENCES "empresa"("id") ON DELETE RESTRICT

-- usuario_sucursal → usuario
FOREIGN KEY ("usuario_id") REFERENCES "usuario"("id") ON DELETE CASCADE
```

|            | Qué hace                                       | Cuándo corresponde                                                                                                          |
| ---------- | ---------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `RESTRICT` | **Impide** borrar la fila padre si tiene hijos | Cuando el hijo es un **registro histórico** que no puede desaparecer: una empresa con sucursales, un insumo con movimientos |
| `CASCADE`  | Borra los hijos junto con el padre             | Cuando el hijo es **configuración vigente** y no tiene sentido solo: a qué sucursales está asignado un usuario              |

La pregunta para decidir es: _"si borro el padre, ¿este hijo es información que
quiero conservar, o es basura?"_. En este sistema casi todo es RESTRICT, porque
casi nada se borra (se desactiva con `activo = false`).

---

## 5. Cuándo se puede regenerar una migración y cuándo nunca

La regla es: **una migración ya aplicada no se edita.** Pero hay un matiz
importante que vivimos en esta fase.

Después de leer el SQL, encontramos el problema del `updated_at` sin default.
Entonces borramos la carpeta de la migración, vaciamos la base y generamos una
migración nueva y limpia. **Eso estuvo bien**, y la razón es concreta:

| Situación                                                           | ¿Se puede regenerar?                                                                                               |
| ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| La migración está solo en tu máquina, sin commitear y sin compartir | **Sí.** Nadie más la aplicó, no hay datos que perder                                                               |
| Ya la commiteaste y la pusheaste                                    | **No.** Otra persona (o el servidor) ya la aplicó; cambiarla hace que su historial y el tuyo difieran para siempre |
| Ya corre en producción                                              | **Nunca.** Se arregla con una migración nueva                                                                      |

El criterio real no es "ya la apliqué" sino **"¿alguien más la vio?"**. Mientras
la respuesta sea no, estás a tiempo de dejarla prolija. La ventaja de hacerlo:
el historial queda contando decisiones, no idas y vueltas.

---

## 6. Un seed idempotente: `upsert`

**Idempotente** significa que correrlo una vez o cien veces da el mismo
resultado. Lo verificamos: tres corridas, y los conteos quedaron iguales
(1 empresa, 2 sucursales, 3 usuarios, 3 asignaciones).

La herramienta es `upsert` = "**up**date or in**sert**": insertá si no existe,
actualizá si existe.

```ts
await tx.sucursal.upsert({
  where: { empresaId_codigo: { empresaId: empresa.id, codigo: 'CEN' } },
  create: { ...sucursal, empresaId: empresa.id },
  update: { nombre: sucursal.nombre /* ... */ },
});
```

`empresaId_codigo` es el nombre que Prisma le da a la clave única compuesta
`@@unique([empresaId, codigo])`. Fijate que el upsert necesita **una columna
única por la cual buscar**.

Y de ahí salió una decisión que llama la atención al leer el seed:

```ts
const EMPRESA = {
  id: '11111111-1111-1111-1111-111111111111',
  // ...
};
```

**Un id fijo, escrito a mano.** ¿Por qué, si los id son UUID generados por la
base? Porque la tabla `empresa` no tiene ninguna otra columna única por la cual
buscarla (el nombre no es único: dos clientes podrían llamarse igual). Sin un id
fijo, cada corrida del seed crearía una empresa nueva. Usar ids fijos para datos
de prueba es una práctica normal, y además hace que los tests puedan referirse a
"la empresa de prueba" sin tener que buscarla.

Dos detalles más del seed que vale la pena mirar:

- **Hashea las contraseñas ANTES de abrir la transacción.** Cada hasheo tarda
  ~130 ms a propósito; no conviene tener una transacción abierta esperando.
- **Para las asignaciones de sucursal borra y vuelve a crear.** Así el seed
  declara el estado final: si mañana cambiás la lista, la corrida siguiente
  refleja el cambio en lugar de ir acumulando asignaciones viejas.
- **Se niega a correr con `NODE_ENV=production`.** Es un script que reescribe
  datos; esa guarda cuesta tres líneas.

---

## 7. Cómo se guarda una contraseña

Esto no estaba planificado para la Fase 1, pero el seed crea usuarios, así que
hubo que resolverlo. Usamos **scrypt**, que viene en Node: cero dependencias.

**Por qué no un hash común.** Un hash es una transformación irreversible: de la
contraseña se guarda el hash y no se puede volver atrás. Pero SHA-256 está
diseñado para ser **rápido**, y con una placa de video se prueban miles de
millones de combinaciones por segundo. scrypt está diseñado para ser **lento y
consumir mucha memoria**: medimos 126 ms y 64 MB por hasheo. Para un login es
imperceptible; para quien quiera probar millones de contraseñas, es prohibitivo.

El resultado se guarda así:

```
scrypt$65536$8$1$<salt en base64>$<hash en base64>
```

Cuatro cosas que explican ese formato:

- **El salt** es un valor aleatorio distinto por contraseña. Sin salt, dos
  usuarios con la misma contraseña tendrían el mismo hash y se podrían romper
  las dos de una con tablas precalculadas.
- **Los parámetros de costo viven adentro del hash.** El día que subamos el
  costo (porque las máquinas son más rápidas), las contraseñas viejas siguen
  verificándose con los parámetros con los que fueron creadas. Hay un test que
  prueba exactamente eso.
- **`timingSafeEqual` en lugar de `===`.** Comparar con `===` corta en el primer
  byte distinto, y midiendo cuánto tarda la comparación se puede ir adivinando
  el hash byte por byte. Se llama **ataque de temporización**.
- **`normalize('NFKC')`.** La "ñ" se puede representar en Unicode como un solo
  carácter o como "n" + tilde combinada. Se ven igual, son bytes distintos y
  hashean distinto. En un sistema en español, normalizar no es un detalle.

---

## 8. Prisma 7: tres cosas que cambiaron

Si leés tutoriales de Prisma, casi todos son de la versión 5 o 6. Tres
diferencias que te van a confundir:

**1. La URL ya no va en el schema.** Antes:

```prisma
datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")   // <- ya no
}
```

Ahora va en `prisma.config.ts`, que es un archivo TypeScript y por lo tanto
puede ejecutar código. Lo aprovechamos para cargar el `.env` de la raíz del
repositorio con `process.loadEnvFile` (nativo de Node) en lugar de la librería
`dotenv` que sugiere la plantilla: una dependencia menos.

**2. El cliente generado va a una carpeta tuya**, no a `node_modules`:

```prisma
generator client {
  provider = "prisma-client"
  output   = "../src/generated/prisma"
}
```

Está en `.gitignore` (se regenera con `pnpm db:generate`) y excluido del linter,
porque no es código nuestro. El `postinstall` del paquete lo genera solo, así
que una copia recién clonada compila.

**3. Necesita un _driver adapter_.** Prisma 7 ya no trae su propio motor de
conexión: hay que pasarle el driver. Eso nos permitió hacer algo mejor que lo
que haría la configuración por defecto:

```ts
const adaptador = new PrismaPg(pool, { disposeExternalPool: false });
export const prisma = new PrismaClient({ adapter: adaptador });
```

Le pasamos **el mismo pool de `pg`** que ya tenía la API. Resultado: un solo
conjunto de conexiones a Postgres (lo verificamos: 2 conexiones en total, no
10 + 10), un solo lugar donde configurar límites y timeouts, un solo cierre
ordenado, y el `SELECT 1` del health check pasa por el mismo pool que usa
Prisma, así que verifica lo que la aplicación realmente usa.

---

## 9. La trampa de la versión: `latest` no siempre es estable

Antes de instalar, consultamos las versiones:

```
prisma@latest          8.0.0-rc.21     <- un RELEASE CANDIDATE
@prisma/client@latest  7.10.0          <- estable
```

El tag `latest` del CLI apuntaba a un **release candidate**, mientras el cliente
estable era la 7.10.0. Si hubiéramos hecho `pnpm add prisma` sin más, habríamos
quedado con el CLI en una versión de prueba y el cliente en otra mayor distinta
— y los dos tienen que coincidir exactamente.

Por eso fijamos las dos: `prisma@7.10.0` y `@prisma/client@7.10.0`.

Es el mismo tipo de problema que nos llevó a usar TypeScript 6 en lugar de 7
(nota 07, sección 11): **la versión que te conviene no es la más nueva, es la
más nueva que todo tu toolchain soporta**. Y "lo que dice `latest`" es una
opinión del que publica, no una garantía.

---

## 10. `prisma init` trajo cosas que no pedimos

Un detalle que conviene conocer: `prisma init` escribió en el proyecto, además
del schema, unos 490 KB de **instrucciones para asistentes de IA**
(`.claude/skills/`, `.windsurf/skills/`, `.agents/skills/`, `skills-lock.json`),
descargadas de un repositorio de GitHub. Más un `.env` de ejemplo con
`johndoe:randompassword` que habría tapado al `.env` real de la raíz, y un
`.gitignore` duplicado.

Lo borramos todo. Dos razones:

1. **No lo pedimos.** Son archivos de terceros que ni elegimos ni revisamos, y
   una carpeta `.claude/skills/` en el repositorio pasa a ser instrucciones que
   un asistente va a leer como si vinieran de vos.
2. **El `.env` de ejemplo era un problema concreto**, no estético: Prisma habría
   intentado conectarse a `mydb` con el usuario `johndoe`.

La costumbre que vale la pena: después de correr un generador o un `init`,
**mirá qué archivos aparecieron** (`git status` es suficiente) antes de seguir.
