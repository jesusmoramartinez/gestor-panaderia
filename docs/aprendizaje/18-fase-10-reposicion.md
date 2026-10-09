# Fase 10: alertas, reposición, vistas SQL y EXPLAIN

_Escrita después de hacer la Fase 10. Cuatro ideas: una **vista** SQL y cómo
Postgres la optimiza, cómo se **lee un plan de consulta**, cómo se diseña una
pantalla que se entiende de un vistazo, y una regla de React que apareció por
tercera vez y que ya es una convención del proyecto._

---

## 1. Qué hay que reponer, con números

La pantalla responde una sola pregunta: **qué hay que traer, de dónde y
cuánto**. Con las decisiones del cliente (la Central abastece a las demás; se
compra en bultos enteros), la cuenta es esta:

```
Harina en Laferrere: hay 10, mínimo 50, máximo 80, nada pedido, nada en camino
  objetivo = 80 (el máximo; si no hay máximo, el mínimo)
  faltante = 80 − 10 − pedido − en camino = 70 kg

Central: hay 120, su mínimo es 100 → le SOBRAN 20
  → transferir 20 desde la Central
  → comprar los otros 50 → bolsas de 25 → 2 bolsas
```

Cuatro reglas que salen de ahí, todas con su test:

1. **Se descuenta lo pedido y lo que viene en camino.** Si no, el sistema
   sugiere pedir dos veces lo mismo, y el criterio de terminado lo prohíbe.
2. **A la Central nunca se le saca por debajo de su mínimo.** Abastecer a
   otra sucursal dejando a la Central sin harina solo cambia de lugar el
   problema.
3. **Se compra en bultos enteros, para arriba.** Faltan 60 kg en bolsas de
   25 → 3 bolsas (75 kg). Si da justo (50 kg), 2 y no 3.
4. **Sin mínimo, no hay alerta.** Lo encontraron los tests: un insumo sin
   stock y sin mínimo cuenta como "sin stock" en el semáforo, y el primer día
   los 28 insumos de la semilla aparecían como críticos con "nada que
   comprar". El mínimo es lo que dice "avisame de este insumo".

Toda la cuenta es una función pura (`planificarReposicion`), con 20 tests que
no necesitan base de datos.

---

## 2. ⭐ La vista SQL

El stock nunca se guarda: es la suma de los movimientos (nota 03). Para la
reposición hay que cruzar ese saldo con los mínimos de `insumo_sucursal`, para
cada insumo en cada sucursal. Se puede hacer en JavaScript (traer las sumas,
traer los mínimos, cruzarlos con un `Map`), pero es justo el trabajo para el
que existe la base.

Una **vista** es una consulta guardada con nombre:

```sql
CREATE VIEW v_stock_actual AS
SELECT empresa_id, sucursal_id, insumo_id, SUM(cantidad_base) AS saldo
FROM movimiento_stock
GROUP BY empresa_id, sucursal_id, insumo_id;
```

Desde afuera se usa como una tabla (`LEFT JOIN v_stock_actual v ON ...`),
pero **no guarda nada**: cada vez que se consulta, Postgres ejecuta lo de
adentro. El stock sigue sin estar guardado en ningún lado; la vista solo le
pone nombre a la suma.

**¿Cuándo vale la pena una vista?** Cuando la misma consulta se usa en varios
lugares (acá: la reposición y el número de alertas del menú) y cuando el JOIN
que hay que hacer con ella es natural en SQL. No vale la pena para "esconder"
una consulta que se usa una sola vez.

Prisma no conoce la vista (no está en `schema.prisma`: es SQL de una
migración), así que esas consultas van con `$queryRaw`. Y van **igual
filtradas por `empresa_id`**: el SQL a mano no es excusa.

---

## 3. ⭐⭐ Leer un plan de consulta (`EXPLAIN ANALYZE`)

¿La vista es lenta? Calcula la suma de **todos** los movimientos... ¿de todas
las empresas, y después filtra? Eso no se adivina: se le pregunta a Postgres.

`EXPLAIN` muestra el **plan**: los pasos que Postgres va a seguir para
contestar. `EXPLAIN ANALYZE` además lo ejecuta y dice cuántas filas pasaron
por cada paso de verdad.

### La trampa: con pocos datos, el plan miente

Con los 50 movimientos de desarrollo, Postgres lee la tabla entera siempre:
para tan pocas filas, recorrer todo es más barato que usar un índice. El plan
diría "Seq Scan" y no sabríamos si es un problema. Por eso cargué un volumen
realista **dentro de una transacción que después descarté** (`ROLLBACK`):
300.000 movimientos de la otra empresa y 30.000 de Laferrere.

### El plan, línea por línea (lo importante)

```
Hash Right Join                                       ← cruza la vista con insumos×sucursales
  ->  HashAggregate (rows=28)                         ← el GROUP BY de la vista: 28 saldos
        ->  Bitmap Heap Scan on movimiento_stock      ← lee las filas…
              (rows=30000)                            ← …SOLO las 30.000 de Laferrere
              ->  Bitmap Index Scan on
                  movimiento_stock_empresa_id_insumo_id_fecha_idx
                    Index Cond: (empresa_id = '1111…')  ← entra por el índice
  ->  Seq Scan on insumo (rows=28)                    ← tablas chicas: recorrerlas está bien
Execution Time: 9.648 ms
```

Se lee **de adentro hacia afuera** (lo más indentado se ejecuta primero), y
se mira:

- **`Seq Scan` vs `Index Scan`**: un Seq Scan recorre toda la tabla. Sobre
  `insumo` (30 filas) es lo correcto. Sobre `movimiento_stock` sería el
  problema: de 330.000 filas, solo importan 30.000.
- **`rows`**: cuántas filas pasaron de verdad. Leyó 30.000, no 330.000.
- **`Index Cond`**: qué condición usó para entrar por el índice.

### Lo interesante: el filtro que nadie escribió

La consulta **nunca** dice `WHERE v.empresa_id = Laferrere`. Dice
`i.empresa_id = Laferrere` y `v.empresa_id = i.empresa_id`. Postgres deduce
que entonces `v.empresa_id = Laferrere`, y **baja ese filtro adentro de la
vista**, antes del `GROUP BY`. Por eso una vista bien escrita no es más lenta
que la consulta escrita a mano: el optimizador las ve iguales.

### Lo que el plan también dice

Para Laferrere lee **todos** sus movimientos de la historia (30.000 en el
ejemplo). Una panadería genera unos pocos miles por año, así que son
milisegundos durante muchos años. Si algún día pesa, el plan ya está escrito
en PLAN.md 3.11: una tabla de saldos actualizada en la misma transacción que
el movimiento, con una función que la reconstruya. **No antes**: optimizar
sin un problema medido es la forma más común de agregar bugs.

---

## 4. Una pantalla que se entiende de un vistazo

La reposición se lee de arriba hacia abajo **en el orden en que se actúa**:

1. **Lo que manda la Central**: es gratis y es hoy. Con un botón que arma la
   transferencia.
2. **Lo que hay que comprar, por proveedor**: cada bloque es exactamente
   UNA orden de compra (un proveedor para una sucursal), con su total y un
   botón que la arma precargada.
3. **El detalle por sucursal**, cerrado: explica de dónde salen los números,
   pero no tapa los botones.

Lo tercero lo decidió una captura de Playwright: con todo en cero (el primer
día real), la pantalla medía **10.000 px** de alto y los botones quedaban
perdidos entre decenas de filas. Un `<details>` nativo lo resolvió sin una
línea de JavaScript.

Y la pantalla de **Inicio** dejó de mostrar datos técnicos de la sesión:
ahora dice qué pide acción hoy (insumos bajo el mínimo, transferencias por
recibir, compras atrasadas), cada cosa con su link. Si está todo bien, lo
dice: "todo en orden" también es información.

---

## 5. ⭐ La regla del `<select>`, por tercera vez

Ya había aparecido dos veces:

- Fase 8: la presentación mostraba "Suelto, en kg" con "Bolsa 25 kg" adentro.
- La transferencia (pantalla de la Fase 9, encontrado en esta): el destino
  precargado desde la reposición mostraba "Elegí a dónde va" con Laferrere
  adentro.

Es siempre lo mismo: el **valor** se pone antes de que lleguen las
**opciones** (vienen de otro pedido a la API). Un `<select>` no controlado
guarda su valor en el navegador; si en ese momento no existe la opción, se
queda en la primera, y cuando las opciones llegan no se entera. Lo que se ve
y lo que se guarda dejan de coincidir.

La regla, que ahora está en CLAUDE.md: **un `<select>` cuyas opciones llegan
de la API va controlado** (`value={...}`): React lo vuelve a pintar con el
valor correcto cada vez que cambian las opciones. Se aplicó a todos los que
había (proveedor, sucursal, insumo, unidad, destino).

> Tres veces el mismo bug en tres pantallas es la señal de que no era un
> error de una pantalla: era una regla que faltaba.

---

## Resumen en una línea por idea

- Lo pendiente y lo que viene en camino se descuentan: nunca pedir dos veces.
- A la Central no se le saca por debajo de su mínimo.
- Sin mínimo no hay alerta: el mínimo es el "avisame".
- Una vista es una consulta con nombre; no guarda nada.
- Un plan se lee de adentro hacia afuera, y con pocos datos miente.
- Postgres baja los filtros adentro de la vista: no es más lenta.
- Una pantalla se ordena en el orden en que se actúa.
- Un `<select>` con opciones de la API, controlado.
