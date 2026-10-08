# Glosario técnico

Términos técnicos que aparecen en `PLAN.md` y en el código, con una definición corta y un ejemplo del proyecto. Para el vocabulario **del negocio** (insumo, merma, kardex) mirá `CLAUDE.md`.

---

## Organización del código

**Monorepo** — Un solo repositorio de git con varios proyectos adentro. Acá: el frontend, el backend y el código compartido. Ver [01](01-monorepo-y-workspaces.md).

**Workspace** — La función del gestor de paquetes que permite que varios paquetes de un mismo repositorio compartan la instalación de dependencias y se importen entre sí.

**Paquete** — Una carpeta con su propio `package.json`. Acá hay tres: `apps/api`, `apps/web`, `packages/shared`.

**Dependencia** — Una librería de otra persona que tu proyecto usa. Cada una es código que no escribiste y que tenés que mantener: por eso cada una se justifica antes de instalarla.

---

## TypeScript

**TypeScript** — JavaScript con tipos que se verifican **antes** de ejecutar. El navegador y Node ejecutan JavaScript; TypeScript se "compila" a JavaScript.

**Tipo** — La forma de un valor. `cantidad: number` dice "acá siempre hay un número". Si escribís `cantidad.toUpperCase()`, TypeScript te marca el error antes de ejecutar.

**Modo `strict`** — El conjunto de reglas más exigente. La más importante: `strictNullChecks`, que no te deja usar un valor que podría ser `null` o `undefined` sin chequearlo primero. Evita el error más común de JavaScript (`Cannot read property 'x' of undefined`).

**Interfaz / `type`** — Dos formas de darle nombre a la forma de un objeto.

```ts
type Insumo = { id: string; nombre: string; unidadBaseId: string };
```

**Unión** — Un valor que puede ser una cosa **o** otra. Perfecto para los estados:

```ts
type EstadoOrden = 'BORRADOR' | 'ENVIADA' | 'PARCIAL' | 'RECIBIDA' | 'CANCELADA';
```

Si escribís `'ENVIDA'` (con un error de tipeo), no compila. Ese es todo el punto.

**Genérico** — Un tipo con un "hueco" que se completa al usarlo. `Array<string>` es "array de strings". Lo vas a ver todo el tiempo en TanStack Query.

**`z.infer`** — De Zod: le pide a TypeScript que **derive** el tipo a partir del esquema de validación, para no escribir lo mismo dos veces y que no se desincronicen.

---

## Base de datos

**Base de datos relacional** — Datos organizados en tablas (filas y columnas) que se relacionan entre sí. Postgres es una.

**SQL** — El lenguaje para consultar y modificar una base relacional.

**Esquema (schema)** — La estructura: qué tablas hay, qué columnas, de qué tipo.

**Clave primaria (PK)** — La columna que identifica unívocamente a una fila. Acá siempre `id uuid`.

**Clave foránea (FK)** — Una columna que apunta a la clave primaria de otra tabla. `movimiento_stock.insumo_id` apunta a `insumo.id`. La base **garantiza** que ese insumo existe: no podés tener un movimiento de un insumo inventado.

**Clave primaria compuesta** — Cuando la identidad de la fila la dan dos columnas juntas. En `usuario_sucursal`, la PK es `(usuario_id, sucursal_id)`: el mismo usuario no puede estar dos veces en la misma sucursal.

**Tabla puente** — La tabla que resuelve una relación **muchos a muchos**. Un usuario está en varias sucursales y una sucursal tiene varios usuarios: eso no entra en una columna, necesita `usuario_sucursal`.

**`UNIQUE`** — Restricción que impide valores repetidos. Acá casi siempre **compuesta con `empresa_id`**: `UNIQUE (empresa_id, nombre)` permite que dos panaderías distintas tengan un insumo con el mismo nombre, pero no que una lo tenga duplicado.

**`CHECK`** — Restricción que verifica una condición en cada inserción. `CHECK (cantidad_base <> 0)`. Es la última línea de defensa: aunque el código tenga un bug, la base rechaza el dato imposible.

**Índice** — Estructura que permite encontrar filas sin leer la tabla entera. Sin índice, buscar los movimientos de un insumo obliga a Postgres a revisar **todas** las filas. Con índice, va directo. El costo: cada índice hace las escrituras un poco más lentas y ocupa disco, así que se crean los que se usan, no todos los posibles.

**Vista (view)** — Una consulta guardada en la base, con nombre, que se usa como si fuera una tabla. No guarda datos: los calcula cada vez. Acá: `v_stock_actual`.

**Transacción** — Un grupo de operaciones que se aplican **todas o ninguna**. Si al recibir una compra se insertan 5 movimientos y el 4º falla, la transacción se deshace entera y la base queda como estaba. Sin esto, un error de red a mitad de camino deja stock sumado a medias.

**`NUMERIC` / `DECIMAL`** — Tipo numérico **exacto**: guarda los dígitos como dígitos. Lo contrario de `float`, que guarda una aproximación binaria. Ver [04](04-dinero-y-cantidades-decimal.md).

**`timestamptz`** — Fecha y hora **con zona horaria** (en realidad: un instante absoluto). Postgres lo guarda en UTC y lo convierte al leer.

**`jsonb`** — Tipo de Postgres para guardar JSON de forma consultable. Lo usamos en `auditoria` para la foto del "antes" y el "después".

**`uuid`** — Identificador de 128 bits, único en la práctica sin coordinación con nadie: `3f2b1c4e-9a7d-4f1e-8b2a-6c5d4e3f2a1b`.
_Por qué en lugar de 1, 2, 3:_ (a) se puede generar en el cliente o en el código antes de ir a la base, lo que simplifica insertar cosas relacionadas; (b) no filtra información (un id `7` le dice al cliente que es tu séptima compra); (c) no choca al importar datos ni al tener varias empresas. _Contra:_ ocupa más y es incómodo de dictar por teléfono — por eso los documentos (órdenes, recepciones) además tienen un `numero` secuencial para las personas.

**ORM** — _Object–Relational Mapper_. Librería que traduce entre tablas y objetos de tu lenguaje. Prisma es uno.

**Migración** — Un archivo SQL versionado que lleva la base de un estado al siguiente (`CREATE TABLE`, `ALTER TABLE`). El conjunto de migraciones es el **historial** de la base; el esquema es su **estado actual**. En producción nunca se "sincroniza" la base a mano: se aplican migraciones.

**Seed** — Script que carga datos iniciales o de prueba. **Idempotente** significa que podés correrlo 10 veces y el resultado es el mismo (se logra con `upsert`: insertar si no existe, actualizar si existe).

---

## Backend y web

**HTTP** — El protocolo del web. Un pedido tiene método (`GET`, `POST`, `PUT`, `DELETE`), URL, encabezados y a veces cuerpo (_body_).

**Códigos de estado** — `200` ok · `201` creado · `400` el pedido está mal armado · `401` no estás logueado · `403` estás logueado pero no tenés permiso · `404` no existe · `409` conflicto (la operación es válida pero choca con el estado actual: stock insuficiente, nombre duplicado, conteo ya cerrado) · `500` error nuestro.

**API REST** — Estilo de API donde las URLs representan recursos (`/api/insumos/:id`) y el método dice qué hacer.

**Endpoint** — Una combinación concreta de método + URL. `POST /api/movimientos/merma`.

**JSON** — El formato de texto con el que viajan los datos.

**Middleware** — Una función que se ejecuta **antes** del manejador de la ruta y puede dejar pasar el pedido, modificarlo o cortarlo. Se encadenan en orden: logs → autenticación → empresa → permisos → ruta.

**Capa** — Una responsabilidad del backend: rutas, controladores, servicios, acceso a datos. Ver `CLAUDE.md` sección 5.

**Función pura** — Función que con las mismas entradas siempre devuelve lo mismo y no toca nada de afuera (ni base, ni red, ni reloj). Son las más fáciles de testear: `convertir(2.5, 'kg', 'g')` siempre da `2500`.

**Validación en tiempo de ejecución** — TypeScript solo verifica al compilar; un JSON que llega por la red puede traer cualquier cosa. Zod verifica **mientras el programa corre**, que es donde está el peligro.

**CORS** — _Cross-Origin Resource Sharing_. Regla del navegador: una página servida por `localhost:5173` no puede, por defecto, pedirle datos a `localhost:3000` (son orígenes distintos). Se resuelve con un proxy en desarrollo o configurando el servidor en producción.

**Proxy de desarrollo** — Vite recibe el pedido a `/api/...` y lo reenvía al backend. Para el navegador todo viene del mismo origen, así que CORS no se activa.

**Cookie** — Un dato que el servidor guarda en el navegador y que el navegador reenvía solo en cada pedido al mismo sitio.

**`httpOnly`** — Marca de una cookie que impide que el JavaScript de la página la lea. Si alguien logra inyectar un script en tu sitio (XSS), no puede robar la sesión.

**Hash** — Transformación irreversible. De la contraseña se guarda el hash: se puede verificar si una contraseña coincide, pero no recuperarla. No es cifrado (el cifrado se puede deshacer con la clave; un hash no).

**XSS / CSRF** — Dos ataques web. XSS: inyectar JavaScript en tu página. CSRF: hacer que el navegador de la víctima envíe un pedido a tu sitio sin que se dé cuenta, aprovechando que la cookie viaja sola. Se mitigan con `httpOnly` y `SameSite`. Se ven en detalle en la Fase 2.

**SPA** — _Single Page Application_. La aplicación se carga una vez y cambia de pantalla sin recargar la página; React Router se encarga de las URLs.

**Estado del servidor** — Datos que viven en el backend y el front solo copia (el stock, los insumos). No se maneja igual que el estado propio de la interfaz (si un modal está abierto): para el primero existe TanStack Query, para el segundo `useState`.

**Invalidar el caché** — Marcar los datos guardados como viejos para que se vuelvan a pedir. Después de registrar una merma, el stock que está en pantalla ya no es válido.

**Variable de entorno** — Configuración que viene de afuera del código (`DATABASE_URL`). Permite que el mismo código ande en tu máquina y en el servidor, y que las contraseñas no estén en el repositorio.

**Docker / contenedor** — Un contenedor es un proceso aislado con su propio sistema de archivos. Postgres corre en uno, así no lo instalás en tu Linux.

**Volumen** — El disco persistente del contenedor. Sin volumen, al borrar el contenedor se van los datos.

**Docker Compose** — Herramienta que levanta varios contenedores definidos en un archivo YAML.

**Linter / formateador** — ESLint busca patrones problemáticos (una variable sin usar, un `await` olvidado); Prettier acomoda el formato. Discutir indentación es una pérdida de tiempo: lo decide la herramienta.

**CI** — _Continuous Integration_. Un servicio que corre los tests en cada push, para que un error no llegue a producción solo porque te olvidaste de correrlos.
