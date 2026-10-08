# CLAUDE.md — Sistema de gestión para panadería

Este archivo es el contrato de trabajo del proyecto. Lo lee Claude al empezar cada sesión y lo leés vos cuando no te acordás de una convención.

- **Plan completo (arquitectura, modelo de datos, fases):** `PLAN.md`
- **Notas de aprendizaje (una por concepto):** `docs/aprendizaje/`

---

## 1. El proyecto

Sistema web de gestión para una panadería con **dos sucursales**: una **central** que produce y abastece a la otra (y vende al por mayor a otras panaderías), y una segunda sucursal. Las dos venden al público.

El sistema está pensado para **venderse después a otras panaderías**, así que es **multi-empresa** desde el primer día: todas las tablas de negocio llevan `empresa_id` y los datos de una empresa nunca pueden verse desde otra.

**Etapa actual: control de stock de materia prima (insumos).**

Incluye: empresa/sucursales/usuarios con roles · catálogo de insumos con unidades y conversiones · proveedores · compras con recepción total o parcial · stock por sucursal basado en movimientos (kardex) · consumo manual · conteo físico y ajustes · mermas · transferencias entre sucursales · alertas de stock bajo y vista de reposición · historial de movimientos.

**Fuera de alcance (no implementar, solo dejar el diseño preparado):** recetas, producción, productos terminados, POS/caja, pedidos, clientes, venta mayorista, personal, reportes avanzados, avisos, facturación electrónica ARCA, funcionamiento offline.

### Perfil del desarrollador

Estudiante de Ingeniería Informática aprendiendo desarrollo web. **Las explicaciones son parte del entregable, no un extra.**

---

## 2. Reglas de trabajo (para Claude)

1. **Pasos pequeños.** Un paso = una cosa que funciona y se puede verificar. Al terminar cada paso, explicar **qué se hizo y por qué**, en lenguaje junior.
2. **Preguntar antes de decidir algo ambiguo.** Si hay dos caminos razonables y la elección cambia el trabajo, preguntar con las opciones y una recomendación. No adivinar.
3. **Preguntar antes de agregar una dependencia nueva.** Siempre, incluso si parece obvia. Decir qué problema resuelve, qué alternativa hay y qué se pierde sin ella.
4. **No implementar nada fuera de la fase actual.** Si aparece algo valioso de otra fase, anotarlo como mejora futura y seguir. Tampoco "aprovechar el viaje" para refactorizar lo que ya funciona.
5. **Sugerir un commit al terminar cada paso que funcione**, con el mensaje listo para copiar.
6. **Definir cada término técnico la primera vez que aparece**, y si da para más, dejar una nota en `docs/aprendizaje/` (una por concepto, en Markdown, con un ejemplo concreto del dominio de la panadería).
7. **Explicar los tipos de TypeScript** cuando aparezcan: qué dice el tipo y qué error evita.
8. **Los tests de la lógica de stock y de conversiones no son opcionales.** Una fase que toca stock no está terminada sin sus tests.
9. **No dar por terminado lo que no se verificó.** Si un test falla o un paso quedó a medias, decirlo con el output real.
10. **Al terminar una fase**, repasar el criterio de "Terminado cuando" de `PLAN.md` punto por punto antes de declararla cerrada.

---

## 3. Glosario del negocio

Estas palabras se usan **en español en el código** (tablas, campos, tipos, funciones de dominio). Son el vocabulario compartido con el cliente.

| Término                            | Qué significa                                                                                                                                                                                                                                                                                                                          |
| ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Insumo**                         | Materia prima o material que se compra y se consume: harina, levadura, manteca, bolsas. No es lo que se vende (eso es _producto terminado_, fuera de alcance).                                                                                                                                                                         |
| **Unidad base**                    | La unidad en la que se lleva el stock de un insumo, siempre la misma. La harina se lleva en kg aunque se compre en bolsas.                                                                                                                                                                                                             |
| **Presentación**                   | La forma en que se compra un insumo: "Bolsa 25 kg", "Cajón 12 u". Guarda cuántas unidades base trae.                                                                                                                                                                                                                                   |
| **Conversión**                     | Pasar una cantidad de una unidad a otra de la **misma dimensión** (kg↔g, l↔ml). No se convierte entre peso y volumen.                                                                                                                                                                                                                  |
| **Dimensión**                      | Familia de unidades: PESO, VOLUMEN, UNIDAD.                                                                                                                                                                                                                                                                                            |
| **Sucursal**                       | Un local físico. El stock pertenece a una sucursal, no a la empresa.                                                                                                                                                                                                                                                                   |
| **Central**                        | La sucursal que produce y abastece a las demás.                                                                                                                                                                                                                                                                                        |
| **Movimiento**                     | Un hecho que cambia el stock: una compra, un consumo, una merma, un ajuste, una transferencia. **Es inmutable:** una vez escrito no se edita ni se borra.                                                                                                                                                                              |
| **Kardex**                         | La forma de llevar el stock registrando todos los movimientos y calculando el saldo como su suma, en lugar de guardar un número y editarlo. Igual que un extracto bancario.                                                                                                                                                            |
| **Saldo / stock actual**           | La suma de los movimientos de un insumo en una sucursal. **Es un cálculo, nunca un campo editable.**                                                                                                                                                                                                                                   |
| **Consumo**                        | Salida de insumo por uso en producción. Hoy se carga a mano (el módulo de producción está fuera de alcance).                                                                                                                                                                                                                           |
| **Merma**                          | Pérdida de insumo sin que se haya usado: vencido, roto, derramado, plaga. Siempre lleva **motivo**.                                                                                                                                                                                                                                    |
| **Ajuste**                         | Movimiento que corrige el stock del sistema para que coincida con la realidad contada. Es el resultado de un conteo físico, no algo que se carga suelto.                                                                                                                                                                               |
| **Conteo físico**                  | Contar lo que realmente hay en el depósito y cargarlo. Al cerrarlo, el sistema genera un ajuste por cada diferencia.                                                                                                                                                                                                                   |
| **Transferencia**                  | Envío de insumos de una sucursal a otra. Tiene dos pasos: **enviada** (sale del origen) y **recibida** (entra al destino). Entre medio, la mercadería está **en tránsito**.                                                                                                                                                            |
| **Orden de compra (OC)**           | Lo que se le pide al proveedor. **No mueve stock.** Es opcional en este sistema.                                                                                                                                                                                                                                                       |
| **Recepción**                      | La llegada efectiva de la mercadería. **Esto sí mueve stock.** Puede ser total o parcial, con orden previa o directa.                                                                                                                                                                                                                  |
| **Remito**                         | El papel que trae el repartidor con lo entregado. Se guarda su número para poder cruzarlo.                                                                                                                                                                                                                                             |
| **Stock mínimo**                   | Cantidad por debajo de la cual el insumo aparece en las alertas. Se configura **por sucursal**.                                                                                                                                                                                                                                        |
| **Reposición**                     | La lista de "qué hay que comprar", agrupada por sucursal y por proveedor.                                                                                                                                                                                                                                                              |
| **Proveedor preferido**            | A quién se le compra un insumo por defecto. Hay **uno solo por insumo** (índice único parcial); marcar uno nuevo desmarca al anterior. Define bajo qué proveedor se agrupa el insumo en la reposición.                                                                                                                                 |
| **Costo promedio ponderado (CPP)** | Forma de valuar el stock: cada entrada actualiza el costo promedio del insumo según la cantidad y el precio que entró. Las salidas se valorizan a ese promedio.                                                                                                                                                                        |
| **Contra-asiento / reversa**       | Para corregir un movimiento no se lo borra: se escribe otro movimiento igual y opuesto que lo anula. El historial queda completo.                                                                                                                                                                                                      |
| **Auditoría**                      | Registro de quién cambió qué y cuándo, para todo lo que **sí** se puede modificar (catálogos, precios, usuarios, anulaciones).                                                                                                                                                                                                         |
| **Empresa (tenant)**               | El "inquilino" del sistema. Cada panadería cliente es una empresa; comparten las tablas y jamás los datos.                                                                                                                                                                                                                             |
| **Rol**                            | `DUENO` (todo, todas las sucursales), `ENCARGADO` (operación de sus sucursales), `EMPLEADO` (carga consumo y mermas de su sucursal).                                                                                                                                                                                                   |
| **Permiso**                        | Una acción concreta (`usuario:crear`, `insumo:editar`). Cada rol tiene una lista. La matriz vive en `packages/shared/src/dominio/permisos.ts` y crece en cada fase. **Ver** los catálogos no lleva permiso: lo necesita cualquiera que cargue stock. La excepción es `proveedor:ver`, porque esas respuestas llevan precios de compra. |
| **Sesión**                         | Un login activo. Es una fila en la tabla `sesion`; el navegador solo guarda un token opaco en una cookie que su JavaScript no puede leer.                                                                                                                                                                                              |
| **Contexto (`ctx`)**               | Quién hace el pedido: usuario, empresa, rol, permisos y sucursales habilitadas. Se arma al autenticar y de ahí sale el `empresa_id` de todas las consultas.                                                                                                                                                                            |

---

## 4. Stack

| Capa              | Herramienta                          | Nota                                                                                                                                                                                                                                                      |
| ----------------- | ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Monorepo          | **pnpm workspaces**                  | `apps/web`, `apps/api`, `packages/shared`. Instalar con `npm install -g pnpm` (este Node no trae corepack).                                                                                                                                               |
| Lenguaje          | **TypeScript strict**                | En los tres paquetes.                                                                                                                                                                                                                                     |
| Backend           | **Node.js + Express**                | En capas: routes → controllers → services → data access.                                                                                                                                                                                                  |
| Base de datos     | **PostgreSQL 18** en Docker Compose  | Local, con volumen persistente.                                                                                                                                                                                                                           |
| ORM               | **Prisma**                           | Migraciones versionadas + seed idempotente.                                                                                                                                                                                                               |
| Validación        | **Zod**                              | Esquemas en `packages/shared`, usados por el front y el back.                                                                                                                                                                                             |
| Frontend          | **React + Vite**                     |                                                                                                                                                                                                                                                           |
| Rutas             | **React Router 8**                   | Solo `react-router` (el paquete `react-router-dom` quedó obsoleto).                                                                                                                                                                                       |
| Datos en el front | **TanStack Query**                   | Caché del estado del servidor.                                                                                                                                                                                                                            |
| Estilos           | **Tailwind 4 + HTML nativo**         | Decidido en la Fase 4: en vez de shadcn/ui usamos los elementos del navegador (`<dialog>` trae foco atrapado y Escape; `<select>` abre el selector del sistema en tablet). Las clases de los controles están en `apps/web/src/components/formulario.tsx`. |
| Formularios       | **React Hook Form + Zod**            | El resolver usa los esquemas de `packages/shared`: los mensajes de error se escriben una sola vez.                                                                                                                                                        |
| Tests             | **Vitest**                           | Obligatorio en la lógica de stock y conversiones.                                                                                                                                                                                                         |
| Sesiones          | **cookie httpOnly + tabla `sesion`** | Sin JWT: la sesión se puede revocar. Token aleatorio, guardado hasheado con SHA-256.                                                                                                                                                                      |
| Contraseñas       | **`crypto.scrypt`** (nativo)         | Sin dependencias. Los parámetros de costo viajan dentro del hash.                                                                                                                                                                                         |
| Decimales         | **`decimal.js`**                     | La misma librería que Prisma empaqueta. El tipo `Numerico = Decimal \| string` NO acepta `number`.                                                                                                                                                        |

---

## 5. Convenciones de código

### Idioma

**Dominio en español, técnico en inglés.**

- Español: tablas, columnas, modelos, enums, tipos de dominio, funciones de negocio → `insumo`, `movimiento_stock`, `cantidad_base`, `registrarMerma`, `TipoMovimiento.MERMA`.
- Inglés: verbos y patrones técnicos, nombres de carpetas técnicas, librerías → `createInsumo` no existe (sería `crearInsumo`), pero sí `services/`, `middlewares/`, `useQuery`, `repo.findMany`.
- Regla práctica: si la palabra la diría el dueño de la panadería, va en español.
- Mensajes de error visibles para el usuario: **en español**. Códigos de error: en mayúsculas y estables (`STOCK_INSUFICIENTE`).

### Nombres

| Qué                          | Estilo                              | Ejemplo                                                   |
| ---------------------------- | ----------------------------------- | --------------------------------------------------------- |
| Tablas y columnas (Postgres) | `snake_case`, tabla en **singular** | `movimiento_stock`, `cantidad_base`                       |
| Modelos de Prisma            | `PascalCase` + `@@map` a snake_case | `model MovimientoStock { ... @@map("movimiento_stock") }` |
| Variables y funciones TS     | `camelCase`                         | `cantidadBase`, `calcularSaldo`                           |
| Tipos, interfaces, enums     | `PascalCase`                        | `TipoMovimiento`, `CrearInsumoInput`                      |
| Componentes React            | `PascalCase`                        | `TablaInsumos.tsx`                                        |
| Esquemas Zod                 | `PascalCase` + sufijo `Schema`      | `CrearInsumoSchema`                                       |
| Constantes                   | `SCREAMING_SNAKE_CASE`              | `MAX_LINEAS_CONSUMO`                                      |
| Archivos de test             | junto al archivo, `.test.ts`        | `unidades.test.ts`                                        |

### Backend: qué va en cada capa

- `routes.ts` — URLs, métodos y orden de middlewares. **Cero lógica.**
- `controller.ts` — `Schema.parse(req.body)`, armar el contexto, llamar al servicio, elegir el status. **No conoce reglas de negocio ni la base.**
- `service.ts` — **las reglas del negocio**. Abre y cierra transacciones. **No conoce `req` ni `res`.**
- `repo.ts` — consultas con Prisma. **No decide reglas.**

Si una función necesita `req`, no es un servicio. Si un servicio necesita saber el código HTTP, algo está mal.

### Frontend

- **Elementos nativos antes que componentes propios**: `<dialog>` para los modales, `<select>` para las listas, `inputMode="decimal"` para los números. El navegador ya resuelve el foco, el teclado y la accesibilidad.
- **Altura mínima de 48 px (`min-h-12`)** en todo lo que se toca. Se usa en una tablet en el depósito.
- Las clases de los controles viven en `components/formulario.tsx`, no repetidas en cada pantalla.
- Toda respuesta de la API se **valida** con su esquema compartido antes de usarla (`pedirApi`).
- Los errores por campo del servidor (`detalles`) se pasan al formulario con `setError`: el mensaje aparece abajo del input que corresponde.
- Esconder un botón NO es seguridad: `usePuede()` es comodidad, la defensa está en la API.

### Errores

- Clase `AppError` con `codigo` (estable, para el front), `mensaje` (en español, para el usuario) y `status` HTTP.
- Un middleware central los traduce a JSON. **Nunca** se filtra un error de Prisma ni un stack trace al cliente.
- Los errores esperables son parte del diseño: `STOCK_INSUFICIENTE` (409), `DIMENSION_INCOMPATIBLE` (400), `NOMBRE_DUPLICADO` (409), `SIN_PERMISO` (403).

### Validación

- Un esquema Zod por operación, en `packages/shared/src/esquemas/`.
- Los tipos se **derivan** del esquema con `z.infer`, nunca se escriben dos veces.
- La API no confía en nada: valida todo lo que entra, aunque el front ya haya validado.

### Tests

Hay dos clases y viven en lugares distintos:

| Clase           | Dónde                                | Qué prueba                                                                                                                                                                       |
| --------------- | ------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Unitario**    | junto al archivo, `loquesea.test.ts` | Lógica pura: conversiones, CPP, hashing, el limitador de intentos. Sin base de datos.                                                                                            |
| **Integración** | `apps/api/test/`                     | La API de punta a punta: levanta Express en un puerto libre, usa cookies y pega contra una base **aparte** (`panaderia_test`), que se borra y se vuelve a crear en cada corrida. |

- Los tests de integración necesitan Postgres levantado (`pnpm db:up`).
- Cada regla de negocio escrita en `PLAN.md` tiene que tener su test.
- Un test que no podría fallar nunca no sirve: probar también lo que **tiene** que dar error.
- **El test de aislamiento multi-empresa (`test/aislamiento.test.ts`) crece con cada endpoint nuevo.** Si una fase agrega un endpoint que devuelve datos, agrega su caso ahí.

---

## 6. Reglas de datos que no se negocian

1. **IDs `uuid`**, con `gen_random_uuid()` por defecto.
2. **Cantidades y dinero en `NUMERIC`/`Decimal`.** Nunca `float`, `double` ni `number` de JavaScript para calcular. Nunca `parseFloat` sobre un importe.
   - cantidades `NUMERIC(18,6)` · dinero `NUMERIC(18,4)` · factores `NUMERIC(20,10)`
3. **`empresa_id` en toda tabla de negocio**, y `sucursal_id` donde haya stock.
4. **El `empresa_id` sale siempre de la sesión del servidor.** Nunca del body, del query ni de un header. Si un endpoint lo acepta como parámetro, es un bug de seguridad.
5. **Toda query filtra por `empresa_id`.** Sin excepciones.
6. **Operaciones que tocan varias tablas van en una transacción.** O se escribe todo, o no se escribe nada.
7. **Fechas en `timestamptz`, guardadas en UTC**, mostradas en horario de Argentina. La `fecha` del hecho es un campo distinto de `created_at`.
8. **Los movimientos de stock son inmutables.** No hay `UPDATE` ni `DELETE` sobre `movimiento_stock`: se corrige con una reversa.
9. **El stock nunca se guarda ni se edita: se calcula** sumando los movimientos.
10. **No se borra: se desactiva** (`activo = false`) en todos los catálogos.
11. **Un solo servicio escribe movimientos de stock.** Ningún módulo inserta en esa tabla por su cuenta.
12. **Auditar todo lo que se puede modificar**, en la misma transacción que el cambio.

---

## 7. Comandos

```bash
# Base de datos
docker compose up -d            # levantar Postgres
docker compose down             # bajar (los datos quedan)
docker compose down -v          # bajar y BORRAR los datos

# Desarrollo
pnpm install                    # instalar todo el monorepo
pnpm dev                        # api + web juntos
pnpm --filter api dev           # solo el backend
pnpm --filter web dev           # solo el frontend

# Prisma
pnpm db:migrate                 # crear y aplicar una migración (desarrollo)
pnpm db:seed                    # cargar datos de prueba (idempotente)
pnpm db:studio                  # explorador visual de la base
pnpm db:reset                   # borrar, migrar y sembrar de nuevo

# Calidad — las tres tienen que estar en verde para cerrar un paso
pnpm typecheck
pnpm lint
pnpm test                       # los de integración necesitan `pnpm db:up`
pnpm check                      # las tres de una
```

## Usuarios de desarrollo

Los crea `pnpm db:seed`, todos con la contraseña `panaderia123`:
`dueno@panaderia.test`, `encargado@panaderia.test`, `empleado@panaderia.test`
y, en la segunda empresa (existe para los tests de aislamiento),
`dueno@vecina.test` y `empleado@vecina.test`.

---

## 8. Git

- `git init` y primer commit en la Fase 0. Trabajo directo sobre `main` (un solo desarrollador); si una fase se pone larga, rama `fase/N-nombre`.
- **Commits convencionales:** `feat`, `fix`, `chore`, `docs`, `test`, `refactor`, con alcance entre paréntesis.
  - `feat(stock): motor de movimientos con consumo y mermas`
  - `fix(unidades): redondeo al convertir gramos a kilos`
  - `docs(aprendizaje): nota sobre transacciones`
- Mensajes **en español**, en imperativo, explicando el **qué** (el _por qué_ va en el cuerpo si hace falta).
- Un commit por paso que funciona. No se commitea código que no compila ni tests en rojo.
- **Nunca** se commitea `.env`, `node_modules`, `dist` ni un backup con datos reales.
