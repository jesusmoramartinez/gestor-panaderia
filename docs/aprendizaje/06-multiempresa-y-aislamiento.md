# Multi-empresa: cómo se evita que una panadería vea los datos de otra

_Leer antes de la Fase 2._

## El requisito

Hoy el sistema tiene un cliente: tu panadería, con dos sucursales. Pero la idea es venderlo a otras panaderías. Eso significa que en la misma base de datos van a convivir los datos de varios negocios que **no se conocen entre sí y compiten**.

Ese esquema se llama **multi-tenancy** (del inglés _tenant_, inquilino): una sola aplicación que atiende a varios clientes aislados. Acá, cada "inquilino" es una fila de la tabla `empresa`.

Que los datos de una empresa se vean desde otra no es un bug común: es **el peor bug posible** en este tipo de sistema. No se arregla con un parche — se pierde el cliente.

## Las tres formas de hacerlo

| Forma                                                      | Cómo es                                                             | Pros                                                          | Contras                                                                                        |
| ---------------------------------------------------------- | ------------------------------------------------------------------- | ------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| **Una base por empresa**                                   | Cada cliente tiene su propia base de datos                          | Aislamiento físico, imposible mezclar                         | Cada migración hay que aplicarla N veces; un cliente nuevo implica crear infraestructura; caro |
| **Un esquema por empresa**                                 | Una base, un _schema_ de Postgres por cliente                       | Buen aislamiento, una sola base                               | Las migraciones se multiplican igual; conexiones más complejas                                 |
| **Una tabla compartida con `empresa_id`** ← **el nuestro** | Todas las empresas en las mismas tablas, cada fila sabe de quién es | Una sola migración, un solo deploy, consultas simples, barato | **El aislamiento depende del código.** Un `WHERE` olvidado filtra datos                        |

Elegimos la tercera porque es la única razonable para un desarrollador solo con clientes chicos: una migración, un deploy, una base para respaldar. El precio es que el aislamiento **no lo garantiza la infraestructura: lo garantiza la disciplina**. Y por eso hay reglas estrictas.

## Las reglas

### 1. Toda tabla de negocio tiene `empresa_id`

Incluso cuando parece redundante. `linea_recepcion_compra` podría llegar a su empresa a través de `recepcion_compra`, pero igual lleva la columna: así cualquier consulta puede filtrar directamente, sin depender de un JOIN que alguien puede olvidar.

```sql
CREATE TABLE insumo (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id  uuid NOT NULL REFERENCES empresa(id),   -- ← nunca falta
  nombre      text NOT NULL,
  ...
  UNIQUE (empresa_id, nombre)      -- ← la unicidad también es por empresa
);
```

Fijate en el `UNIQUE`: si fuera `UNIQUE (nombre)`, la segunda panadería que quisiera dar de alta "Harina 000" recibiría un error de nombre duplicado por un insumo que no puede ni ver. **Toda restricción de unicidad en este sistema empieza con `empresa_id`.**

### 2. El `empresa_id` sale de la sesión. Siempre

Esta es **la regla más importante de seguridad del proyecto**.

```ts
// ❌ NUNCA. Esto es un agujero, no un bug de validación.
const insumos = await repo.listar(req.body.empresaId);

// ❌ NUNCA, lo mismo con otra ropa
const insumos = await repo.listar(req.query.empresaId as string);

// ✅ El empresaId viene de la sesión, que la armó el servidor al loguear
const insumos = await repo.listar(req.ctx.empresaId);
```

¿Por qué? Porque todo lo que viene en el pedido lo controla **el cliente**, y el cliente puede ser cualquiera con las herramientas del navegador abiertas. Si el `empresaId` viaja en el body, cambiar un UUID por otro alcanza para leer los datos de otra panadería. No importa que el frontend "siempre mande el correcto": el frontend no es una medida de seguridad, es una conveniencia.

El `empresaId` se resuelve **una vez**, en el middleware de autenticación, leyendo la sesión de la base:

```
cookie → tabla sesion → usuario → usuario.empresa_id → req.ctx.empresaId
```

Y de ahí no se discute más.

### 3. Toda consulta filtra por `empresa_id`

Sin excepciones, incluso cuando buscás por `id`:

```ts
// ❌ el UUID es imposible de adivinar... pero puede filtrarse por mil lados
//    (un link compartido, un log, un export). Y "difícil de adivinar" no es
//    un control de acceso.
const insumo = await prisma.insumo.findUnique({ where: { id } });

// ✅
const insumo = await prisma.insumo.findFirst({ where: { id, empresaId: ctx.empresaId } });
```

Y si no existe **o es de otra empresa**, la respuesta es la misma: `404`. Nunca `403`. Un `403` le estaría confirmando a quien prueba UUIDs que ese recurso existe y pertenece a alguien más; eso ya es información que no le corresponde.

### 4. La sucursal también se valida

El `empresa_id` no alcanza. Un empleado de la Sucursal 2 no tiene por qué cargar mermas en la Central. Entonces hay dos niveles de chequeo:

```
¿El recurso es de mi empresa?     → si no: 404
¿Puedo operar en esa sucursal?    → si no: 403  (el DUENO siempre puede)
```

La diferencia de códigos es intencional: en el primer caso el recurso "no existe" para vos; en el segundo existe y sabés que existe, pero no te corresponde.

### 5. Hay un test de aislamiento

Esto no se verifica leyendo el código: se verifica con un test que lo intenta.

En la Fase 2 se siembran **dos** empresas con datos y se escribe un test que, logueado como usuario de la empresa A, intenta leer, editar y borrar recursos de la empresa B, y verifica que **nunca** reciba datos. Ese test se extiende en cada fase nueva con los endpoints nuevos.

Es el test más valioso del proyecto: es el único que prueba algo que, si falla, termina el negocio.

## Dónde apoyarse para no depender solo de la memoria

La regla "no te olvides del `empresa_id`" es frágil si depende de que te acuerdes 500 veces. Tres ayudas, en orden de cuándo conviene cada una:

1. **Un contexto obligatorio.** Los servicios reciben siempre un `ctx: { empresaId, usuarioId, rol, sucursales }` como primer parámetro, y las funciones del repositorio lo exigen por tipo. Si te olvidás, **no compila**. Es la defensa más barata y la que usamos desde el día uno.
2. **Repositorios que inyectan el filtro.** Una capa fina donde `listarInsumos(ctx)` ya arma el `where` con el `empresaId`. El código de negocio no tiene ocasión de olvidarse porque no escribe el `where`.
3. **Row Level Security (RLS) de Postgres.** Postgres puede aplicar una política por fila: "esta conexión solo ve filas donde `empresa_id` = el valor de esta variable de sesión". Con eso, **aunque el código tenga el bug, la base no devuelve la fila**. Es la defensa definitiva.
   _Por qué no ahora:_ exige configurar la variable de sesión en cada conexión del pool y complica el debugging y las migraciones, sobre un modelo que todavía va a cambiar bastante. Está anotado en los riesgos de `PLAN.md` para cuando haya clientes reales distintos — que es exactamente cuando el riesgo se vuelve real.

## Lo que esto te deja hoy

Aunque hoy haya un solo cliente, el sistema ya está construido como multi-empresa. El día que aparezca la segunda panadería no hay que migrar nada: se inserta una fila en `empresa`, se crea su usuario dueño y arranca.

Y mientras tanto el mismo mecanismo te sirve para algo inmediato: el seed crea **dos** empresas, así los tests de aislamiento tienen contra qué probar desde la Fase 2.
