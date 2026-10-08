# Fase 9: transferencias entre sucursales, y probar en el navegador

_Escrita después de hacer la Fase 9. Tiene dos partes: la de la fase (una
operación que toca dos lugares, el stock en tránsito, y un error de diseño
que estaba en el plan) y una que no estaba planeada pero que es la más
útil: **por qué los tests de la API no alcanzan, y cómo se prueba una
pantalla de verdad**._

---

## 1. Una operación en dos lugares se parte en dos hechos

Mandar 20 kg de harina de la Central a Laferrere parece **una** operación.
No lo es: son dos hechos, en dos lugares, hechos por dos personas en dos
momentos distintos.

```
08:00  la Central despacha         → TRANSFERENCIA_SALIDA  −20 kg en Central
         (la camioneta va por la ruta)
09:30  Laferrere confirma lo que llegó → TRANSFERENCIA_ENTRADA +20 kg en Laferrere
```

Si fuera un solo paso ("restar acá y sumar allá"), el sistema diría que la
harina ya está en Laferrere a las 8:00, cuando todavía está en la ruta. Y si
llega menos, nadie lo habría contado.

### El stock en tránsito

Entre los dos hechos, los 20 kg **no están en el stock de ninguna
sucursal**. Eso no es un error: es la realidad física, van en la
camioneta. El stock en tránsito no "pertenece" a ninguna sucursal, y por eso
no hace falta ninguna tabla nueva para verlo: la bandeja "en tránsito" es
simplemente la lista de transferencias en estado `ENVIADA`.

---

## 2. ⭐ El error que estaba en el plan

El plan decía: _"si recibió menos de lo que salió, se genera una MERMA en el
**origen**"_. Hagamos la cuenta:

```
Central:   50 − 20 (salida) − 2 (merma)  = 28     ← ¡bajó 22 por un envío de 20!
Laferrere: 0 + 18 (entrada)               = 18
```

La Central ya había descontado los 20 al enviar. La merma en el origen los
descontaba **otra vez**. Lo encontré releyendo el plan antes de escribir
código, haciendo la cuenta con números concretos. Es la mejor revisión de
diseño que existe y la más barata: **un ejemplo con números**.

### Las opciones, y la que eligió el cliente

| Opción                                                  | Laferrere    | ¿Dónde están los 2 kg perdidos?                       |
| ------------------------------------------------------- | ------------ | ----------------------------------------------------- |
| Entra solo lo recibido (18)                             | +18          | En ningún movimiento: solo en el documento            |
| **Entra lo enviado (20) y merma de 2 en el destino** ✅ | +20 −2 = +18 | En una merma con motivo "Diferencia en transferencia" |

La segunda tiene una propiedad que vale mucho: **cada kilo queda explicado
por un movimiento con nombre**. Si sumás las dos sucursales antes y después,
la diferencia es exactamente la merma declarada. Y la pérdida aparece en los
informes de mermas, con su motivo.

La lógica es una función pura con sus tests (`movimientosAlRecibir` en
`shared/dominio/transferencias.ts`), y hay un **test de conservación** que
hace varias transferencias y verifica la suma de las dos sucursales después
de cada una.

---

## 3. Viajar al costo

Las dos sucursales son la misma empresa (supuesto confirmado de C-20 y
C-30), así que la Central no le "vende" a Laferrere: le pasa la mercadería
**al costo**. El costo promedio que congela la salida se copia a la línea de
la transferencia, y la entrada en el destino (y la merma) usan **ese mismo
costo**. Resultado: una transferencia no cambia el costo promedio de nadie,
que es lo correcto: no se compró nada.

Si algún día la Central le vendiera con margen, la transferencia pasaría a
ser una operación comercial, con precio, y no un simple movimiento. Por eso
esa pregunta había que hacerla **antes** de la fase.

---

## 4. Recibir una sola vez (otra vez el candado)

Dos personas en Laferrere apretan "confirmar" al mismo tiempo. Sin
protección, las dos leen `ENVIADA`, las dos escriben la entrada, y Laferrere
suma 40 kg de un envío de 20.

La solución ya la conocés: `SELECT ... FOR UPDATE` sobre la fila de la
transferencia **antes** de leer el estado. La segunda espera, lee
`RECIBIDA` y recibe un 409.

Y lo comprobé de la forma que aprendimos en la Fase 8: **saqué el candado a
propósito**. Los dos tests de concurrencia fallaron las tres veces (las dos
confirmaciones daban 200). Con el candado, pasan. Ahora sé que los tests
prueban lo que dicen.

---

## 5. Los permisos dependen de la sucursal... y de la PUNTA

| Acción  | Permiso                            | Tiene que poder operar en                       |
| ------- | ---------------------------------- | ----------------------------------------------- |
| Enviar  | `transferencia:enviar`             | el **origen**                                   |
| Recibir | `transferencia:recibir`            | el **destino** (C-19: "el que recibe confirma") |
| Anular  | `transferencia:enviar`             | el **origen** (anula quien envió)               |
| Ver     | ninguno (son cantidades, no plata) | cualquiera de las dos puntas                    |

El encargado de la Central puede **elegir** Laferrere como destino aunque
no trabaje ahí. Para eso hizo falta un endpoint nuevo, `GET /sucursales`:
las sucursales donde podés operar (las de tu sesión) no son lo mismo que las
que existen.

---

## 6. ⭐⭐ Por qué los tests de la API no alcanzan

Al cerrar la Fase 8 escribí "no vi las pantallas en un navegador". Al rato,
el cliente probó y **la compra no cargaba ningún insumo**.

La causa: tres pantallas pedían `GET /api/insumos?limite=200` para llenar
el desplegable, y la API acepta como máximo 100. Respondía 400, la lista
quedaba vacía y la pantalla no decía nada. Venía roto **desde la Fase 6**
(la carga de consumo también lo tenía). ¿Por qué ningún test lo vio?

- Los tests de la API mandan pedidos **bien armados**: el pedido mal armado
  estaba en el front.
- El typecheck no lo podía ver: `200` es un `number` perfectamente válido.
- "Vite sirve el módulo con 200" solo dice que el archivo compila.

Lo único que lo podía ver era **usar la pantalla**.

### Cómo se prueba en el navegador sin agregar nada al proyecto

No tengo un navegador integrado en la sesión, pero en la máquina hay
Chromium, y Chromium se puede manejar por programa con el **protocolo de
DevTools (CDP)**: el mismo que usa la pestaña de herramientas de desarrollo,
y el mismo que usan Playwright y Puppeteer por dentro.

1. Se arranca Chromium **sin ventana** (`--headless`) con
   `--remote-debugging-port`.
2. Se conecta por WebSocket (Node 26 lo trae incorporado, sin instalar nada).
3. Se le mandan órdenes: ir a una URL, ejecutar JavaScript en la página,
   sacar una captura.
4. Se escuchan sus avisos: errores de consola, excepciones y respuestas
   HTTP ≥ 400.

Con eso armé un script que entra como el dueño, arma una compra, la recibe
en dos partes, cambia de usuario, confirma una transferencia… y saca una
captura de cada pantalla en 768×1024 (la tablet del depósito).

### Lo que encontró, que ningún test había visto

| Qué                                                                        | Por qué los tests no lo veían                                                         |
| -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| Las listas de insumos vacías (`limite=200`)                                | El pedido mal armado estaba en el front                                               |
| La presentación mostraba "Suelto, en kg" y se guardaba "Bolsa 25 kg"       | El valor del formulario era correcto; lo que estaba mal era **lo que se veía**        |
| Al dueño, recién despachada una transferencia, le preguntaba "¿qué llegó?" | La API hacía bien su trabajo; era un problema de qué mostrar según dónde estás parado |

El segundo merece una explicación. Al elegir el insumo, la presentación se
precargaba **antes** de que llegaran sus opciones (vienen de otro pedido).
Un `<select>` **no controlado** (el navegador guarda su valor) se quedó
mostrando la primera opción. Un `<select>` **controlado** (`value={...}`:
React manda) se vuelve a pintar cuando aparecen las opciones.

### Dos trampas del propio script

- `innerText` devuelve el texto **como se ve**, y el CSS ponía un título en
  mayúsculas: "COSTO PROMEDIO ACTUAL". Buscar "Costo promedio actual" fallaba
  aunque estaba ahí. `textContent` devuelve el texto como está en el HTML.
- Una vez Vite sirvió un archivo **vacío**: lo había leído justo mientras
  prettier lo reescribía. El archivo en disco estaba bien. Antes de "arreglar"
  algo, mirá qué está sirviendo de verdad el servidor.

> **La regla:** typecheck + tests de la API + "compila" no es "anda". Una
> pantalla está probada cuando alguien (o algo) la usó.

---

## Resumen en una línea por idea

- Una operación en dos lugares son dos hechos: enviar y recibir.
- El stock en tránsito no es de nadie: es la lista de lo `ENVIADO`.
- Un ejemplo con números encuentra errores de diseño antes de escribir código.
- La diferencia es una merma en el destino: cada kilo explicado por un movimiento.
- Al costo: una transferencia no cambia el costo promedio.
- El candado antes de leer el estado; y romperlo a propósito para probar el test.
- Qué se muestra depende de dónde estás parado, no de dónde podés operar.
- Una pantalla está probada cuando alguien la usó.
