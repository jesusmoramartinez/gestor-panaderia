# Unidades, conversiones y presentaciones

_Leer antes de la Fase 3._

## El problema real

En la panadería, el mismo insumo se nombra de tres formas distintas según quién hable:

- El **proveedor** vende "bolsas de 25 kg".
- El **panadero** usa "500 gramos" de harina por receta.
- El **dueño** quiere saber "cuántos kilos hay".

Si el sistema guarda cada movimiento en la unidad en que lo cargaron, el stock es una lista imposible de sumar: 4 bolsas + 500 gramos − 2 kilos. Y cada consulta tendría que convertir, lo que significa que la conversión está escrita en veinte lugares y en alguno está mal.

## La solución: una unidad base por insumo

Cada insumo tiene **una** unidad en la que se lleva su stock, para siempre: su **unidad base**. La harina se lleva en kg. Punto.

```
La persona carga:   4 bolsas
                       ↓  se convierte UNA VEZ, al entrar
Se guarda:          +100.000000 kg      ← cantidad_base
Y además se guarda: cantidad_ingresada = 4
                    unidad_ingresada   = "bolsa"
                    factor_conversion  = 25
```

A partir de ahí **todos** los movimientos de ese insumo están en kg, y el saldo es una suma directa. La conversión ocurre en un solo lugar del código: el servicio que registra movimientos.

¿Por qué guardar también lo que tipeó la persona? Porque el historial tiene que poder decir _"cargó 4 bolsas de 25 kg = 100 kg"_. Si solo guardás `100`, en una auditoría nadie puede reconstruir si cargó 4 bolsas o si tipeó 100 directo — y esa diferencia importa cuando hay que encontrar un error.

**Regla:** una vez que un insumo tiene movimientos, su unidad base **no se puede cambiar**. Cambiarla reinterpretaría todo el historial (los 100 "kg" pasarían a ser 100 "g"). La API lo rechaza.

## Dos mecanismos distintos (no confundirlos)

Es el punto donde más fácil se mezclan las cosas. Son dos problemas separados y cada uno tiene su tabla.

### 1. Conversión entre unidades: `unidad_medida`

Relación fija y universal, igual para todos los insumos y todas las panaderías del mundo: **1 kg = 1000 g**.

```
unidad_medida
┌────────┬──────────┬───────────┬────────────────┬─────────┐
│ codigo │ nombre   │ dimension │ factor_a_base  │ es_base │
├────────┼──────────┼───────────┼────────────────┼─────────┤
│ kg     │ Kilogramo│ PESO      │     1.0000000000│ true   │
│ g      │ Gramo    │ PESO      │     0.0010000000│ false  │
│ l      │ Litro    │ VOLUMEN   │     1.0000000000│ true   │
│ ml     │ Mililitro│ VOLUMEN   │     0.0010000000│ false  │
│ u      │ Unidad   │ UNIDAD    │     1.0000000000│ true   │
└────────┴──────────┴───────────┴────────────────┴─────────┘
```

`factor_a_base` = cuánto vale 1 de esta unidad expresado en la unidad base de **su dimensión**.

La conversión es siempre el mismo par de operaciones, pasando por la unidad base de la dimensión:

```
cantidad_destino = cantidad_origen × factor_origen ÷ factor_destino

2500 g → kg :  2500 × 0.001 ÷ 1    = 2.5 kg
2.5 kg → g  :  2.5  × 1     ÷ 0.001 = 2500 g
```

### 2. Presentación de compra: `presentacion_insumo`

Depende **del insumo**: "bolsa de 25 kg" solo tiene sentido para la harina. Una "bolsa" no es una unidad de medida universal — hay bolsas de 25 kg, de 50 kg y de 1 kg.

```
presentacion_insumo  (insumo: Harina 000, unidad base: kg)
┌───────────────┬────────────────┬────────────┐
│ nombre        │ cantidad_base  │ es_default │
├───────────────┼────────────────┼────────────┤
│ Bolsa 25 kg   │      25.000000 │ true       │
│ Bolsa 50 kg   │      50.000000 │ false      │
└───────────────┴────────────────┴────────────┘
```

`cantidad_base` = cuántas unidades base del insumo trae esa presentación.

> **El error típico** es poner "bolsa" en la tabla de unidades de medida con factor 25. Se rompe en cuanto aparece la bolsa de 50 kg, o en cuanto otro insumo (el azúcar) viene en bolsas de 10. Las unidades son universales; las presentaciones son del insumo.

## La regla de la dimensión

**Solo se convierte dentro de la misma dimensión.**

```
kg → g     ✅  misma dimensión (PESO)
l  → ml    ✅  misma dimensión (VOLUMEN)
kg → l     ❌  PESO → VOLUMEN: ¿cuánto pesa un litro?
```

Un litro de agua pesa 1 kg, un litro de aceite ~0,92 kg y un litro de harina suelta ~0,6 kg. Sin saber la **densidad** del material, la conversión no existe.

El sistema **no estima**: lanza un error explícito.

```ts
convertir(1, 'kg', 'l'); // DimensionIncompatibleError
```

Esto es importante como criterio de diseño: cuando un dato no alcanza para hacer una cuenta, lo correcto es **fallar fuerte y claro**, no inventar un número. Un error le dice al usuario que configuró mal el insumo; un número estimado le mete basura en el stock y nadie se entera.

> **Ojo en la panadería:** el aceite se compra por litro y a veces se usa por kilo. Si el cliente trabaja así, hay dos caminos: elegir una sola unidad por insumo y que todos carguen en esa (lo que asume el diseño hoy), o agregar `densidad` al insumo y habilitar PESO↔VOLUMEN solo para los que la tengan. Es la **pregunta C-3** del plan.

## La regla del snapshot

Esta es la que salva el historial, y la más fácil de olvidar.

Cuando un documento usa una presentación, **copia el factor en su propia línea**:

```
linea_recepcion_compra
  insumo_id              = Harina 000
  presentacion_id        = "Bolsa 25 kg"
  cantidad_presentacion  = 4
  factor_conversion      = 25.0000000000   ← la copia, en el momento del hecho
  cantidad_base          = 100.000000
```

¿Por qué no leer el factor desde `presentacion_insumo` cada vez que se muestra el documento? Porque mañana el proveedor cambia el envase a 24 kg, alguien edita la presentación, y **todas las compras del año pasado cambiarían de cantidad**. Un historial que cambia cuando editás un catálogo no es un historial.

Esa copia de un dato en el instante en que ocurre el hecho se llama **snapshot**, y aparece en varios lugares del proyecto:

| Snapshot            | Dónde                             | Por qué                                                  |
| ------------------- | --------------------------------- | -------------------------------------------------------- |
| `factor_conversion` | movimientos, líneas de documentos | El catálogo puede cambiar; lo que pasó, no.              |
| `costo_unitario`    | movimientos                       | El costo promedio de hoy no es el de la salida de marzo. |
| `cantidad_sistema`  | líneas de conteo físico           | Deja constancia de contra qué se comparó lo contado.     |
| `precio_unitario`   | líneas de compra                  | El precio de lista cambia todas las semanas.             |

**La regla general:** los **catálogos** describen cómo son las cosas _ahora_ y se pueden editar. Los **documentos y movimientos** describen lo que pasó y por eso copian lo que necesitan. Nunca se leen "en vivo" desde el catálogo.

## Por qué esto es su propia fase (la 3)

La función `convertir` es **pura**: entra una cantidad y dos unidades, sale una cantidad. No toca la base, no toca la red, no mira el reloj. Es la función más fácil de testear que vas a escribir en este proyecto, y todo el stock depende de ella.

Por eso se escribe primero, con sus tests, antes de que exista una sola pantalla:

```ts
convertir(1, kg, g); // 1000
convertir(2500, g, kg); // 2.5
convertir(0, kg, g); // 0
convertir(1, kg, l); // lanza DimensionIncompatibleError
convertir(1, kg, 'xx'); // lanza UnidadNoEncontradaError
// y: mil conversiones de ida y vuelta devuelven EXACTAMENTE el valor inicial
```

Los tests que esperan un **error** son tan importantes como los que esperan un número: un test que no puede fallar no prueba nada.
