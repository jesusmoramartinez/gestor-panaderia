# Dinero y cantidades: por qué nunca `float`

_Leer antes de la Fase 1._

## El experimento

Abrí una terminal, escribí `node` y probá esto:

```js
> 0.1 + 0.2
0.30000000000000004

> 0.1 + 0.2 === 0.3
false
```

No es un bug de JavaScript. Pasa igual en Python, en Java, en C y en Excel. Es cómo funcionan los números con coma en una computadora.

## Por qué pasa

Las computadoras guardan los números en **binario**: sumas de potencias de 2. Algunos decimales tienen representación binaria exacta (0.5 = 2⁻¹, 0.25 = 2⁻²), pero **0.1 no**. En binario, 0.1 es periódico, igual que 1/3 = 0,3333… en decimal: necesitarías infinitos dígitos.

El tipo `number` de JavaScript (un _float_ de 64 bits, el mismo `double` de otros lenguajes) tiene 53 bits para los dígitos. Así que guarda **el número más cercano a 0.1 que puede representar**, que no es exactamente 0.1. Sumás dos aproximaciones y obtenés una aproximación de la suma.

Para un gráfico o una temperatura, da igual. Para dinero y para stock, no.

## Qué pasa en una panadería

```js
// Convertir 3 bolsas de 25 kg a gramos y de vuelta
let kg = 0;
for (let i = 0; i < 10; i++) kg += 2.5; // diez paquetes de 2,5 kg
console.log(kg); // 24.999999999999996

console.log(kg === 25); // false
```

Ahora llevá eso a un año de operación:

- **El stock no cierra nunca.** Después de miles de movimientos, el saldo es `117.49999999999997` en lugar de `117.5`. La pantalla muestra 117,50 porque redondeás al mostrar, pero la comparación "¿hay suficiente para sacar 117,5?" devuelve **false**. El usuario ve 117,50 kg en la pantalla, pide 117,5 y el sistema le dice que no hay stock. Es imposible de explicar y es el tipo de bug que te hace perder la confianza del cliente.
- **Los totales de dinero dan mal por un peso.** Diez líneas de una recepción, cada una con su redondeo, y el total de la factura no coincide con el del papel. El dueño cuenta los pesos: siempre.
- **Es un bug que aparece de a poco.** Con datos de prueba nunca lo ves. Aparece en producción, con seis meses de movimientos encima, y para entonces ya está en todas las tablas.

## La solución: decimales exactos

### En la base de datos: `NUMERIC`

Postgres tiene un tipo que guarda los dígitos **como dígitos**, en base 10, con precisión arbitraria:

```sql
cantidad_base  NUMERIC(18, 6)   -- 18 dígitos en total, 6 después de la coma
costo_unitario NUMERIC(18, 4)
```

- **precisión** (18) = cuántos dígitos en total;
- **escala** (6) = cuántos van después de la coma.

Entonces `NUMERIC(18,6)` guarda hasta `999.999.999.999,999999`. En `NUMERIC`, `0.1 + 0.2` es exactamente `0.3`. Es un poco más lento que un float — y eso no tiene la menor importancia acá.

**Las escalas de este proyecto** (están en `CLAUDE.md`):

| Para qué               | Tipo             | Por qué                                                                                                           |
| ---------------------- | ---------------- | ----------------------------------------------------------------------------------------------------------------- |
| Cantidades             | `NUMERIC(18,6)`  | 6 decimales en kg = hasta el miligramo. Suficiente para esencia de vainilla y mejorador, que se usan en gramos.   |
| Dinero                 | `NUMERIC(18,4)`  | 4 decimales para que los precios unitarios (precio ÷ 25 kg) no pierdan nada. Se redondea a 2 solo **al mostrar**. |
| Factores de conversión | `NUMERIC(20,10)` | Un factor con poca precisión arrastra el error a todas las cantidades.                                            |

### En el código: una librería decimal

TypeScript no tiene un tipo decimal nativo: `number` **es** el float. Entonces:

```ts
// MAL: en el momento en que el valor pasa por `number`, el daño ya está hecho
const total = Number(precio) * Number(cantidad);

// BIEN
import { Decimal } from 'decimal.js';
const total = new Decimal(precio).times(cantidad);
```

Prisma ya devuelve las columnas `Decimal` como objetos `Decimal` (no como `number`), así que la regla práctica es: **no convertir nunca a `number` para calcular**. Las operaciones se escriben como métodos (`.plus()`, `.minus()`, `.times()`, `.div()`), que es más incómodo de leer que `+` y `-`, y es el precio de tener números correctos.

```ts
const saldo = movimientos.reduce((acc, m) => acc.plus(m.cantidadBase), new Decimal(0));
```

## Las reglas, en concreto

1. **Nunca `float` ni `double` en la base.** Ni para cantidades, ni para dinero, ni para factores.
2. **Nunca `parseFloat` ni `Number()` sobre un importe o una cantidad** para después calcular con el resultado.
3. **`number` se usa solo para contar cosas enteras** (cuántas líneas tiene una recepción) y para mostrar en pantalla.
4. **Comparar con los métodos de la librería**, no con `===`: `a.equals(b)`, `a.lessThan(b)`, `a.isZero()`.
5. **El redondeo se hace al final y una sola vez**, al formatear para la pantalla. Nunca en medio de una cuenta.
6. **El redondeo de las cantidades está definido y documentado:** 6 decimales en la unidad base, modo "mitad hacia arriba". Si no está definido en un solo lugar, cada módulo elige el suyo y los números dejan de coincidir entre pantallas.
7. **Hay tests.** En la Fase 3 hay uno que convierte kg → g → kg mil veces y verifica que el resultado sea **exactamente** el inicial. Con `float` ese test falla; con decimales pasa. Ese test es la prueba de que esta nota no es teoría.

## Un detalle que te va a morder: JSON

JSON no tiene tipo decimal. Cuando el backend manda `{ "cantidad": 117.5 }`, el navegador lo parsea como `number`, o sea float, y perdiste la exactitud en el camino.

Dos formas de manejarlo:

- **Mandar los decimales como texto:** `{ "cantidad": "117.500000" }`. El front los muestra tal cual y, si necesita calcular, los mete en un `Decimal`.
- **Que el front no calcule nada importante.** Todo lo que define stock o dinero se calcula en el servidor.

Vamos a usar las dos: los montos viajan como texto y el front solo hace cuentas de ayuda visual (por ejemplo, mostrar "4 bolsas = 100 kg" mientras escribís), usando la misma librería decimal a través de `packages/shared`.
