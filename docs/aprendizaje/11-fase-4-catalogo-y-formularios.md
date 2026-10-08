# Fase 4: el catálogo y los primeros formularios

_Escrita después de hacer la Fase 4. Es la primera fase con pantallas de
verdad, así que la mitad de la nota es sobre el frontend._

---

## 1. Cuatro tablas, y una columna que NO existe

El catálogo son cuatro tablas, y cada una está porque responde una pregunta
distinta:

| Tabla                 | Responde                                                             |
| --------------------- | -------------------------------------------------------------------- |
| `categoria_insumo`    | ¿Cómo agrupo los insumos para buscarlos y armar la lista de compras? |
| `insumo`              | ¿Qué es, y **en qué unidad se lleva su stock**?                      |
| `presentacion_insumo` | ¿Cómo se **compra**? ("Bolsa 25 kg", "Maple 30 u")                   |
| `insumo_sucursal`     | ¿Cuánto es "poco" **en esta sucursal**?                              |

Las dos últimas son las que resuelven pedidos concretos del cliente: compro en
bolsas de 25 kg y el stock se lleva en kg; la central guarda 300 kg de harina y
la sucursal 50.

Y lo que importa de `insumo_sucursal` es lo que **no** tiene: no hay una
columna `stock_actual`. Guarda solo lo que configura una persona (el mínimo, el
máximo, la ubicación). El saldo se calcula sumando los movimientos, y eso llega
en la Fase 6. Si existiera esa columna, tarde o temprano alguien la editaría a
mano y el stock dejaría de ser consecuencia de las operaciones.

---

## 2. Unicidad por empresa, y el detalle de las mayúsculas

El nombre del insumo es único **por empresa**:

```prisma
@@unique([empresaId, nombre])
```

El seed carga "Harina 000" en las **dos** empresas a propósito: es lo que
demuestra que la restricción es por empresa y no global, y hay un test que
verifica que un listado nunca cruza las dos.

Pero el índice de Postgres **distingue mayúsculas**: "Harina 000" y
"harina 000" son dos valores distintos para la base, y la misma cosa para una
persona. Si solo confiáramos en el índice, el catálogo terminaría con el mismo
insumo dos veces y el stock partido en dos.

Por eso el servicio chequea primero, ignorando mayúsculas:

```ts
const existente = await repo.buscarPorNombre(ctx.empresaId, nombre); // mode: 'insensitive'
if (existente) throw errores.nombreDuplicado(`el insumo "${existente.nombre}"`);
```

Fijate que el mensaje devuelve el nombre **tal como está guardado**: quien
escribió "harina 000" ve "Ya existe el insumo «Harina 000»" y entiende qué
pasó. Es el mismo criterio que con el email en la Fase 2: un dato que una
persona escribe se normaliza o se compara sin distinguir mayúsculas, nunca se
deja a la suerte del índice.

Quedan las **dos** capas: el servicio compara sin mayúsculas, la base impide el
duplicado exacto si dos pedidos llegan al mismo tiempo.

---

## 3. La unidad base no se cambia, y lo garantiza el esquema

La unidad base es la decisión que hace funcionar al kardex: todos los
movimientos de un insumo se guardan convertidos a ella. Cambiarla
reinterpretaría todo el historial — los 100 "kg" pasarían a ser 100 "litros".

La forma de impedirlo no es una validación en el servicio. Es más simple:

```ts
export const ActualizarInsumoSchema = CrearInsumoSchema.omit({ unidadBaseId: true }).partial();
```

El campo **no existe** en el esquema de actualización. Zod descarta todo lo que
no está declarado, así que si alguien manda `unidadBaseId` en un PATCH, nunca
llega al servicio. Hay un test que lo prueba mandándolo: responde 200 y la
unidad sigue siendo la de antes.

Es una idea que vale para muchos casos: **la mejor validación es la que hace
que el dato inválido no exista**. Una regla que hay que recordar escribir se
olvida; un campo que no está en el esquema no se puede mandar.

(Cuando en la Fase 6 existan los movimientos, se puede agregar una operación
aparte "cambiar unidad base" que verifique que el insumo no tenga ninguno. Hoy
sería una regla que no se puede comprobar.)

---

## 4. PATCH: la diferencia entre "no lo mandes" y "ponelo en nada"

`PATCH` significa "cambiá solo esto". Pero hay dos cosas distintas que parecen
iguales:

| El cuerpo trae      | Significa              |
| ------------------- | ---------------------- |
| nada (`undefined`)  | No toques la categoría |
| `categoriaId: null` | Sacale la categoría    |

Si se tratan igual, un formulario que manda solo el nombre borraría la
categoría sin que nadie se lo pidiera. En el servicio se distinguen a mano:

```ts
const cambios: CambiosInsumo = {};
if (entrada.nombre !== undefined) cambios.nombre = entrada.nombre;
if (entrada.codigo !== undefined) cambios.codigo = entrada.codigo;
if (entrada.categoriaId !== undefined) cambios.categoriaId = entrada.categoriaId ?? null;

if (Object.keys(cambios).length === 0) return obtenerDetalle(ctx, insumoId);
```

Esa última línea también importa: un PATCH vacío **no** escribe en la base ni
genera una entrada de auditoría. No pasó nada, así que no se registra nada.

---

## 5. Los ids que vienen del pedido se verifican de a uno

El `empresaId` sale de la sesión (Fase 2), y eso protege de que alguien liste
los datos de otra empresa. Pero no alcanza: los ids que vienen **en el cuerpo**
del pedido los elige el cliente.

```ts
await exigirUnidadDeLaEmpresa(ctx, entrada.unidadBaseId);
if (entrada.categoriaId != null) await exigirCategoriaDeLaEmpresa(ctx, entrada.categoriaId);
```

Sin estos chequeos, el dueño de una panadería podría asignarle a su insumo la
unidad de medida o la categoría de otra empresa, pasando su UUID. No le daría
acceso a nada, pero le dejaría una fila apuntando a datos ajenos: un cruce que
después rompe consultas y no se entiende de dónde salió.

La regla general: **de un id que viene del pedido, lo único que sabés es su
forma**. Que exista, que esté activo y que sea tuyo hay que preguntárselo a la
base. Hay un test por cada uno de estos tres casos.

---

## 6. Otra vez el índice único parcial

Un insumo tiene **una** presentación "por defecto" (la que se propone al
comprar). Igual que con la unidad base en la Fase 3:

```sql
CREATE UNIQUE INDEX presentacion_una_default_por_insumo
  ON presentacion_insumo (insumo_id)
  WHERE es_default;
```

Y eso obliga a un detalle en el servicio: **antes** de marcar una presentación
como default hay que desmarcar la anterior, en la misma transacción. Si no, la
base rechaza la fila.

```ts
if (entrada.esDefault) {
  await tx.presentacionInsumo.updateMany({
    where: { insumoId, esDefault: true },
    data: { esDefault: false },
  });
}
```

Es un buen ejemplo de cómo una restricción de la base **moldea** el código:
nos obliga a hacer el cambio bien (los dos pasos juntos, o ninguno) en lugar de
confiar en que nadie marque dos defaults.

Y un detalle que salió al escribirlo: desactivar una presentación también le
quita la marca de default. Una presentación que ya no se usa no puede seguir
siendo la que se propone al comprar.

---

## 7. `cantidadBase` de una presentación no se edita

El esquema de actualización de presentaciones **no** incluye `cantidadBase`.
Mismo truco que con la unidad base, y por una razón parecida.

Los documentos viejos ya copiaron el factor en su propia línea (la regla del
snapshot, nota [05](05-unidades-y-conversiones.md)), así que el historial está
a salvo. Pero cambiar el contenido de "Bolsa 25 kg" a 24 alteraría en silencio
**todas las compras futuras**, y nadie se enteraría de cuándo cambió.

La alternativa es explícita: se desactiva esa presentación y se crea otra. Queda
registro de que son dos cosas distintas, y las compras anteriores siguen
diciendo la verdad.

---

## 8. HTML nativo en lugar de una librería de componentes

El plan decía "shadcn/ui". Terminamos con HTML nativo y Tailwind, y el motivo
es el caso de uso: esto se usa en **una tablet en el depósito**.

| Elemento                   | Qué trae gratis                                                                                                        |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `<dialog>` + `showModal()` | Atrapa el foco adentro, se cierra con Escape, oscurece el fondo con `::backdrop`, lo anuncian los lectores de pantalla |
| `<select>`                 | En una tablet abre el **selector del sistema operativo**: una rueda grande, cómoda, que el usuario ya conoce           |
| `inputMode="decimal"`      | Levanta el teclado numérico sin obligar a `type="number"`                                                              |

Un `Select` propio (como el de shadcn) se ve mejor en una captura de pantalla y
es peor al toque: una lista chica, con scroll propio, que hay que apuntar con el
dedo. Y un diálogo propio es exactamente donde la accesibilidad se hace mal:
el foco se escapa, Escape no cierra, el lector de pantalla sigue leyendo lo que
hay detrás.

La lección no es "las librerías de componentes son malas": es que **conviene
saber qué trae la plataforma antes de agregar una dependencia para
reemplazarla**. Acá el navegador ya resolvía lo difícil.

Lo que sí hicimos nosotros: las clases de los controles, en un solo lugar
(`components/formulario.tsx`), con `min-h-12` (48 px) como altura mínima — la
recomendación para destinos táctiles.

---

## 9. React Hook Form con el esquema compartido

El formulario no repite las reglas de validación: usa el **mismo** esquema Zod
que valida la API.

```tsx
const form = useForm({
  resolver: zodResolver(CrearInsumoSchema),
  defaultValues: { nombre: '', codigo: '', categoriaId: '', unidadBaseId: '' },
});
```

Los mensajes de error ("El nombre es obligatorio") están escritos una sola vez,
en `packages/shared`, y aparecen igual en el front y en la API.

Y hay reglas que el front **no puede** conocer: si el nombre ya existe, si la
categoría es de otra empresa. Esas llegan del servidor en el campo `detalles`
como `{campo: mensaje}`, y se las damos a React Hook Form para que marque el
input exacto:

```ts
for (const [campo, mensaje] of Object.entries(detallesPorCampo(error))) {
  setError(campo, { message: mensaje });
}
```

El resultado es que un 409 de nombre duplicado y un campo vacío se ven igual
para el usuario: el mensaje aparece abajo del input que corresponde.

### Un esquema que cambió por culpa del formulario

`categoriaId` era `z.uuid().nullish()`. Pero un `<select>` sin elegir devuelve
la **cadena vacía**, no `undefined`, así que el formulario mostraba
"identificador inválido" en un campo opcional.

De ahí salió `UuidOpcional`, que acepta `''`, `null` y un uuid, y traduce la
cadena vacía a `null`:

```ts
const UuidOpcional = z
  .union([z.literal(''), z.null(), z.uuid('Identificador inválido')])
  .nullish()
  .transform((valor) => (valor === '' || valor === undefined ? null : valor));
```

Es un buen ejemplo de algo que se aprende recién al conectar las dos puntas: el
esquema estaba "bien" en abstracto y mal para el formulario real que lo usa.

---

## 10. El linter encontró una promesa flotante

Al terminar el frontend, `pnpm lint` tiró cuatro veces el mismo error:

```
Promise-returning function provided to attribute where a void return was expected
@typescript-eslint/no-misused-promises
```

La causa: `form.handleSubmit(...)` devuelve una **promesa** (la validación puede
ser asincrónica), pero `onSubmit` espera una función que no devuelva nada.
Pasarle la promesa directamente la deja "flotando": si fuera rechazada, nadie
se enteraría.

En este caso es inofensivo —React Hook Form maneja sus errores adentro— pero el
linter no puede saberlo. La forma de decirlo explícitamente es el operador
`void`:

```ts
export function alEnviar(manejador) {
  return (evento) => {
    void manejador(evento); // "sé que devuelve una promesa y la descarto"
  };
}
```

Esa regla es una de las más valiosas de todo el linter: es la que avisa cuando
te olvidás un `await` de verdad. En un sistema de stock, un `await` olvidado
significa que la transacción siguió adelante sin esperar a la base.

---

## 11. Dos detalles chicos del frontend que cambian el uso

**El buscador espera.** Sin nada, escribir "harina" dispara seis pedidos al
servidor, uno por tecla. El hook `useDebounce` hace que el valor cambie recién
cuando pasaron 300 ms sin tocar nada, así que dispara **uno**. Lo interesante
es cómo se cancela el anterior: el `return` del `useEffect`.

```ts
useEffect(() => {
  const temporizador = setTimeout(() => setRetrasado(valor), esperaMs);
  return () => clearTimeout(temporizador); // <- cancela el anterior
}, [valor, esperaMs]);
```

**El filtro es parte de la clave del caché.**

```ts
useQuery({ queryKey: ['insumos', filtro], queryFn: () => listarInsumos(filtro) });
```

Cada combinación de búsqueda, categoría y página se guarda por separado, así
que volver a un filtro anterior es instantáneo: no vuelve a pedir nada. Y
después de crear o editar un insumo, `invalidateQueries({ queryKey: ['insumos'] })`
marca como viejas **todas** las combinaciones de una sola vez, porque la clave
es un prefijo.

---

## 12. Desactivar dos veces no es un error

El botón de desactivar abre un diálogo de confirmación, pero igual puede
llegar dos veces al servidor (un doble toque, un reintento de red). El servicio
lo trata como lo que es:

```ts
if (actual.activo === activo) return obtenerDetalle(ctx, insumoId);
```

Responde 200 con el estado actual, no escribe en la base y **no genera una
segunda entrada de auditoría**. Hay un test que cuenta las entradas después de
desactivar dos veces y exige que haya una sola.

Eso se llama ser **idempotente**: hacer la misma operación dos veces deja el
sistema igual que hacerla una. Es la misma propiedad que pedimos al seed
(nota [08](08-fase-1-prisma-y-migraciones.md)) y que va a hacer falta en el
cierre del conteo físico y en la recepción de una transferencia.
