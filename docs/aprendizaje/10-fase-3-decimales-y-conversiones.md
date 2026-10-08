# Fase 3: aritmética decimal y conversiones

_Escrita después de hacer la Fase 3. El concepto del dominio (unidad base,
dimensiones, la regla del snapshot) está en la nota
[05](05-unidades-y-conversiones.md); acá está lo que apareció al implementarlo._

---

## 1. Por qué esta fase existe separada

`convertir()` son veinte líneas. Podría haber sido parte del catálogo de
insumos. Tiene su propia fase por una razón: **todo movimiento de stock pasa
por esta función**. Si convierte mal, no hay un stock mal: hay todos los stocks
mal, y el error se descubre meses después cuando un conteo físico no cuadra.

Y como es **lógica pura** —entran datos, sale un número, no toca base de datos
ni red ni reloj— es el código más fácil de testear del proyecto. Es el lugar
ideal para aprender a escribir tests: 39 tests en el paquete compartido, todos
corriendo en 300 ms.

Una función pura tiene una propiedad que vale entender: **se puede razonar sobre
ella leyéndola**. No hay que preguntarse "¿y si la base está caída?" o "¿y si
otro usuario está haciendo algo al mismo tiempo?". Cuando puedas hacer pura una
parte de tu lógica, hacela.

---

## 2. El import de decimal.js: los tests pasaban, los tipos no

Escribí esto, que es lo que diría cualquier ejemplo:

```ts
import Decimal from 'decimal.js'; // ❌
```

Los tests pasaron. Todos. Y después `pnpm typecheck` tiró nueve errores:

```
Property 'set' does not exist on type 'typeof import(".../decimal")'
Cannot use namespace 'Decimal' as a type
```

La causa: decimal.js declara `Decimal` como **clase y namespace a la vez**
(declaration merging), y con `moduleResolution: NodeNext` el import por defecto
resuelve al namespace del módulo, que no tiene constructor. Lo correcto es el
import nombrado:

```ts
import { Decimal } from 'decimal.js'; // ✅
```

Lo interesante no es el detalle, es **por qué los tests no lo detectaron**:
Vitest transpila el TypeScript sin verificar los tipos (usa esbuild, que borra
las anotaciones y no las chequea). En ejecución, el interop de CommonJS
devolvía el objeto correcto y todo funcionaba.

Moraleja: `pnpm test` y `pnpm typecheck` **verifican cosas distintas**. Los dos
tienen que estar en verde, y por eso `pnpm check` corre los tres.

---

## 3. Un test que tuve que corregir antes de escribirlo

Iba a escribir este test, convencido de que iba a pasar:

```ts
// "los floats acumulan error al convertir ida y vuelta"
let v = 2.5;
for (let i = 0; i < 1000; i++) {
  v = (v * 1) / 0.001;
  v = (v * 0.001) / 1;
}
expect(v).not.toBe(2.5);
```

Lo probé antes de escribirlo y **es falso**: después de mil vueltas da
exactamente 2.5. Los redondeos de la multiplicación y la división se cancelan.

Así que busqué el caso que sí importa para un kardex, que es **sumar**:

```ts
let flotante = 0;
for (let i = 0; i < 1000; i++) flotante += 0.1;
expect(flotante).not.toBe(100); // da 99.9999999999986
```

Con `Decimal` da exactamente `100`. Y ese es el escenario real: el stock **es**
la suma de los movimientos (`SUM(cantidad_base)`), y mil movimientos de 0,1 kg
tienen que dar 100 kg, no 99,9999999999986 — porque si no, "¿hay 100 kg?"
responde que no, aunque la pantalla muestre 100.

La lección es sobre cómo escribir tests: **verificá que tu afirmación sea
verdadera antes de convertirla en un test**. Un test que asegura algo falso es
peor que no tener test: o falla y te confunde, o pasa por un motivo distinto
del que creés.

---

## 4. Formatear sin pasar por `number`

Para mostrar "1.234,5" usamos `Intl.NumberFormat('es-AR')`. La primera versión
hacía esto:

```ts
.format(decimal.toNumber())   // ❌ vuelve a float justo al final
```

Era incoherente: cuidamos la exactitud en toda la cadena y la perdíamos en el
último paso. Y no es teórico:

| Entrada                     | Pasando el texto                 | Pasando por `number`      |
| --------------------------- | -------------------------------- | ------------------------- |
| `123456789012345678.123456` | `123.456.789.012.345.678,123456` | `123.456.789.012.345.680` |

`Intl.NumberFormat.format()` **acepta una cadena** y la formatea con todos sus
dígitos. Así quedó:

```ts
.format(aDecimal(valor).toFixed(decimalesMaximos) as Intl.StringNumericLiteral)
```

Esa aserción (`as`) es un caso legítimo de uso: el tipo que pide Intl es una
plantilla que TypeScript no puede verificar sobre un string cualquiera, pero
nosotros sabemos que `toFixed()` siempre devuelve un literal numérico válido.
**Un cast se justifica cuando sabés algo que el compilador no puede demostrar**,
no cuando querés que se calle.

---

## 5. Lanzar en lugar de devolver `null`

`convertir(1, kg, litros)` no devuelve `null` ni `0`: **lanza**
`DimensionIncompatibleError`, con un mensaje que dice qué unidades y qué
dimensiones no encajan.

```
No se puede convertir de kg (PESO) a l (VOLUMEN): son dimensiones distintas.
```

El razonamiento: si alguien pide esa conversión, el insumo está **mal
configurado**. Un error lo avisa y se arregla; un número estimado entra al
stock y nadie se entera nunca. La regla general: **cuando los datos no alcanzan
para hacer una cuenta, fallá fuerte y claro.**

Y hay un test que verifica el _mensaje_, no solo que lance:

```ts
expect(() => convertir('1', KG, L)).toThrow(/kg \(PESO\).*l \(VOLUMEN\)/);
```

Porque un error de dominio tiene que servirle a quien lo lee para arreglar el
problema. Si el mensaje dijera solo "error de conversión", el test pasaría y el
usuario seguiría sin saber qué tocar.

---

## 6. Convertir y redondear son decisiones distintas

`convertir()` **no redondea**: devuelve el valor exacto. Redondear es una
decisión de quien **guarda**, no de quien calcula, y se hace explícitamente con
`redondearCantidad()`.

¿Por qué separarlo? Porque si `convertir` redondeara, una cadena de
conversiones iría perdiendo precisión en cada paso. Y porque el redondeo tiene
que ser **visible**: si no lo llamáramos, Postgres redondearía igual al guardar
(la columna es `NUMERIC(18,6)`), pero en silencio. El valor que creés que
guardaste y el que quedó serían distintos y nadie se enteraría.

Hay un caso que me gustó y quedó como test. Imaginá una unidad "pizca" de
0,0000001 kg (0,1 mg):

```ts
convertirABase('1', pizca).toString(); // '0.0000001'  exacto
redondearCantidad(convertirABase('1', pizca)); // '0'          al guardar
```

Una pizca es más chica que el miligramo, que es la resolución que elegimos.
Entonces, al guardarla, se vuelve cero. **Eso no es un bug: es información.** La
base tiene un `CHECK (cantidad_base <> 0)`, así que el sistema va a **rechazar**
ese movimiento en lugar de registrar silenciosamente una nada. El usuario va a
recibir un error que le dice que la cantidad es demasiado chica, que es
exactamente lo que necesita saber.

---

## 7. El `Decimal` de Prisma no es nuestro `Decimal`

Esto hay que saberlo porque es contraintuitivo. Elegimos decimal.js
justamente porque es la librería que Prisma empaqueta por dentro. Pero:

```
kg | clase: Decimal2 | toString(): "0.001"
instancia de NUESTRO Decimal: false
```

Prisma trae **su propia copia** de decimal.js (la clase se llama `Decimal2` en
su bundle). Es la misma librería y la misma versión, pero es **otro módulo**, o
sea otra clase. `valorDePrisma instanceof NuestroDecimal` da `false`.

Consecuencia práctica: en el borde entre la base y el dominio hay que convertir
explícitamente. En `modules/unidades/service.ts`:

```ts
factorABase: fila.factorABase.toString(),
```

Ese `.toString()` no es un adorno. Y tiene una ventaja: hace **visible** el
borde. Las filas de la base son un tipo; los objetos del dominio son otro; la
traducción ocurre en un lugar identificable, en el servicio.

(`toString()` de un `NUMERIC(20,10)` devuelve `"0.001"`, sin los ceros de
relleno que muestra `psql`. Los ceros a la derecha no cambian el valor.)

---

## 8. Los decimales viajan por la red como texto

JSON no tiene tipo decimal. Si el factor viajara como número:

```json
{ "factorABase": 0.001 }
```

el navegador lo parsearía como float y perderíamos exactitud justo en el dato
del que depende cada conversión. Así que viaja como texto:

```json
{ "factorABase": "0.001" }
```

Y hay un test que lo fija, mirando el JSON crudo:

```ts
expect(JSON.stringify(r.cuerpo)).toContain('"factorABase":"0.001"');
```

Lo elegante es lo que esto habilita. El tipo del dominio es **estructural**:

```ts
export type UnidadConversion = {
  codigo: string;
  dimension: Dimension;
  factorABase: Numerico; // Decimal | string
};
```

No es la fila de Prisma ni la respuesta de la API: es "lo mínimo que la
conversión necesita saber". Y como `Numerico` acepta texto, **la respuesta de la
API cumple ese tipo sin transformar nada**. El frontend puede hacer:

```ts
const unidades = await pedirApi('/api/unidades', { esquema: ListaUnidadesSchema });
convertir('2.5', kg, g); // la misma función que usa el backend
```

Hay un test de integración que cierra ese círculo: trae los factores de
Postgres por HTTP y convierte con ellos.

Fijate también que `Numerico` es `Decimal | string` y **no incluye `number`**.
Es a propósito: TypeScript mismo impide pasar un float por accidente. Si tenés
un literal, se escribe `aDecimal('2.5')`, no `aDecimal(2.5)`. La regla de
`CLAUDE.md` deja de depender de que te acuerdes.

---

## 9. La base como última línea de defensa

Prisma no puede expresar todo. Tres reglas se agregaron **a mano** al SQL de la
migración (con `prisma migrate dev --create-only`, que crea la migración sin
aplicarla para poder editarla):

```sql
-- Un factor de cero o negativo no significa nada y rompería la división.
ALTER TABLE unidad_medida
  ADD CONSTRAINT unidad_medida_factor_positivo CHECK (factor_a_base > 0);

-- La unidad base de una dimensión es, por definición, la que vale 1.
ALTER TABLE unidad_medida
  ADD CONSTRAINT unidad_medida_base_factor_uno
  CHECK (NOT es_base OR factor_a_base = 1);

-- UNA sola unidad base por dimensión y por empresa.
CREATE UNIQUE INDEX unidad_medida_una_base_por_dimension
  ON unidad_medida (empresa_id, dimension)
  WHERE es_base;
```

Ese último es un **índice único parcial**: la cláusula `WHERE` hace que la
restricción valga solo para las filas con `es_base = true`. Sin el `WHERE` no
podrían existir dos unidades de la misma dimensión, que es justo lo normal (kg
y g son las dos de PESO).

Y lo importante: **las probamos**. No alcanza con escribirlas, hay que
comprobar que rechazan:

```
✅ rechazado: factor cero          → unidad_medida_factor_positivo
✅ rechazado: factor negativo      → unidad_medida_factor_positivo
✅ rechazado: base con factor != 1 → unidad_medida_base_factor_uno
✅ rechazado: segunda base de PESO → unidad_medida_una_base_por_dimension
✅ aceptado:  base de VOLUMEN             (otra dimensión, no choca)
✅ aceptado:  segunda unidad NO base      (el índice es parcial)
```

El sistema tiene entonces **tres capas** de validación para lo mismo: Zod en el
borde, las reglas del servicio, y la base. No es redundancia por paranoia: cada
capa protege de un fallo distinto. Zod protege de datos mal formados que llegan
de afuera; el servicio, de operaciones que no tienen sentido en el negocio; la
base, de **nuestros propios bugs**.

---

## 10. Las unidades son de cada empresa

Un detalle fácil de pasar por alto: `kg` no es una fila, son **dos** — una por
empresa. Tienen el mismo código y el mismo factor, pero distinto `id`.

Podría haber sido una tabla global (un kilo es un kilo en todo el mundo). Se
hizo por empresa por coherencia con la regla del proyecto y porque mañana una
panadería puede querer agregar una unidad propia sin que aparezca en el catálogo
de las demás.

Eso agregó un caso al test de aislamiento, siguiendo la regla de `CLAUDE.md`
("el test de aislamiento crece con cada endpoint nuevo"): el dueño de una
empresa pide `/api/unidades` y ninguno de los ids de la otra aparece en la
respuesta.
