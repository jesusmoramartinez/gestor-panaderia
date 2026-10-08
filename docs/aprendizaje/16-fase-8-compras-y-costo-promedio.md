# Fase 8: compras, recepciones parciales y costo promedio

_Escrita después de hacer la Fase 8. Es la fase más grande hasta ahora, y
tiene cuatro ideas que vas a volver a usar en cualquier sistema que maneje
plata y documentos: **la máquina de estados**, **lo pendiente se calcula**,
**un valor derivado se reconstruye, no se edita**, y un **abrazo mortal que
no se ve en el código**. Este último lo encontré rompiendo un candado a
propósito, y es la parte que más vale la pena leer despacio._

---

## 1. Pedir no es tener: dos documentos para dos hechos

Una **orden de compra** es lo que se le pide al proveedor. Una **recepción**
es lo que llegó. Parecen lo mismo y no lo son:

|                      | Orden de compra                                         | Recepción                                    |
| -------------------- | ------------------------------------------------------- | -------------------------------------------- |
| ¿Mueve stock?        | **No.** Pedir no es tener.                              | **Sí.** Un movimiento `COMPRA` por línea.    |
| ¿Es obligatoria?     | No: muchas compras son por teléfono y llegan en el día. | Sí: sin ella no entra nada.                  |
| ¿Cuántas por compra? | Una.                                                    | Una o varias: puede llegar en partes (C-10). |
| ¿Tiene precio?       | Opcional, el que se acordó (C-9).                       | Obligatorio, el que se pagó (C-7).           |

Si fueran una sola tabla con un campo "recibido", la entrega parcial sería un
infierno: ¿qué precio vale, el de la primera parte o el de la segunda? ¿Qué
fecha? ¿Qué remito? Con dos documentos, cada llegada es su propio hecho con su
propia fecha, su propio remito y su propio precio.

---

## 2. ⭐ La máquina de estados

Una orden pasa por estados: `BORRADOR`, `PEDIDA`, `PARCIAL`, `RECIBIDA`,
`CERRADA`, `CANCELADA`. La tentación es tener un campo `estado` y que cada
pantalla haga un `UPDATE` cuando le parezca. El problema: tarde o temprano
alguien pone `RECIBIDA` a una orden a la que no le llegó nada.

Una **máquina de estados** es una lista cerrada de estados y, para cada uno,
qué se puede hacer. En el proyecto es literalmente una tabla
(`packages/shared/src/dominio/compras.ts`):

```ts
const ACCIONES_POR_ESTADO = {
  BORRADOR: ['editar', 'pedir', 'cancelar'],
  PEDIDA: ['editar', 'recibir', 'cancelar'],
  PARCIAL: ['recibir', 'cerrar'],
  RECIBIDA: [],
  CERRADA: [],
  CANCELADA: [],
};
```

Lo que no está en la tabla no se puede. Tres consecuencias que valen oro:

1. **El servidor y la pantalla usan la misma tabla.** La API manda en el
   detalle de la orden una lista `acciones` ("recibir", "cerrar"); la pantalla
   muestra esos botones y ninguno más. La regla "¿se puede cancelar una orden
   parcial?" está escrita UNA vez.
2. **Las transiciones son endpoints, no un PATCH del estado.** Hay
   `POST /ordenes-compra/:id/cerrar`, no `PATCH { estado: 'CERRADA' }`. Con un
   PATCH, cualquiera podría saltarse la máquina mandando el estado que quiera.
3. **Algunos estados no los elige nadie.** `PEDIDA`, `PARCIAL` y `RECIBIDA` se
   **calculan** a partir de lo que llegó (`estadoSegunRecibido`). Por eso
   anular una recepción "reabre" la orden sola: nadie tiene que acordarse.

Y la diferencia entre **cancelar** y **cerrar** (decisión del cliente): si no
llegó nada, se cancela; si llegó una parte y el resto no va a llegar, se
**cierra con faltante**. Son distintas porque dicen cosas distintas: una orden
cerrada guarda cuánto faltó, y eso sirve para saber qué proveedor falla.

---

## 3. Lo pendiente se calcula (otra vez el kardex)

La tabla `linea_orden_compra` **no tiene** una columna `cantidad_recibida`.
Lo recibido se calcula sumando las recepciones confirmadas de esa línea:

```
pedido     = 10 bolsas = 250 kg          (en la orden)
recibido   = 100 kg                      (suma de recepciones CONFIRMADAS)
pendiente  = 250 − 100 = 150 kg = 6 bolsas
```

Es la misma idea del stock (nota 03): un solo lugar con la verdad. Si
hubiera una columna, anular una recepción obligaría a acordarse de restarle,
y el día que alguien se olvide, la orden dice "recibida" con la mercadería
devuelta.

La condición que hace que todo encaje: las recepciones **anuladas no
cuentan**. Anular es cambiar el estado de la recepción a `ANULADA`; la suma la
deja afuera sola.

### No se puede recibir más de lo que falta — con el candado tomado

"Faltan 6, querés recibir 7" se rechaza (409). Pero la validación tiene que
leer lo recibido **adentro de la transacción y después del candado de la
orden**, por la lección de la Fase 6: si dos recepciones simultáneas leyeran
"faltan 6" antes de que la otra escriba, recibirían 6 cada una.

Lo comprobé sacando el candado a propósito: el test "dos recepciones
simultáneas de lo que falta" pasó a dar 201 y 201 — **12 bolsas de 6
pedidas**. Con el candado, una entra y la otra choca.

---

## 4. ⭐ El costo promedio ponderado

### Qué es

Cada vez que entra mercadería a un precio distinto, el costo de lo que hay en
el depósito cambia. El **costo promedio ponderado (CPP)** es el promedio de lo
que costó cada kilo, **pesado** por cuántos kilos entraron a cada precio:

```
Hay 100 kg a $1.000/kg         → valor en depósito = $100.000
Llegan 50 kg a $1.300/kg       → valor que entra   =  $65.000

nuevo promedio = (100.000 + 65.000) / (100 + 50) = $1.100/kg
```

No es `(1.000 + 1.300) / 2 = 1.150`: eso sería un promedio simple, y le daría
el mismo peso a 50 kg que a 100 kg.

### Las cuatro reglas (todas con su test)

1. **Solo las compras mueven el promedio.** Si había 100 kg a $1.000 y se
   usan 40, los 60 que quedan siguen costando $1.000 cada uno. Pero el consumo
   **sí** cambia cuánto pesa la compra siguiente: 60 a $1.000 + 60 a $1.300 da
   $1.150, no $1.112,50.
2. **El stock sin costo toma el precio de la primera compra** (decisión del
   cliente). El saldo inicial se cargó sin precio; si lo promediáramos como si
   costara $0, la harina parecería regalada.
3. **Si no había stock, o estaba en negativo, el precio nuevo manda.**
   Promediar contra −5 kg da números absurdos, incluso más caros que cualquier
   compra real.
4. **Una compra anulada y su reversa se saltean las dos.**

### Por qué se RECONSTRUYE y no se suma

La forma ingenua es guardar el promedio y actualizarlo con la fórmula en cada
compra. Funciona hasta que hay que **anular** una compra: deshacer la fórmula
("¿cuál era el promedio antes de esta compra?") no se puede sin perder
precisión, y si en el medio hubo consumos, la cantidad contra la que se
promedió ya no es la misma.

Entonces el sistema hace lo mismo que con el stock: el valor guardado
(`insumo.costo_promedio`) es un **derivado**, y después de cada recepción o
anulación se **reconstruye** recorriendo todos los movimientos del insumo con
`calcularCostoPromedio`. Es exacto siempre, se testea con tres líneas de datos
(es una función pura) y sirve de herramienta de reparación si el valor
guardado alguna vez se corrompe.

> **La regla general:** todo valor derivado necesita una función que lo
> reconstruya desde los hechos. El stock (suma de movimientos), lo recibido de
> una orden (suma de recepciones) y el costo promedio (recorrido de compras)
> siguen la misma idea.

### El costo se congela en cada movimiento

El promedio cambia con cada compra. Pero la merma de marzo tiene que seguir
valiendo lo que valía en marzo. Por eso el motor ahora guarda en
`movimiento_stock.costo_unitario`:

- en una **compra**: lo que costó de verdad (precio ÷ factor);
- en **todo lo demás**: el promedio de ese momento (o null si nunca hubo
  compras).

Es el mismo patrón que el **snapshot del factor** (nota 05): se copia el dato
del momento para que el historial siga diciendo la verdad aunque el valor de
hoy cambie.

### Precio de la bolsa → costo del kilo

El proveedor dice "la bolsa de 25 kg está $25.000". El kardex está en kg,
así que el costo también: `$25.000 / 25 = $1.000 por kg` (`costoPorUnidadBase`).
Ese mismo cálculo es el que permite la **comparación de precios** que pidió el
cliente (C-6): una bolsa de 50 kg a $39.500 _parece_ más cara que una de 25 kg a
$25.000, pero el kilo sale $790 contra $1.000.

---

## 5. Numerar sin repetir

Las órdenes y recepciones llevan número correlativo ("recepción 15"). La forma
ingenua, `SELECT MAX(numero) + 1`, tiene la condición de carrera de siempre:
dos personas leen 14 y las dos generan 15.

La solución usa una tabla `contador_documento` (una fila por empresa y tipo de
documento) y **una sola sentencia**:

```sql
INSERT INTO contador_documento (empresa_id, tipo_documento, ultimo_numero)
VALUES ($1, 'RECEPCION_COMPRA', 1)
ON CONFLICT (empresa_id, tipo_documento)
DO UPDATE SET ultimo_numero = contador_documento.ultimo_numero + 1
RETURNING ultimo_numero;
```

Un `UPDATE` toma el candado de la fila hasta el fin de la transacción: el
segundo pedido espera y obtiene el 16. Y un detalle lindo: si la transacción
falla después (no hay stock para anular, por ejemplo), el incremento se
deshace con todo lo demás. **No quedan huecos** por operaciones que nunca
existieron. El test lanza 5 recepciones a la vez y verifica 5 números
distintos y correlativos.

---

## 6. ⭐⭐ El abrazo mortal que no se ve en el código

Esta es la parte más interesante de la fase.

### El problema que encontré leyendo, antes de escribir

Para recalcular el costo, la recepción toma el candado del **insumo** (si dos
recepciones de harina leyeran los movimientos al mismo tiempo, cada una vería
solo su compra y la última pisaría a la otra). Lo natural es
`SELECT ... FROM insumo ... FOR UPDATE`.

Pero hay un candado que **no está escrito en ningún lado**: cuando insertás
una fila en `movimiento_stock`, Postgres le pone a la fila del insumo al que
apunta un candado suave, `FOR KEY SHARE`. Es lo que garantiza la clave foránea:
"mientras esta transacción no termine, nadie borra ese insumo".

`FOR UPDATE` choca con `FOR KEY SHARE`. Entonces:

```
anulación A (Central):    inserta su reversa        → candado suave sobre la harina
anulación B (Laferrere):  inserta su reversa        → candado suave sobre la harina
anulación A:              FOR UPDATE de la harina   → espera el candado suave de B
anulación B:              FOR UPDATE de la harina   → espera el candado suave de A   💥
```

Cada una espera a la otra para siempre. Postgres lo detecta a los pocos
milisegundos y mata a una con el error `40P01 deadlock detected`.

### La solución

Postgres tiene cuatro fuerzas de candado de fila. Las dos que importan acá:

| Candado             | Qué dice                                     | ¿Choca con `FOR KEY SHARE`? |
| ------------------- | -------------------------------------------- | --------------------------- |
| `FOR UPDATE`        | "voy a cambiar esta fila, incluida su clave" | **Sí**                      |
| `FOR NO KEY UPDATE` | "voy a cambiar columnas, pero no la clave"   | **No**                      |

Para recalcular el costo solo se cambia la columna `costo_promedio`, no el
`id`. Entonces `FOR NO KEY UPDATE` es el candado justo: dos recalculadores
**sí** se ponen en fila entre ellos (que es lo que queríamos), pero ninguno
choca con los candados suaves de las claves foráneas. De hecho, es el mismo
candado que toma un `UPDATE` común que no toca la clave.

### ⭐ La lección dentro de la lección: el test que pasaba con el candado roto

Escribí un test: dos recepciones simultáneas de harina, una en cada sucursal.
Pasó. Después hice lo que corresponde con un test de concurrencia: **rompí el
candado a propósito** (volví a `FOR UPDATE`) para ver si el test lo detectaba.

**Siguió pasando. Tres veces.**

¿Por qué? Porque dos **recepciones** nunca llegan a pelear por el insumo:
antes pelean por el **contador de números**, que toma su candado primero.
Una espera a la otra en el contador, y cuando llega al insumo, la otra ya
terminó. El test probaba la numeración, no el abrazo mortal.

Las **anulaciones** no piden número. Escribí el test con dos anulaciones
simultáneas, rompí el candado otra vez, y ahora sí:

```
Raw query failed. Code: `40P01`. Message: `deadlock detected`
Tests  1 failed
```

Con el candado correcto, pasa. Eso es lo que convierte al test en una prueba
de verdad. La regla, que ya apareció en la Fase 5 y vale el doble para la
concurrencia: **un test que no podría fallar no prueba nada. Rompé el código
a propósito y mirá si el test se da cuenta.**

### El orden de todos los candados del módulo

Para que no haya abrazos mortales, toda operación que toma más de un candado
los toma en este orden (está escrito en `confirmarRecepcion`):

```
recepción → orden → contador → insumo_sucursal → insumo → proveedor_insumo
```

---

## 7. Lo que se actualiza solo: el último precio (C-7)

El cliente dijo que el precio "se carga cada vez que se carga una compra".
Entonces la recepción, en su misma transacción, actualiza
`proveedor_insumo.ultimo_precio` y su fecha. Tres detalles:

- **Si el proveedor nunca figuró para ese insumo, se crea la asociación.** Si
  le compraste, te lo provee.
- **Una recepción con fecha vieja no pisa un precio más nuevo.** "Último" es
  por fecha del hecho, no por orden de carga: si el lunes cargás la compra del
  viernes pasado, el precio de ayer sigue mandando.
- **Al anular, vuelve el precio anterior.** Muchas veces se anula justamente
  porque el precio se cargó mal. Se busca la recepción confirmada anterior; si
  no hay, se deja el que estaba (puede ser el que se cargó a mano).

Y si la asociación está registrada en otra presentación (el proveedor lo
tiene "por kilo" y esta vez llegaron bolsas), el precio se convierte pasando
por el costo del kilo.

---

## 8. Una COMPRA no se anula suelta

El encargado tiene permiso para anular movimientos desde el historial. Si
pudiera anular un movimiento `COMPRA` desde ahí, el stock bajaría, pero la
recepción seguiría "confirmada", la orden seguiría "recibida" y el costo
promedio no se recalcularía: **tres verdades distintas sobre la misma
compra**.

Por eso `anular` rechaza los movimientos `COMPRA` con
`COMPRA_SE_ANULA_DESDE_RECEPCION` y el mensaje dice desde qué recepción
hacerlo. La regla general: **un movimiento que nació de un documento se
corrige desde el documento.** Lo mismo va a valer para las transferencias.

Y en la base hay un `CHECK` nuevo que lo respalda: una `COMPRA` siempre tiene
`recepcion_compra_id` y `costo_unitario`.

---

## 9. Un día no es un instante

La regla del proyecto es "fechas en UTC". Pero la **fecha estimada de
entrega** no es un instante: es "el jueves". Si se guardara como
`2026-10-10T00:00:00Z`, en Argentina (UTC−3) sería el **9 a las 21 h**, y la
orden aparecería atrasada un día antes.

Por eso esa columna es `date` (un día de calendario, sin hora ni zona), viaja
como texto `'AAAA-MM-DD'`, y para saber si está atrasada se compara contra
**qué día es hoy en Argentina** (`diaEnArgentina`), no en UTC. Un truco: el
formato `AAAA-MM-DD` se puede comparar como texto y da el mismo orden que como
fecha.

> La regla de UTC es para **instantes** ("cuándo llegó el camión"). Los
> **días** ("cuándo debería llegar") son otra cosa, y mezclarlos es la fuente
> de bugs de "un día de diferencia" más común que existe.

---

## 10. Plantillas: lo que no se gasta

El cliente pidió poder guardar pedidos recurrentes ("lo de todos los lunes al
Molino"). Una **plantilla** es una orden a medio hacer, con nombre, que **no
se gasta**: la pantalla de orden nueva la usa para precargarse, y la plantilla
sigue ahí para la semana siguiente.

No guarda precios a propósito: con inflación, el precio de una plantilla
estaría viejo a la segunda semana. Al usarla, cada línea toma el **último
precio** que se le pagó a ese proveedor, que sí está al día porque lo actualiza
cada recepción.

---

## 11. El formulario que precarga (C-13)

El cliente dijo que el sistema lo va a usar sobre todo el dueño. Eso cambió una
prioridad: el camino del dueño tiene que ser el más corto. En la pantalla de
compra, **al elegir un insumo se precargan la presentación y el último precio**
que tiene registrados ese proveedor: elige "harina" y ya aparece
"bolsa 25 kg a $18.500"; solo cambia lo que cambió.

Un detalle de React: la precarga va en el `onChange` del insumo y **no** en un
`useEffect`. Un efecto correría también al abrir una orden para editarla, y
pisaría los precios que ya tenía. El `onChange` solo corre cuando la
**persona** cambia el insumo.

---

## Resumen en una línea por idea

- Pedir no mueve stock; recibir sí. Dos hechos, dos documentos.
- Una máquina de estados es una tabla: lo que no está, no se puede.
- Lo pendiente se calcula; las recepciones anuladas simplemente no suman.
- El costo promedio se reconstruye desde los movimientos; nunca se "deshace".
- Cada movimiento congela su costo, igual que congela su factor.
- `FOR NO KEY UPDATE` convive con los candados de las claves foráneas.
- Rompé el código a propósito para saber si el test sirve.
- Un día de calendario no es un instante.
