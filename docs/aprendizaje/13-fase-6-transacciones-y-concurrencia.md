# Fase 6: transacciones, concurrencia y el bug que no se ve en desarrollo

_Escrita después de hacer la Fase 6. Es la fase más importante del proyecto y
la nota más larga. Los dos temas centrales — **transacciones** y **condiciones
de carrera** — son los que separan un sistema en el que se puede confiar de uno
que da números raros los martes._

---

## 1. Lo que NO tiene la tabla más importante

`movimiento_stock` se entiende mejor por lo que le falta:

| No tiene              | Por qué                                                                                                                                          |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `updatedAt`           | Una fila de acá **no se actualiza nunca**. Todas las otras tablas del proyecto lo tienen; su ausencia es la regla escrita en el esquema.         |
| una columna `saldo`   | El saldo es `SUM(cantidad_base)`. Si existiera la columna, alguien la editaría a mano y el stock dejaría de ser consecuencia de las operaciones. |
| `DELETE` en el código | Para corregir se escribe un movimiento inverso. La evidencia del error es información valiosa.                                                   |

Y lo que **sí** tiene y es menos obvio: `cantidad_base` lleva **signo** (+ entra,
− sale) en una sola columna. La alternativa —cantidad siempre positiva más un
campo "sentido", o deducirlo del tipo— obligaría a que cada consulta de saldo
sea:

```sql
SUM(CASE WHEN tipo IN ('COMPRA','TRANSFERENCIA_ENTRADA','SALDO_INICIAL') THEN cantidad
         ELSE -cantidad END)
```

El día que agregás `DEVOLUCION_PROVEEDOR` tenés que acordarte de modificar
**cada** consulta que haga esa cuenta. Si te olvidás de una, los números
empiezan a dar mal **en silencio**. Con signo, la consulta es `SUM(cantidad_base)`
y no hay nada que olvidarse.

---

## 2. Las tres capas de validación, y qué puede hacer cada una

El invariante "el signo tiene que coincidir con el tipo" está escrito **tres
veces**, y no es duplicación por descuido:

| Dónde                            | Para qué sirve                                           | Qué no puede hacer                                |
| -------------------------------- | -------------------------------------------------------- | ------------------------------------------------- |
| Zod (`packages/shared`)          | Rechazar antes de enviar, con el mensaje abajo del campo | No vale: el cliente se puede modificar            |
| El servicio (`SENTIDO_POR_TIPO`) | Dar un error en español con contexto del negocio         | No vale si alguien escribe por fuera del servicio |
| El `CHECK` de Postgres           | **La última palabra**, incluso ante un bug del código    | Su mensaje es ilegible para una persona           |

Cada capa cubre lo que la anterior no puede. Y porque están en dos lugares que
se pueden desincronizar, hay un test que las compara:

```ts
for (const tipo of TIPOS_MOVIMIENTO) {
  for (const cantidad of ['5', '-5']) {
    // intenta el INSERT en una transacción que SIEMPRE se deshace
    // y compara si la base lo aceptó con lo que dice SENTIDO_POR_TIPO
  }
}
```

Es un test que casi nadie escribe y que vale mucho: si mañana alguien agrega un
tipo al enum de TypeScript y se olvida del `CHECK` (o al revés), falla.

Un detalle de Postgres que apareció escribiendo esto: **"la fecha no puede ser
futura" NO se puede poner en un `CHECK`**. Un `CHECK` solo admite funciones
_inmutables_ (para la misma entrada, siempre el mismo resultado) y `now()` no lo
es. Esa regla tiene que vivir en el servicio.

---

## 3. Transacciones: o todo, o nada

Una **transacción** es un grupo de operaciones que la base trata como una sola:
o se escriben todas, o no se escribe ninguna. Es lo que en bases de datos se
llama **atomicidad** (la A de ACID).

El caso del proyecto: una carga de consumo con 6 insumos.

```
sin transacción            con transacción
─────────────────          ─────────────────
línea 1 → escrita          línea 1 → pendiente
línea 2 → escrita          línea 2 → pendiente
línea 3 → escrita          línea 3 → pendiente
línea 4 → ERROR            línea 4 → ERROR
                           ──────────────────
3 líneas escritas          se deshace todo
2 sin cargar               0 líneas escritas
nadie sabe cuáles
```

La columna de la izquierda es **peor que un error**: el panadero ve "falló" y
no sabe si tiene que cargar las 6 de nuevo (duplicando 3) o adivinar cuáles
faltan. La de la derecha es un mensaje claro y un estado consistente.

En Prisma son dos formas distintas:

```ts
// INTERACTIVA: para cuando hay lógica en el medio. Es la que usa el motor.
await prisma.$transaction(async (tx) => {
  /* todo lo que uses adentro tiene que ser `tx`, no `prisma` */
});

// BATCH: una lista de consultas independientes.
await prisma.$transaction([consulta1, consulta2]);
```

Y el detalle que hace que el diseño funcione: **el motor no abre la
transacción, la recibe**.

```ts
export async function registrarMovimientos(tx: Tx, ctx, entradas, opciones);
```

`Tx` es `Prisma.TransactionClient`: el cliente **sin** `$transaction` ni
`$connect`. Pedir ese tipo hace **imposible** que el motor escriba por fuera de
una transacción — no compila. Y como recibe el `tx`, una operación futura que
escriba movimientos _y otra cosa_ (una recepción de compra, el cierre de un
conteo) va a quedar toda en la misma transacción, sin tocar el motor.

---

## 4. La condición de carrera ⭐

**Este es el tema de la fase.** Un bug que no se ve programando solo y aparece
el primer día con dos tablets en el depósito.

### El problema

Hay 10 kg de levadura. Ana y Beto cargan un consumo de 8 kg al mismo tiempo:

```
tiempo →
Ana:   lee saldo (10) ─── valida 10−8=2 ≥ 0 ✓ ─── escribe −8 ─── commit
Beto:      lee saldo (10) ─── valida 10−8=2 ≥ 0 ✓ ─── escribe −8 ─── commit

saldo final: 10 − 8 − 8 = −6
```

Las dos validaciones pasaron. Cada una, por separado, era **correcta**. El
resultado es imposible.

Y acá está lo traicionero: **la transacción no lo arregla.** Las dos
transacciones hicieron todo bien, cada una fue atómica. El problema no es que
quedara algo a medias, es que **las dos leyeron el mismo saldo antes de que la
otra escribiera**.

Esto se llama **condición de carrera** (_race condition_): el resultado depende
de en qué orden ocurrieron cosas que pasaron al mismo tiempo. La variante
concreta se llama **lectura fantasma** (_phantom read_): Ana valida contra un
conjunto de filas y, cuando va a escribir, apareció una fila nueva que no
existía cuando leyó.

### Por qué no se ve en desarrollo

Porque programando solo **nunca hay dos pedidos simultáneos**. Todos los tests
que uno escribe naturalmente son secuenciales y pasan. El bug aparece en
producción, de a poco, y se manifiesta como "el stock no cuadra" — sin forma de
saber desde cuándo ni por qué.

### La solución: bloqueo pesimista

Antes de leer el saldo, se le pide a Postgres el **candado** de una fila:

```sql
SELECT insumo_id FROM insumo_sucursal
WHERE insumo_id = $1 AND sucursal_id = $2
FOR UPDATE
```

`FOR UPDATE` dice "voy a modificar algo que depende de esta fila; que nadie más
la toque hasta que yo termine". El primero se lo queda; el segundo **espera ahí
mismo** hasta que el primero haga commit, y entonces lee el saldo ya
actualizado (2) y su validación falla como corresponde.

```
Ana:   🔒 candado ─── lee (10) ─── valida ✓ ─── escribe −8 ─── commit 🔓
Beto:      ⏳ esperando............................................ 🔒 lee (2) ─── 2−8 < 0 ✗ → 409
```

Se llama **pesimista** porque asume que el choque va a pasar y lo previene. La
alternativa, **optimista**, es escribir y reintentar si hubo conflicto: más
rápida con mucha concurrencia, pero acá hay dos tablets en un depósito —la
espera es de milisegundos y el código pesimista es mucho más fácil de entender.

### Los dos detalles que tuve que resolver

**¿Qué fila se bloquea?** No sirve bloquear filas de `movimiento_stock`: las que
importan son **las que todavía no existen** (es justo la lectura fantasma, y un
candado de fila no la puede evitar). Se bloquea la fila de `insumo_sucursal`,
que es la configuración de ese insumo en esa sucursal, y se la crea si no
existe:

```sql
INSERT INTO insumo_sucursal (insumo_id, sucursal_id, empresa_id)
VALUES (...) ON CONFLICT (insumo_id, sucursal_id) DO NOTHING
```

`ON CONFLICT DO NOTHING` resuelve la otra carrera, la del propio INSERT: si otra
transacción la está insertando en este instante, este INSERT **espera** a que
termine y después no hace nada.

**El orden del bloqueo.** Una carga de 6 insumos pide 6 candados. Si Ana traba
harina→azúcar y Beto traba azúcar→harina:

```
Ana:  🔒 harina ─── ⏳ espera azúcar (lo tiene Beto)
Beto: 🔒 azúcar ─── ⏳ espera harina (lo tiene Ana)
```

Cada uno espera al otro **para siempre**. Se llama **abrazo mortal**
(_deadlock_), y Postgres lo detecta y mata una de las dos transacciones con un
error. La solución es que **todos bloqueen en el mismo orden**:

```ts
const clavesOrdenadas = [...porContador.keys()].sort();
```

Una línea. Es la diferencia entre un sistema que funciona con dos usuarios y
uno que falla al azar.

### Cómo se testea algo que depende del tiempo

Un test de concurrencia escrito sin cuidado es un test que falla un día de cada
diez. Dos técnicas que usé:

**1. Sincronizar a mano con promesas**, para reproducir el bug de forma
determinista:

```ts
const yaLei = puerta(); // una promesa que se resuelve desde afuera
const yaLeyoElOtro = puerta();

// cada tarea lee, avisa que leyó, y espera a que la otra también haya leído
```

Así las dos lecturas ocurren **con certeza** antes de las dos escrituras, y el
saldo final es `-6` siempre. Ese test está en `test/concurrencia.test.ts` y es
el único lugar del proyecto que escribe en `movimiento_stock` sin pasar por el
motor: existe solo para documentar el bug.

**2. Afirmar sobre el invariante, no sobre el orden.** Cinco consumos
simultáneos de 3 contra un saldo de 10:

```ts
expect(exitosas).toBe(3); // como máximo 3 × 3 = 9 ≤ 10
expect(await saldoEnBase(insumoId)).toBe('1');
```

No importa en qué orden lleguen ni quién gane: el invariante "el saldo nunca
queda negativo" vale siempre. Un test así no es frágil.

---

## 5. El bug que este test encontró (y la lección más útil de la fase)

Agregué una regla propia: **el saldo inicial se carga una sola vez por insumo y
sucursal** (si no, un doble clic duplica el stock). La escribí así:

```ts
// MAL
const previos = await repo.contarMovimientos(...);   // ← afuera de todo
if (previos > 0) throw ...;

await prisma.$transaction((tx) => registrarMovimientos(tx, ...));
```

El test de dos clics simultáneos la rompió de inmediato: los dos pedidos leían
"no tiene movimientos", los dos pasaban la validación, y el stock quedaba en 200.

```ts
// BIEN
await prisma.$transaction(async (tx) => {
  for (const insumoId of insumoIds.sort()) {      // el mismo orden que el motor
    await bloquearContador(tx, empresaId, sucursalId, insumoId);
    const previos = await repo.contarMovimientos(tx, ...);  // ← con el candado
    if (previos > 0) throw ...;
  }
  return registrarMovimientos(tx, ...);
});
```

La regla general, que vale para cualquier sistema:

> **Una validación que lee el estado y no tiene el candado no valida nada.**
> Solo dice cómo estaban las cosas hace un rato.

Si te suena abstracto: es el mismo error que "chequeo si el email existe y
después inserto", "chequeo si hay lugar y después reservo", "chequeo el número
máximo y después guardo el siguiente". Todos son la misma carrera.

---

## 6. El contra-asiento: corregir sin borrar

Si alguien cargó 300 kg en lugar de 30, **no se edita la fila**:

```
│ 03/10 06:30 │ CONSUMO  │ −300 │ Marcela │                       │
│ 03/10 07:10 │ REVERSA  │ +300 │ Jesús   │ corrige el anterior   │
│ 03/10 07:11 │ CONSUMO  │  −30 │ Jesús   │                       │
```

Se llama **contra-asiento** y viene de la contabilidad de partida doble, que
tiene unos 500 años de probada. El número final es el mismo que editando la
fila, pero **queda la información de que hubo un error y cuándo se corrigió** —
justo la que sirve para entender por qué el stock no cuadraba.

Tres detalles del diseño:

**El `UNIQUE` en `revierte_a_id`** hace que un movimiento se pueda revertir una
sola vez, garantizado por la base y no por la memoria del código. Y un `CHECK`
extra asegura que solo una `REVERSA` lleve ese campo: sin él, un `CONSUMO` podría
ocupar el lugar de la reversa de otro movimiento y dejarlo imposible de anular.

**La reversa se arma con la cantidad BASE**, no recalculando desde la cantidad
tipeada. Si mañana alguien corrigiera el factor de la unidad, recalcular daría
un número distinto y la reversa **no devolvería el saldo exacto**. Así, la
igualdad `original + reversa = 0` está garantizada por construcción.

**La reversa pasa por el mismo control de stock negativo.** Anular una entrada
es una salida: si el saldo inicial era 100, ya se consumieron 70 y se anula el
saldo inicial, el stock queda en −70. Tiene que avisar, no hacerlo en silencio.
Eso sale gratis porque la reversa usa el mismo motor que todo lo demás.

Y **una reversa no se puede anular**: sería volver a aplicar el original con un
historial que nadie podría seguir. Si hace falta, se carga de nuevo.

---

## 7. El snapshot del factor

Cada movimiento guarda tres cosas sobre la cantidad:

| Campo                | Ejemplo | Para qué                                  |
| -------------------- | ------- | ----------------------------------------- |
| `cantidad_ingresada` | `2000`  | lo que la persona tipeó                   |
| `unidad_ingresada`   | `g`     | en qué unidad lo tipeó                    |
| `factor_conversion`  | `0.001` | **copia** del factor usado en ese momento |
| `cantidad_base`      | `−2`    | el resultado, en la unidad del insumo     |

Con las cuatro, el historial puede mostrar _"cargó 2000 g = 2 kg"_ y va a seguir
siendo verdad en cinco años, **aunque alguien corrija el factor de la unidad en
el medio**. Si guardáramos solo `cantidad_base`, el historial perdería la
información de cómo se cargó; si guardáramos solo lo tipeado y recalculáramos,
los movimientos viejos cambiarían de valor al corregir una unidad.

Es el mismo criterio que la `cantidad_base` de una presentación en la Fase 4:
**los documentos copian, no referencian**, cuando lo que copian es un hecho
histórico.

---

## 8. Dos cosas que aprendí peleando con Prisma y pg

### Un `findMany` con relaciones no es una consulta

Esto apareció como un `DeprecationWarning` que es fácil ignorar:

```
Calling client.query() when the client is already executing a query
is deprecated and will be removed in pg@9.0
```

Lo que pasa: un `findMany` con varias relaciones en el `select` hace que Prisma
traiga **cada relación con una consulta aparte**, y las lanza **en paralelo**.
Fuera de una transacción está perfecto: cada una toma su propia conexión del
pool. Pero **una transacción vive en UNA conexión**, y una conexión ejecuta una
consulta a la vez.

Dos lugares a corregir:

```ts
// MAL, adentro de una transacción
const [a, b] = await Promise.all([cargarA(tx), cargarB(tx)]);

// BIEN
const a = await cargarA(tx);
const b = await cargarB(tx);
```

Y el historial salió de la transacción. De paso descubrí algo mejor: `count` y
`sum` son dos agregaciones del mismo `GROUP BY`, así que se piden **juntas**:

```ts
prisma.movimientoStock.aggregate({
  where,
  _count: { _all: true },
  _sum: { cantidadBase: true },
});
```

Una consulta en lugar de dos, y los dos números salen del mismo estado sin
necesidad de transacción.

### `_sum` de cero filas da `null`, no `0`

```ts
const saldo = agregado._sum.cantidadBase?.toString() ?? '0';
```

Es la diferencia entre "la suma es cero" y "no hay nada que sumar". Para el
stock las dos valen cero, pero el `?? '0'` tiene que estar o el saldo de un
insumo nuevo sería `null` y rompería la pantalla.

---

## 9. Los dos permisos peligrosos

`PLAN.md` los llama así y tiene razón: **anular un movimiento** y **forzar
stock negativo** son las dos cosas que pueden tapar un problema real.

Sobre forzar, la decisión interesante es _cuándo_ se chequea el permiso. La
tentación es rechazar con 403 a quien manda `forzar: true` sin tenerlo. Pero
entonces alguien sin el permiso que marca la casilla por las dudas recibiría un
403 **incluso en una carga que no necesitaba forzarse**. Así quedó:

- si la salida alcanza → se registra, `forzar` se ignora;
- si no alcanza y no tiene el permiso → **409 con el número**;
- si no alcanza y lo tiene → se registra, `forzado = true`, y **se audita**.

Y sobre la auditoría: los movimientos normales **no** se auditan. Ya son
inmutables y llevan su propio usuario y fecha, así que una fila en `auditoria`
no agregaría nada. Lo que se audita es lo **excepcional**: forzar el stock en
negativo, con su propia acción `FORZAR_STOCK_NEGATIVO`, para poder responder
"¿cuántas veces se forzó este mes y quién?".

Una tentación que evité: `costo_unitario` queda en `null` toda esta fase (el
costo promedio llega en la Fase 8) y **el esquema de salida no lo incluye**. Un
campo que no se manda no se puede filtrar mal más adelante.

---

## 10. Dos detalles del frontend

**`useFieldArray`** maneja una lista de campos. El detalle que importa: `fields`
trae un `id` propio por fila, **distinto del `insumoId`**, y ese es el que va en
el `key` de React. Con el índice, borrar la línea 2 haría que React reutilizara
los inputs equivocados y el usuario vería valores saltar de fila.

**Un formulario, un tipo de valores.** Las tres cargas (consumo, merma, saldo
inicial) son la misma pantalla, y al principio la parametricé con los tres
esquemas Zod. TypeScript eligió el más angosto (el del saldo inicial, que no
tiene `motivoId`) y el campo del motivo "no existía". La solución: un esquema de
formulario único y permisivo, con la exigencia del motivo **encadenada con un
`refine`** cuando es una merma:

```ts
const esquema = esMerma
  ? conMotivoObligatorio(CargarMovimientoFormSchema)
  : CargarMovimientoFormSchema;
```

Los dos producen el **mismo tipo de valores**, así que el formulario no cambia
de forma. Y la API sigue validando con su esquema estricto: el del formulario es
comodidad para que el error aparezca abajo del campo, no la defensa.

---

## Resumen en seis líneas

1. Una transacción garantiza "todo o nada". **No** garantiza que nadie más haya
   escrito en el medio.
2. Para eso está el candado: `SELECT ... FOR UPDATE` antes de leer lo que vas a
   validar.
3. **Una validación que lee el estado y no tiene el candado no valida nada.**
4. Si bloqueás varias filas, bloqueálas **siempre en el mismo orden**.
5. Para corregir un hecho histórico se escribe otro hecho, no se edita el
   anterior.
6. Un test de concurrencia tiene que afirmar sobre el **invariante**, no sobre
   el orden de llegada.
