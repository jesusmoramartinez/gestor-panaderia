# Fase 7: el ajuste de stock, y por qué se carga lo contado

_Escrita después de hacer la Fase 7. Es la nota más corta del proyecto, y eso
es una buena señal: la fase se apoya enteramente en el motor de la Fase 6. El
tema de fondo es uno solo, pero vale para cualquier formulario que hagas en tu
vida: **a quién le toca hacer la cuenta.**_

---

## 1. La fase que no necesitó ninguna migración

Lo primero que descubrí al empezar: no hacía falta crear nada en la base.

- el tipo `AJUSTE` ya estaba en el enum `TipoMovimiento`;
- los motivos de tipo `AJUSTE` ya los siembra el seed ("Diferencia de conteo", "Diferencia en transferencia", "Error de carga");
- el `CHECK` del signo ya contempla que un `AJUSTE` puede ir en los dos sentidos;
- el motor ya sabe tomar el candado, calcular el saldo y escribir.

La fase entera es **un servicio nuevo que llama al motor**. Eso no es suerte:
es la prueba de que la Fase 6 quedó bien diseñada. Si para agregar el ajuste
hubiera habido que tocar `movimiento_stock` o el motor, habría significado que
el kardex estaba modelado alrededor de las operaciones que conocíamos en ese
momento, en lugar de alrededor del hecho "algo entró o salió".

Es el mismo razonamiento de la nota 03, en la fila que decía:

| Operación                        | Movimientos que genera         |
| -------------------------------- | ------------------------------ |
| **(futuro)** orden de producción | un `CONSUMO` − por ingrediente |

Cuando llegue la producción, debería pasar exactamente lo mismo: cero
migraciones.

---

## 2. ⭐ Quién hace la cuenta: la decisión de la fase

Hay dos formas de pedirle a alguien que corrija un stock.

### La forma intuitiva (y peligrosa)

> "El sistema dice 70 y hay 62. Cargá el ajuste."

La persona tiene que hacer una resta **con signo** en la cabeza: `62 − 70 = −8`,
y después acordarse de que un faltante va en negativo. Si se equivoca y carga
`+8`, el stock queda en **78**: el doble de mal que antes de empezar. Y no hay
ninguna forma de que el sistema se dé cuenta, porque `+8` es un ajuste
perfectamente válido.

### La forma correcta

> "El sistema dice 70. ¿Cuánto hay?" → `62`

La persona escribe **lo que ve**. El sistema hace la resta:

```ts
const diferencia = contado.minus(saldoAnterior); // 62 − 70 = −8
```

Ahora hay **una sola cosa que puede estar mal**: el número que contó. Y si lo
contó mal, el error es del tamaño del error de conteo, no del doble.

La regla general, que sirve para cualquier formulario:

> **Pedí el dato que la persona OBSERVA, no el resultado de una cuenta.**
> Las cuentas las hace la computadora, que para eso está.

Lo mismo vale, por ejemplo, para "¿cuánto te queda por pagar?" (pedí cuánto
pagó), o para "¿cuántos días faltan?" (pedí la fecha).

### El invariante que queda, y su test

```
después de un ajuste, el saldo es EXACTAMENTE lo que se contó
```

Es una propiedad muy fácil de testear y muy difícil de romper sin que el test
se entere:

```ts
await ajustar([{ insumoId, cantidadContada: '62' }]);
expect(await saldoEnBase(insumoId)).toBe('62');
```

---

## 3. Tres consecuencias gratis de ese diseño

### Contar cero es válido — y es el caso más común

"Se terminó y nadie lo cargó" es, lejos, la razón más frecuente para ajustar.
Así que el esquema del ajuste acepta cero, al contrario de todas las otras
cargas:

```ts
// consumo, merma, saldo inicial: una cantidad de cero no significa nada
.refine((v) => aDecimal(v).greaterThan(0), 'Tiene que ser mayor que cero')

// ajuste: contar cero es un dato
.refine((v) => aDecimal(v).greaterThanOrEqualTo(0), 'No puede ser negativo')
```

Fijate que son dos esquemas distintos y no un parámetro: la regla no es la
misma, así que no comparten el código. Juntarlas con un `if` haría más difícil
leer cuál vale para qué.

### Un ajuste no puede dejar el stock negativo, y no hace falta validarlo

Como lo contado nunca puede ser negativo, el saldo que queda tampoco:

```
saldo_nuevo = saldo_anterior + (contado − saldo_anterior) = contado ≥ 0
```

Por eso el ajuste es el único movimiento de salida que **no lleva `forzar`**.
No es un olvido, y hay un test que lo deja escrito para que no se rompa en
silencio.

### Y es la forma de ARREGLAR un stock negativo

Si alguien forzó una salida y el saldo quedó en −15, contar 3 genera un ajuste
de `3 − (−15) = +18` y el saldo queda en 3. El ajuste no necesita saber que el
saldo estaba mal: la resta sale bien sola.

---

## 4. Si la cuenta coincide, no se escribe nada

Lo más tentador es escribir un movimiento de cero "para que quede registrado
que se contó". Tres razones por las que no:

1. **El `CHECK` de la base lo rechaza** (`cantidad_base <> 0`), y con razón: un
   movimiento que no mueve nada no es un hecho del kardex.
2. **Ensuciaría el historial.** Si el dueño cuenta 40 insumos por mes, en un año
   el historial de cada insumo tendría 12 filas donde no pasó nada, mezcladas
   con las que sí.
3. **No se pierde información**, porque el informe de la respuesta sí incluye
   esas líneas: "contaste 12 insumos y 10 estaban bien" es un resultado.

Y de ahí sale un detalle de HTTP que vale la pena pensar:

```ts
// 200, no 201
res.status(200).json(await service.ajustar(contextoDe(req), entrada));
```

El resto de las cargas **crean** movimientos siempre, así que `201 Created` es
correcto. Acá el pedido es "esto conté": el sistema compara y decide, y a veces
la respuesta es "no hice nada". Un `201` diciendo que no se creó nada es una
mentira chica, pero es una mentira.

---

## 5. El candado, otra vez — y por qué la pantalla miente un poco

La pantalla muestra, al lado de cada insumo, lo que dice el sistema y la
diferencia calculada **en vivo** mientras se escribe. Esa cuenta del navegador
es **solo informativa**, y eso está escrito en el código:

```tsx
/**
 * Es solo informativa: la cuenta que vale es la del servidor, que la hace con
 * el candado tomado. Acá sirve para que la persona vea el número antes de
 * enviar y se dé cuenta si tipeó 620 en lugar de 62.
 */
```

El motivo: entre que se abre la pantalla y se envía el formulario pueden pasar
dos minutos, y en el medio alguien pudo cargar un consumo. Si el servidor
confiara en el `saldoAnterior` que le manda el navegador, ese consumo
desaparecería del kardex sin dejar rastro.

Así que el servidor **vuelve a leer el saldo**, con el candado tomado, y calcula
la diferencia contra ese. Es exactamente la lección de la Fase 6:

> una validación (o una cuenta) que lee el estado y no tiene el candado solo
> dice cómo estaban las cosas hace un rato.

El test de concurrencia lo deja claro. Dos personas cuentan el mismo insumo al
mismo tiempo, una 62 y la otra 65, partiendo de 70:

```
SIN candado: las dos leen 70 → A escribe −8, B escribe −5 → saldo 57
             57 no es ninguna de las dos cuentas

CON candado: A escribe −8 (saldo 62). B espera, lee 62, calcula 65 − 62 = +3
             saldo 65, que es exactamente lo que contó la segunda
```

Y el test afirma sobre el invariante, no sobre el orden:

```ts
expect(['62', '65']).toContain(saldo); // una de las dos cuentas, nunca una mezcla
```

---

## 6. El motivo obligatorio no es burocracia

Un ajuste es la operación **más fácil de usar para tapar un faltante**: cambia
el saldo sin que haya pasado nada físico. No hay compra, no hay consumo, no hay
merma: simplemente el número es otro.

Por eso lleva tres candados que las otras cargas no necesitan:

| Candado                                         | Qué evita                                      |
| ----------------------------------------------- | ---------------------------------------------- |
| **Motivo obligatorio**, y de tipo `AJUSTE`      | Que el saldo cambie sin decir en nombre de qué |
| Permiso propio `ajuste:crear`                   | Que lo haga el empleado del turno              |
| Queda en el historial como cualquier movimiento | Que la corrección sea invisible                |

Sobre el tipo del motivo: "Vencido" es un motivo de **merma**, y en un ajuste no
explica nada. Si se aceptara, el informe de "¿cuánto perdimos por vencimiento?"
mezclaría pérdidas reales con diferencias de conteo. Hay un detalle lindo acá:
"Error de carga" existe **dos veces** en el seed, una para `MERMA` y otra para
`AJUSTE`, con ids distintos. El servicio compara el `tipo_aplicable`, no el
nombre, así que mandar el id de la versión "merma" en un ajuste se rechaza —
aunque el nombre sea el correcto.

---

## 7. Lo que se descartó, y por qué queda anotado

El plan original tenía un **conteo físico** como documento: una tabla
`conteo_fisico` con estados `BORRADOR` → `CERRADO`, líneas que se van
completando, y al cerrar genera los ajustes.

Eso sirve cuando **varias personas cuentan un depósito grande durante horas** y
hace falta guardar el conteo a medias, saber quién contó qué, y que el documento
quede firmado. No es este caso: el cliente dijo que no piensa contar y que lo va
a usar mayormente él.

Pero el diseño quedó escrito en `PLAN.md` 3.6, y la razón de anotarlo es esta:
**si algún día hace falta, el documento de conteo llamaría al mismo servicio de
ajuste que ya existe.** No habría que tocar el kardex ni el motor.

Eso es lo que significa "dejar el diseño preparado" sin implementar fuera de
alcance: no escribir código que no se usa, pero sí dejar pensado dónde encajaría
y verificar que encaja.

---

## Resumen en cuatro líneas

1. Pedí el dato que la persona **observa** (cuánto hay), no el resultado de una
   cuenta (la diferencia). Las restas con signo son una fábrica de errores.
2. Un invariante corto es un test corto: _después de un ajuste, el saldo es
   exactamente lo contado._
3. No escribas movimientos de cero. Informá que no hubo cambio, que es distinto.
4. Si una fase nueva no necesita migraciones, el diseño anterior estaba bien.
