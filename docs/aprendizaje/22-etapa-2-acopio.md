# Etapa 2: el MVP de compras en acopio

_Escrita el 8/11/2026, al terminar las fases 12a a 12d. El cliente cambió el
rumbo: antes que un control de stock, necesita llevar la cuenta con los
proveedores. Siete ideas: reusar en vez de rehacer, la cuenta doble, guardar
imágenes en la base, el bug de Zod que convertía un dato mal escrito en un
500, pensar primero en el celular, el historial que no es una tabla, y los
reportes como funciones puras._

---

## 1. Cambiar de rumbo sin tirar nada

Marcelo dijo qué necesitaba **primero**: paga 100 bolsas por adelantado y le
entregan 20 por semana; quiere saber **cuánto le deben**. Eso, en el rubro, se
llama **acopio**.

La tentación era empezar de cero. Pero lo más difícil ya estaba hecho y
probado en la Fase 8: la orden de compra con varios insumos, las recepciones
parciales, la máquina de estados y "lo pendiente" (pedido − recibido), que es
exactamente "lo que me deben". La decisión fue **construir encima**:

- lo nuevo (pagos, comprobantes, historial, reportes) se sumó al lado;
- Stock, Transferencias y Reposición se **ocultaron del menú**, no se
  borraron: las recepciones siguen sumando stock por detrás, así que cuando
  llegue producción el stock ya tiene historia;
- el **vocabulario** sí cambió: para Marcelo es "compra" y "entrega", no
  "orden de compra" y "recepción". Las palabras de la pantalla son las del
  usuario, aunque el código siga diciendo `ordenCompra`.

---

## 2. ⭐ La cuenta doble: mercadería y plata

Cada compra tiene dos cuentas que se mueven por separado:

```
MERCADERÍA                    PLATA
  comprado 100 bolsas           total   $2.000.000
  llegaron  40                  pagado  $2.000.000
  ME DEBEN  60 ($1.200.000)     SALDO   $0 → pagada
```

Y de cruzarlas sale un número que Marcelo no tenía: la **plata adelantada sin
entregar** (pagado − lo que vale lo que llegó). Si la compra se cierra porque el
resto no va a llegar, ese mismo número pasa a ser **plata a favor**: el
proveedor se la tiene que devolver.

Una regla del cliente hizo exactas las cuentas: **cada compra mantiene su
precio** (C-22). "Te deben $1.200.000" es 60 bolsas × el precio de ESA compra,
no un precio de hoy ni un promedio. Todo está en una función pura
(`cuentaDeCompra`, en `shared/dominio/acopio.ts`) que usan igual la API y la
pantalla, y que se prueba sin base de datos.

---

## 3. ⭐ Imágenes dentro de Postgres

Los comprobantes (la captura de Mercado Pago, la foto del remito) se guardan en
la base, en una columna `bytea` (bytes). La alternativa era guardarlos como
archivos en el disco del servidor. Se eligió la base porque:

- entran **solos** en el backup cifrado que ya funcionaba (se probó: dump y
  restauración, las imágenes con la misma huella md5);
- un comprobante **nunca queda separado de su pago**: se guardan en la misma
  transacción. Con archivos, un error a mitad de camino deja fotos huérfanas;
- con fotos achicadas a ~300 KB, son ~200 MB por año: nada para Postgres.

Tres cuidados que vienen con recibir archivos:

1. **Se achica en el navegador**, con un `<canvas>` (sin librerías): una foto
   de 4 MB queda en ~300 KB y se sigue leyendo.
2. **No se le cree al nombre del archivo.** Cada formato empieza con una
   **firma** ("magic number"): un JPEG con `FF D8 FF`, un PNG con `‰PNG`. El
   servidor mira esos bytes; si no es una imagen, la rechaza aunque se llame
   `foto.jpg`. Y la sirve con el tipo que dijeron los bytes, con `nosniff`.
3. **El tope de tamaño está en tres lugares**: el esquema Zod, el servidor
   (12 MB para esos pedidos, 1 MB para el resto) y un `CHECK` en la base.

---

## 4. ⭐⭐ El bug que convertía "mil" en un error 500

Un test de pagos mandó el monto `'mil'` esperando un 400 ("no es un número").
La API respondió **500, error inesperado**. Y no solo en pagos: en **seis**
esquemas (precios, cantidades de consumo, de transferencias...).

La causa: en Zod 4, cuando una validación falla, **las siguientes se siguen
ejecutando**:

```ts
z.string()
  .refine(esDecimalValido, 'No es un número válido') // falla con 'mil'...
  .refine((v) => aDecimal(v).greaterThan(0), '...'); // ...y esta corre igual: aDecimal('mil') LANZA
```

El arreglo es decirle que corte ahí: `{ error: 'No es un número válido', abort: true }`.

Y el test nuevo encontró un segundo agujero: `"1,2,3"` pasaba como número.
`normalizarNumero` lo convertía en `"1.2,3"`, y `esDecimalValido` lo volvía a
normalizar a `"12.3"`, un número válido que nadie escribió. Una función de
normalizar tiene que ser **idempotente**: aplicarla dos veces da lo mismo que
una vez.

> Un dato mal escrito es un 400, nunca un 500. Un 500 dice "esto es un bug";
> el usuario no hizo nada malo por escribir "mil".

De paso: la **plata** se lee como en Argentina. "18.500" son dieciocho mil
quinientos (`normalizarImporte`); para cantidades sigue valiendo "1.5 kg".

---

## 5. Primero el celular

Marcelo usa el sistema en el celular y en la PC (C-27). Playwright pasó a
correr las pruebas del MVP en **dos tamaños** (390×844 con pantalla táctil, y
1280×800), con un control automático: **ninguna pantalla se puede salir de
costado** (`scrollWidth ≤ clientWidth`).

Pero "no desborda" no es "se usa bien", y eso lo mostraron las **capturas**:

- el encabezado ocupaba media pantalla → el tema se mudó a "Mi cuenta";
- el menú no entraba → en el celular es una **barra fija abajo**, como en las
  apps (y donde llega el pulgar);
- "Transferencia" no entraba en un tercio de pantalla → los medios de pago, uno
  abajo del otro;
- una tabla de cuatro columnas cortaba el precio → tres columnas.

---

## 6. El historial no es una tabla

"Todo lo que le pasó a esta compra" se podría guardar en una tabla `historial`.
Pero sería **la misma información dos veces**: el pago ya está en `pago`, la
entrega en `recepcion_compra`, la anulación tiene su fecha y su motivo. Dos
copias de la misma historia terminan diciendo cosas distintas.

`armarHistorial` (shared) recibe lo guardado y devuelve los eventos ordenados,
con sus textos. Las ediciones y el cierre, que no tienen tabla propia, salen de
la **auditoría**. Es la regla 15 aplicada a algo que no es un número: lo
derivado se reconstruye.

---

## 7. Reportes: funciones puras, números a mano, SVG a mano

Cada reporte es una función pura (`shared/dominio/reportes.ts`): recibe las
filas del período y devuelve el reporte. Se probaron con un **juego de datos
armado para que cada número se pueda sacar a mano** (100 bolsas a $20.000 + 50
a $22.000 → promedio ponderado $826,6667/kg). Si una cuenta estuviera mal, el
test lo dice con el número exacto.

- **Gráficos sin librería** (C-29): barras horizontales en SVG, con el valor
  escrito, y una línea para la evolución del precio. Horizontales porque en el
  celular los nombres largos entran y el número se lee sin adivinarlo.
- **CSV para Excel en español**: separador `;` (la coma es el decimal), números
  con coma, y un BOM (`\uFEFF`) al principio para que "Azúcar" no salga
  "AzÃºcar". Playwright baja el archivo y lo verifica.
- **Comprado ≠ pagado**: comprado es por la fecha del pedido, pagado por la del
  pago. Definirlo una vez evitó que dos reportes dijeran números distintos.

---

## Resumen en una línea por idea

- Cambiar de rumbo no es tirar: se construye encima y se oculta lo que no va.
- Cada compra tiene dos cuentas, mercadería y plata; de cruzarlas sale lo adelantado.
- Imágenes en la base: entran en el backup y nunca quedan huérfanas.
- Un archivo se reconoce por sus primeros bytes, no por su nombre.
- En Zod 4 una validación que falla no frena las siguientes: `abort: true`.
- Normalizar tiene que ser idempotente.
- "No desborda" no es "se usa bien": hay que mirar las capturas.
- El historial se arma con lo guardado; no se guarda dos veces.
- Un reporte es una función pura con números calculados a mano.
