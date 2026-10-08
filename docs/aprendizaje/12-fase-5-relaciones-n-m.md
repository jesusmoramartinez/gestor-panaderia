# Fase 5: relaciones muchos-a-muchos con atributos propios

_Escrita después de hacer la Fase 5. El tema central es uno solo y vale la pena
entenderlo bien, porque se repite en casi todos los sistemas: cómo se modela
una relación entre dos cosas cuando **la relación misma** tiene datos._

---

## 1. Tres formas de relacionar dos tablas

Antes de los proveedores, el proyecto ya tenía dos de las tres formas. Conviene
verlas juntas:

| Forma                            | Cómo se ve en la base                           | Ejemplo del proyecto                                     |
| -------------------------------- | ----------------------------------------------- | -------------------------------------------------------- |
| **Uno a muchos (1:N)**           | Una columna con la clave foránea en el "muchos" | Un insumo tiene **una** categoría: `insumo.categoria_id` |
| **Muchos a muchos (N:M) pelado** | Una tabla puente con solo los dos ids           | `usuario_sucursal` (usuario_id, sucursal_id)             |
| **N:M con atributos propios**    | Una tabla puente **con columnas propias**       | `proveedor_insumo` (+ precio, código, presentación)      |

La pregunta que decide entre las dos últimas es simple:

> **¿Hay algún dato que no pertenezca a ninguna de las dos puntas por separado,
> sino al par?**

Para `usuario_sucursal` la respuesta es no: que Juan trabaje en Laferrere es
todo lo que hay que decir. La fila existe o no existe, y con eso alcanza.

Para `proveedor_insumo` la respuesta es sí, y son tres datos:

- **el precio** — no es un dato del molino (vende muchas cosas a precios
  distintos) ni de la harina (la venden varios a precios distintos). Es el
  precio **de esa harina a ese molino**;
- **el código del artículo** — "4412" es el número de la harina _en el catálogo
  de ese proveedor_. Otro proveedor la llama distinto;
- **la presentación** — uno la vende en bolsa de 25 y el otro en bolsa de 50.

En cuanto aparece una columna propia, la tabla puente deja de ser "un detalle de
implementación" y pasa a ser **una entidad del dominio**. Por eso tiene su
propio `id` (y no una clave primaria compuesta como `usuario_sucursal`): ahora
hay URLs que apuntan a una fila concreta
(`PATCH /api/proveedores/:id/insumos/:asociacionId`).

### Y por qué no las "relaciones implícitas" de Prisma

Prisma sabe crear la tabla puente solo si le declarás `Insumo[]` en un lado y
`Proveedor[]` en el otro. Es cómodo, pero **solo guarda los dos ids**: no hay
dónde poner el precio. No se puede "agregarle una columna después": hay que
rehacer la relación a mano. Cuando la relación tiene datos, se escribe explícita
desde el principio.

---

## 2. La validación que la base de datos NO puede hacer

Esta es la lección más importante de la fase y la que más me gustó encontrar.

`proveedor_insumo` tiene tres claves foráneas:

```sql
proveedor_id    → proveedor(id)
insumo_id       → insumo(id)
presentacion_id → presentacion_insumo(id)
```

Una clave foránea garantiza que **el id exista en la tabla apuntada**. Eso es
todo lo que garantiza. Así que esta fila es perfectamente válida para Postgres:

| insumo_id           | presentacion_id                      |
| ------------------- | ------------------------------------ |
| el id de Harina 000 | el id de "Bidón 10 l" **del aceite** |

Las dos filas existen. Las dos claves foráneas se cumplen. Y el dato es un
disparate: "le compro harina en bidones de 10 litros". Cuando la Fase 8 reciba
esa compra, va a convertir 4 "bidones" usando el factor 10 y va a sumar 40 kg de
harina que nunca entraron.

**Lo que falta es una condición entre dos columnas de la misma fila:**
`presentacion_id` tiene que pertenecer al insumo que indica `insumo_id`. Eso un
`CHECK` no lo puede expresar, porque un `CHECK` solo puede mirar **columnas de
su propia fila** — no puede salir a consultar otra tabla.

Hay formas de forzarlo en SQL (una clave foránea compuesta a
`presentacion_insumo (id, insumo_id)`, que exigiría duplicar `insumo_id`; o un
trigger). Las dos complican el esquema para algo que el servicio puede chequear
en una línea. La decisión del proyecto es clara:

> Cuando una regla no se puede expresar en la base, **vive en el servicio y
> tiene su test**. No "está en la cabeza del que lo escribió".

```ts
const presentacion = insumo.presentaciones.find((fila) => fila.id === presentacionId);
if (!presentacion) {
  throw errores.datosInvalidos({
    presentacionId: `Esa presentación no es de "${insumo.nombre}".`,
  });
}
```

### El detalle que hace que el test sirva

El test de esta regla manda, para "Harina 000", la presentación **"Bolsa 25 kg"
del Azúcar**. Las dos se llaman igual.

Si el test usara una presentación con un nombre distinto ("Bidón 10 l"),
**pasaría igual pero no probaría lo mismo**: alguien podría "arreglar" el bug
comparando nombres en vez de ids y el test seguiría verde. Con dos presentaciones
homónimas, el único arreglo que funciona es el correcto.

Esto es una idea general sobre tests: **el caso de prueba tiene que poder
distinguir la implementación correcta de la incorrecta.** Si cualquiera de las
dos lo pasa, el test no está midiendo nada.

---

## 3. El índice único parcial, por tercera vez

Ya apareció con la unidad base de cada dimensión (Fase 3) y con la presentación
por defecto de cada insumo (Fase 4). Acá es el **proveedor preferido** de cada
insumo:

```sql
CREATE UNIQUE INDEX "proveedor_insumo_un_preferido_por_insumo"
  ON "proveedor_insumo" ("insumo_id")
  WHERE "es_preferido";
```

Sin el `WHERE`, el índice diría "un insumo no puede aparecer dos veces en esta
tabla", que es exactamente lo contrario de lo que queremos (la harina tiene dos
proveedores). Con el `WHERE`, la restricción solo cuenta las filas marcadas:
**muchos proveedores, un preferido**.

Que esté tres veces en el proyecto es la señal de que es un patrón, no un truco:
siempre que necesites _"de todas estas filas, exactamente una tiene la marca X"_,
esto es la herramienta.

Y como la base lo prohíbe, el servicio **tiene** que desmarcar al anterior antes
de marcar al nuevo, en la misma transacción:

```ts
if (entrada.esPreferido) {
  await tx.proveedorInsumo.updateMany({
    where: { insumoId: entrada.insumoId, esPreferido: true },
    data: { esPreferido: false },
  });
}
// ...y recién ahora el INSERT con es_preferido = true
```

Si esas dos operaciones no estuvieran en la misma transacción, podría quedar un
instante con cero preferidos (si falla el insert) o directamente un error de
índice (si otro pedido se mete en el medio).

---

## 4. Dos invariantes nuevos en la base

Además del índice parcial, esta migración agrega dos `CHECK` que vale la pena
mirar porque son formas de pensar distintas:

```sql
-- 1) Una relación desactivada no puede seguir siendo la preferida.
CHECK (NOT "es_preferido" OR "activo")

-- 2) El precio y su fecha van juntos o no van.
CHECK (("ultimo_precio" IS NULL) = ("ultimo_precio_at" IS NULL))
```

El primero se lee "si es preferido, entonces está activo". En lógica,
`A → B` es lo mismo que `(NOT A) OR B`, y SQL no tiene flecha, así que se
escribe de la segunda forma. Es la traducción de una regla de negocio: la vista
de reposición agruparía la compra bajo un proveedor al que ya no le compramos.

El segundo es más interesante. `IS NULL` devuelve `true` o `false`, así que
`(a IS NULL) = (b IS NULL)` dice **"los dos son nulos, o ninguno lo es"**. Es la
forma corta de escribir "estos dos campos son un paquete".

¿Por qué importa? Porque **un precio sin fecha, con la inflación argentina, no
sirve para nada**. ¿18.500 la bolsa es caro o barato? Depende de si es de esta
semana o del año pasado. Un campo que puede quedar a medias es un campo que
alguien va a interpretar mal.

Y la fecha la pone el **servidor**, nunca el formulario:

```ts
function precioConFecha(precio: string | null) {
  return precio === null
    ? { ultimoPrecio: null, ultimoPrecioAt: null }
    : { ultimoPrecio: precio, ultimoPrecioAt: new Date() };
}
```

El reloj de la tablet del depósito puede estar mal. Si el cliente mandara la
fecha, un precio podría quedar fechado en 2027 y ganaría siempre cualquier
comparación de "cuál es el más reciente".

---

## 5. `null` y `0` no son lo mismo (dos veces en la misma fase)

Apareció en dos campos distintos y en los dos la diferencia es real:

| Campo           | `0` significa                         | `null` significa             |
| --------------- | ------------------------------------- | ---------------------------- |
| `dias_entrega`  | entrega **en el día**                 | **no sabemos** cuánto tarda  |
| `ultimo_precio` | es **gratis** (muestra, bonificación) | **nadie preguntó** el precio |

Si mezcláramos los dos, la Fase 10 sugeriría "pedile hoy que llega hoy" a un
proveedor del que no sabemos nada, y el valor del stock contaría como gratis
todo lo que no tiene precio cargado.

El problema práctico es que **un `<input>` vacío no manda `null`: manda `''`**
(la cadena vacía). Si el esquema no hiciera nada, en la base quedaría un texto
vacío, y la pregunta "¿tiene email?" devolvería que sí. Por eso cada campo
opcional pasa por un `.transform()` que traduce `''` a `null`, y hay un test que
lo verifica campo por campo.

---

## 6. Un error mío: `.int()` adentro de un `z.union`

Escribí esto para los días de entrega:

```ts
// MAL
z.union([z.literal(''), z.null(), z.coerce.number().int('Tiene que ser un número entero')]);
```

Y al mandar `2.5` el mensaje que volvía era **`"Invalid input"`**, no el mío. El
test lo cazó.

La razón: cuando **todas** las ramas de una unión fallan, Zod no tiene forma de
saber cuál era "la que correspondía", así que no puede usar el mensaje de
ninguna. Reporta un error genérico de la unión.

La forma correcta es **normalizar primero y validar después**, que además es el
orden natural de los datos que vienen de un formulario (siempre texto):

```ts
// BIEN
z.union([z.string(), z.number(), z.null()])
  .nullish()
  .transform((valor) => {
    /* '' y null → null; el resto → Number(valor) */
  })
  .refine(
    (valor) => valor === null || Number.isInteger(valor),
    'Tiene que ser un número entero de días',
  )
  .refine((valor) => valor === null || valor >= 0, 'No puede ser negativo');
```

Regla práctica: **la unión decide la forma, los `refine` deciden las reglas.**

---

## 7. Por qué el CUIT se guarda sin guiones

El proveedor dicta "treinta, doce millones trescientos cuarenta y cinco mil
seiscientos setenta y ocho, nueve" y cada uno lo escribe distinto:
`30-12345678-9`, `30.12345678.9`, `30 12345678 9`, `30123456789`.

Para una persona es el mismo CUIT. Para Postgres son **cuatro textos distintos**,
así que el chequeo de "¿ya existe un proveedor con este CUIT?" fallaría y el
mismo molino podría entrar cuatro veces, partiendo el historial de precios.

La solución es **normalizar en la entrada**: el esquema le saca espacios, puntos
y guiones, y recién después valida que queden 11 dígitos. Es el mismo criterio
que ya usamos con el email (se guarda en minúsculas) y con el nombre del insumo
(se compara sin distinguir mayúsculas).

Lo que **no** hago es validar el dígito verificador. Se podría (es una cuenta
con pesos fijos), pero si el proveedor dicta mal un número por teléfono, es peor
trabarle el alta al encargado que guardar un CUIT con un dígito cambiado. Si el
cliente lo pide, el lugar está marcado en el código.

---

## 8. El permiso que rompe la regla de los catálogos

Hasta ahora la regla era: **ver un catálogo no lleva permiso**. Y tenía sentido:
cualquiera que cargue un consumo necesita elegir el insumo de una lista.

Con proveedores no se puede mantener, por una razón concreta: **estas
respuestas llevan precios de compra**. El supuesto de la pregunta C-23 de `PLAN.md` es que
el empleado ve cantidades, no precios.

Lo importante es _dónde_ se aplica la restricción. La tentación es esconder la
columna en la pantalla, y eso **no sirve**: el frontend corre en la máquina del
usuario, y cualquiera puede abrir las herramientas de desarrollo y ver la
respuesta cruda de la API. Si el dato salió del servidor, ya está entregado.

Por eso el permiso está en la **ruta**:

```ts
const puedeVer = [requiereAutenticacion, requierePermiso('proveedor:ver')] as const;
proveedoresRouter.get('/proveedores', ...puedeVer, getProveedores);
```

El empleado recibe un **403 y ningún dato**. Y en el frontend, `usePuede()` hace
dos cosas: no dibuja la pestaña "Proveedores" (para que no haga clic en algo que
le va a dar error) y pone `enabled: false` en la consulta (para no hacer un
pedido que ya sabemos que va a fallar). Las dos son **comodidad**; la defensa es
el 403, y tiene su test.

---

## 9. Las dos pantallas: por qué no alcanza con una

`PLAN.md` pedía "dos vistas complementarias", y cuando lo leí me pareció
repetido. No lo es, y es un error de diseño clásico.

La tabla puente es **una sola**, pero hay dos preguntas distintas y las hace
gente en momentos distintos:

| Estoy mirando... | Lo que quiero saber                                                           | Pantalla            |
| ---------------- | ----------------------------------------------------------------------------- | ------------------- |
| el **proveedor** | ¿qué le compro, a qué precio, con qué código?                                 | ficha del proveedor |
| el **insumo**    | ¿a quién se lo compro? ¿quién lo tiene más barato? ¿quién entrega más rápido? | ficha del insumo    |

Si solo existiera la primera, para responder "¿a quién le compro la harina?"
habría que abrir los cinco proveedores uno por uno. Y es justo la pregunta que
uno se hace cuando ve que falta harina.

En la API son dos endpoints sobre la misma tabla:

```
GET /api/proveedores/:id            → incluye sus insumos
GET /api/insumos/:insumoId/proveedores
```

La segunda cuelga de `/insumos` **a propósito**: la URL tiene que decir de qué
habla el recurso, y ahí el recurso es el insumo. En el servicio son dos
funciones que comparten la traducción de la fila (`aAsociacionComun`) y cambian
solo qué punta incluyen.

Y en el frontend hay una consecuencia que es fácil olvidar: **cuando se cambia
la fila puente desde cualquiera de las dos pantallas, las dos quedaron viejas**.
Por eso la mutación invalida las dos claves de caché:

```ts
await queryClient.invalidateQueries({ queryKey: ['proveedores'] });
await queryClient.invalidateQueries({ queryKey: ['proveedoresDeInsumo'] });
```

---

## 10. El `<select>` dependiente

Las presentaciones que se pueden elegir dependen del insumo elegido. Es la
primera vez que un campo del formulario depende de otro:

```ts
const insumoElegido = form.watch('insumoId');

const detalleInsumo = useQuery({
  queryKey: ['insumo', insumoElegido],
  queryFn: () => obtenerInsumo(insumoElegido),
  enabled: insumoElegido !== '', // no pedir nada hasta que elija
});
```

Dos piezas que conviene registrar:

- **`form.watch(campo)`** suscribe el componente a ese campo: cuando cambia,
  React vuelve a dibujar. Es distinto de `register()`, que solo conecta el input
  al formulario sin provocar redibujados (y por eso es más rápido para los
  campos normales).
- **`enabled`** de TanStack Query es lo que evita el pedido con un id vacío. Sin
  eso, en cuanto se abre el formulario saldría un `GET /api/insumos/` que da 404.

Y el `queryKey` incluye el id, así que si el usuario cambia de insumo, va y
vuelve, la segunda vez las presentaciones salen del caché: sin pedido y sin
parpadeo.

---

## 11. Lo que quedó preparado para la Fase 8

Dos campos de esta fase todavía no se llenan solos, y es a propósito:

- **`ultimo_precio` / `ultimo_precio_at`** hoy se cargan a mano para poder
  arrancar; cuando exista la recepción de compras, cada recepción los va a
  actualizar sola. El campo ya está, con su invariante y su formato.
- **`es_preferido`** hoy solo se muestra; en la Fase 10 es lo que define bajo
  qué proveedor se agrupa cada insumo en la lista de reposición.

Esto es lo que significa "dejar el diseño preparado" sin implementar fuera de
alcance: la **columna** y su regla existen desde el principio (agregarlas después
es una migración y un recálculo), pero el **flujo** que las llena llega con su
fase.

---

## Resumen en cinco líneas

1. Si la relación entre dos tablas tiene datos propios, la tabla puente es una
   entidad del dominio: id propio, servicio propio, URLs propias.
2. Una clave foránea garantiza que el id exista, **no de quién es**. Las
   condiciones entre columnas viven en el servicio, con su test.
3. Un test tiene que poder distinguir el código correcto del incorrecto: por eso
   las dos presentaciones del test se llaman igual.
4. Índice único parcial = "de estas filas, exactamente una tiene la marca".
5. `null` y `0` casi nunca significan lo mismo; decidí qué significa cada uno
   **antes** de escribir la columna.
