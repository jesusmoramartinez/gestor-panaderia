# El kardex: por qué el stock se calcula y no se guarda

_El concepto más importante del proyecto. Leer antes de la Fase 6, y otra vez durante._

## La forma intuitiva (y por qué está mal)

Lo primero que uno piensa es: una tabla de insumos con una columna `stock_actual`.

```
insumo
┌────────────┬──────────────┐
│ nombre     │ stock_actual │
├────────────┼──────────────┤
│ Harina 000 │        70.00 │
└────────────┴──────────────┘
```

Entra una compra de 100 → `stock_actual = stock_actual + 100`. Sale un consumo de 30 → `stock_actual = stock_actual - 30`. Simple, rápido, y es lo que hacen muchos sistemas chicos.

Ahora imaginá esta conversación, un martes a las 7 de la mañana:

> — Acá dice que hay 70 kg de harina y en el depósito hay 45.
> — ¿Y qué pasó?
> — No sé.

Y no hay forma de saberlo. **El número 70 no tiene historia.** No sabés si alguien cargó mal, si falta registrar una merma, si hubo un consumo no cargado o si alguien se la llevó. Lo único que podés hacer es sobrescribir 70 por 45 y empezar de nuevo, perdiendo la información de qué pasó.

Peor: cuando un sistema permite editar el stock directamente, **la gente lo edita**. Y entonces el stock deja de ser consecuencia de las operaciones y pasa a ser una opinión.

## La forma correcta: guardar los hechos

En lugar de guardar el saldo, se guardan **todos los hechos** que lo afectan. El saldo es la suma.

```
movimiento_stock
┌────────────┬─────────────────┬──────────────┬────────────┬──────────────────┐
│ fecha      │ tipo            │ cantidad     │ usuario    │ motivo           │
├────────────┼─────────────────┼──────────────┼────────────┼──────────────────┤
│ 01/10 08:00│ SALDO_INICIAL   │      +100.00 │ Jesús      │                  │
│ 03/10 06:30│ CONSUMO         │       -30.00 │ Marcela    │                  │
│ 04/10 09:15│ COMPRA          │       +50.00 │ Jesús      │ remito 0001-4521 │
│ 05/10 18:00│ MERMA           │        -2.50 │ Marcela    │ Humedad          │
└────────────┴─────────────────┴──────────────┴────────────┴──────────────────┘

saldo = 100 - 30 + 50 - 2.50 = 117.50 kg
```

Esto se llama **kardex** (en contabilidad, _libro mayor_ o _ledger_). Es exactamente como funciona tu cuenta bancaria: el banco no guarda tu saldo y lo edita, guarda los movimientos. Cuando ves "$ 45.300", es una suma.

### Lo que ganás

|                                   | Columna `stock_actual`                   | Kardex                                 |
| --------------------------------- | ---------------------------------------- | -------------------------------------- |
| ¿Cuánto hay?                      | Lee un número                            | Suma los movimientos                   |
| ¿Por qué hay eso?                 | **Sin respuesta**                        | La lista completa de hechos            |
| ¿Quién lo cambió?                 | Sin respuesta                            | Está en cada movimiento                |
| ¿Cuánto consumimos en septiembre? | Sin respuesta                            | Una consulta con un filtro de fechas   |
| ¿Cuánto perdimos por vencimiento? | Sin respuesta                            | Suma de las mermas con ese motivo      |
| Se puede corregir un error        | Sobrescribiendo (se pierde la evidencia) | Con un movimiento inverso (queda todo) |
| Se puede auditar                  | No                                       | Sí, por construcción                   |

La diferencia no es técnica: es que **el sistema puede responder preguntas del negocio**. Y las respuestas que hoy parecen innecesarias son exactamente las que el dueño va a pedir en tres meses.

## Las dos reglas

### Regla 1: un movimiento nunca se edita ni se borra

Si alguien cargó 300 kg en lugar de 30, **no se corrige la fila**. Se escribe un movimiento inverso:

```
│ 03/10 06:30│ CONSUMO         │      -300.00 │ Marcela    │                     │
│ 03/10 07:10│ REVERSA         │      +300.00 │ Jesús      │ corrige mov. anterior│
│ 03/10 07:11│ CONSUMO         │       -30.00 │ Jesús      │                     │
```

Esto se llama **contra-asiento** y viene de la contabilidad de partida doble, que tiene unos 500 años de probada. El historial queda contando la verdad completa: _se cargó mal y se corrigió a los 40 minutos_. Comparalo con editar la fila: el número final es el mismo, pero desaparece la información de que hubo un error — justo la que te sirve para entender por qué el stock no cuadraba.

En la práctica: `movimiento_stock` no tiene `UPDATE` ni `DELETE` en ningún servicio. La reversa lleva `revierte_a_id` apuntando al original, con `UNIQUE`, para que un movimiento no se pueda revertir dos veces.

### Regla 2: la cantidad lleva signo

`+100` entra, `-30` sale. Una sola columna, `cantidad_base`.

La alternativa sería guardar siempre positivo y tener una columna `sentido` o deducirlo del tipo. Pero entonces cada consulta de saldo se convierte en:

```sql
SUM(CASE WHEN tipo IN ('COMPRA','TRANSFERENCIA_ENTRADA','SALDO_INICIAL') THEN cantidad
         ELSE -cantidad END)
```

El día que agregás un tipo nuevo — digamos `DEVOLUCION_PROVEEDOR` — tenés que acordarte de modificar **cada** consulta que haga esa cuenta. Si te olvidás de una, los números empiezan a dar mal y el bug es silencioso.

Con signo, la consulta es `SUM(cantidad_base)` y **no hay nada que olvidarse**. Lo que sí hay que proteger es que el signo coincida con el tipo, y eso lo hace la base de datos:

```sql
CHECK (
  (tipo IN ('COMPRA','TRANSFERENCIA_ENTRADA','SALDO_INICIAL') AND cantidad_base > 0) OR
  (tipo IN ('CONSUMO','MERMA','TRANSFERENCIA_SALIDA')         AND cantidad_base < 0) OR
  (tipo IN ('AJUSTE','REVERSA')                               AND cantidad_base <> 0)
)
```

Un `CHECK` es una regla que Postgres verifica en cada inserción. Aunque tu código tenga un bug, la base rechaza la fila imposible. Es la última línea de defensa, por debajo de Zod y de las reglas del servicio: **tres capas de validación, cada una por si falla la anterior.**

## ¿Y no es lento sumar todo cada vez?

La consulta es:

```sql
SELECT SUM(cantidad_base)
FROM   movimiento_stock
WHERE  empresa_id = $1 AND sucursal_id = $2 AND insumo_id = $3;
```

Con el índice `(empresa_id, sucursal_id, insumo_id, fecha)`, Postgres va directo a las filas de ese insumo en esa sucursal. Para dimensionar: una panadería con 40 insumos que registra 20 movimientos por día genera unas **7.300 filas por año**. Postgres suma eso sin transpirar; sigue siendo instantáneo con millones.

El momento de preocuparse es cuando una consulta real, medida, se pone lenta. **Entonces** se agrega una tabla de saldos actualizada en la misma transacción que el movimiento, más una función que la reconstruya desde el kardex para poder verificarla. Dos cosas importantes de esa solución futura:

1. el kardex sigue siendo la **única fuente de verdad**; la tabla de saldos es un caché;
2. tiene que existir la función que la reconstruye, porque un caché que no se puede verificar es un caché en el que no se puede confiar.

Optimizar antes de tener el problema medido es la forma más común de agregar bugs. Este es un caso de libro.

## Quiénes escriben movimientos

Todo en el sistema que mueve stock termina acá:

| Operación                        | Movimientos que genera                      |
| -------------------------------- | ------------------------------------------- |
| Carga de saldo inicial           | `SALDO_INICIAL` +                           |
| Recepción de compra              | un `COMPRA` + por línea                     |
| Consumo del turno                | un `CONSUMO` − por insumo                   |
| Merma                            | `MERMA` − con motivo                        |
| Cierre de conteo físico          | un `AJUSTE` por cada diferencia ≠ 0         |
| Envío de transferencia           | `TRANSFERENCIA_SALIDA` − en el origen       |
| Recepción de transferencia       | `TRANSFERENCIA_ENTRADA` + en el destino     |
| Anulación de cualquier cosa      | `REVERSA` con el signo opuesto              |
| **(futuro)** orden de producción | un `CONSUMO` − por ingrediente de la receta |

Mirá la última fila: **el módulo de producción no va a necesitar que el kardex cambie.** Va a ser un documento más que llama al mismo servicio. Esa es la señal de que el diseño está bien: las cosas nuevas se suman, no obligan a reescribir lo que hay.

Y de ahí sale la segunda regla de oro de la Fase 6: **un solo servicio escribe en `movimiento_stock`**. Una función `registrarMovimientos(tx, ctx, movimientos[])` que convierte unidades, valida signos, chequea stock negativo, asigna costos, inserta y audita. Si hubiera dos lugares que insertan movimientos, tarde o temprano uno se olvida de una validación — y lo vas a descubrir por un stock que no cuadra, tres semanas después.
