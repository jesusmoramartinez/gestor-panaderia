# Las 8 decisiones de arranque

Estas se tomaron antes de escribir una línea de código, porque cada una cambia el modelo de datos o el código de varias fases. Están acá con las alternativas descartadas: si más adelante hay que revisar una, el razonamiento está escrito.

Este formato (contexto → opciones → decisión → consecuencias) se llama **ADR** (_Architecture Decision Record_) y es una práctica estándar. Lo que te salva no es la decisión: es poder releer **por qué** la tomaste.

---

## 1. Sin lotes ni vencimientos en esta etapa

**Contexto.** La harina, la levadura y los lácteos tienen fecha de vencimiento, y una de las mermas típicas es "se venció".

**Opciones.**

- (a) Seguimiento completo por lote: cada entrada crea un lote con su vencimiento y **cada salida elige de qué lote descuenta**.
- (b) Guardar el vencimiento como dato informativo, sin saldo por lote.
- (c) Nada ahora, diseño preparado.

**Decidido: (c).**

**Por qué.** La opción (a) cambia la naturaleza del kardex: el saldo deja de ser "un número por insumo y sucursal" y pasa a ser "un número por insumo, sucursal **y lote**". Cada consumo necesita una política de selección (FIFO, por vencimiento más próximo, manual), cada merma tiene que indicar el lote, y el conteo físico se cuenta por lote. Es aproximadamente el doble de lógica en la fase más difícil del proyecto, antes de que exista nada funcionando. La (b) parecía un punto medio, pero guarda un dato que después nadie puede usar para nada confiable: si entraron dos partidas con vencimientos distintos, "el vencimiento del insumo" ya no significa nada.

**Consecuencias.** No hay alerta de "por vencer" y no hay FIFO. El vencimiento se maneja como hoy: mirando la etiqueta, y registrando una merma con motivo "vencido".

**Cómo entra después** (está en `PLAN.md` 3.12): tabla `lote` + columna `lote_id` **nullable** en `movimiento_stock`. Los movimientos existentes quedan con `lote_id = NULL` ("sin lote") y el saldo total sigue siendo la misma suma, así que nada de lo construido se tira. **Revisar con la pregunta C-27 al cliente:** si contesta que controlar vencimientos es urgente, hay que replanificar.

---

## 2. Valuación por costo promedio ponderado

**Contexto.** Hay que registrar el precio de compra. La pregunta es qué se hace con él.

**Opciones.** (a) Nada, solo guardarlo como historial · (b) usar el último precio para valorizar · (c) costo promedio ponderado · (d) FIFO por capas.

**Decidido: (c).**

**Por qué.** Con (a) no podés responder "¿cuánta plata hay en el depósito?" ni "¿cuánto nos costó la merma de ayer?", que son las dos preguntas que vuelven útil el registro de precios. (b) es simple pero con inflación argentina distorsiona fuerte: si el último precio subió 30%, valoriza las 100 bolsas viejas al precio nuevo. (d) es lo más exacto, pero necesita seguimiento por capas de entrada — o sea, lotes — que justo decidimos no hacer.

El promedio ponderado es el estándar para este caso, se explica en tres líneas y se calcula con una fórmula:

```
nuevo promedio = (cantidad_actual × costo_actual + cantidad_que_entra × costo_que_entra)
                 ─────────────────────────────────────────────────────────────────────────
                                    cantidad_actual + cantidad_que_entra
```

**Consecuencias.** Cada entrada recalcula el costo promedio del insumo. Cada salida congela el promedio del momento en el movimiento. El costo promedio queda **por empresa**, no por sucursal (más simple; en este negocio la mercadería va de la central a la sucursal al costo). Como es un valor derivado que se guarda, existe una función `recalcularCostoPromedio(insumoId)` que lo reconstruye desde los movimientos: hace exactas las anulaciones y sirve de herramienta de reparación.

---

## 3. Un usuario pertenece a una empresa, con un rol y varias sucursales

**Contexto.** Hay un dueño con dos sucursales, encargados y empleados, y el sistema se va a vender a otras panaderías.

**Opciones.** (a) usuario atado a una sola sucursal · (b) usuario de una empresa, un rol, N sucursales · (c) rol distinto por sucursal.

**Decidido: (b).**

**Por qué.** (a) obliga a un encargado que cubre las dos panaderías a tener dos cuentas, y entonces la auditoría se vuelve confusa ("¿cuál de los dos Juan cargó esto?"). (c) es más flexible, pero cada chequeo de permiso pasa a depender de la sucursal del pedido: más código, más tests, para un caso que hoy no existe. (b) cubre el caso real con un modelo simple: `usuario` tiene un `rol`, y `usuario_sucursal` dice dónde puede operar. El `DUENO` accede a todas sin necesidad de filas en esa tabla.

**Consecuencias.** El email es único **globalmente**, no por empresa (si el mismo email existiera en dos empresas el login sería ambiguo). Si en el futuro un contador necesita acceso a dos panaderías distintas, hace falta revisar esto.

---

## 4. Dominio en español, técnico en inglés

**Contexto.** El negocio es argentino, el ecosistema de JavaScript es inglés.

**Decidido.** Las palabras del negocio en español (`insumo`, `movimiento_stock`, `cantidad_base`, `registrarMerma`); los patrones técnicos en inglés (`services/`, `middlewares/`, `useQuery`, `repo.findMany`).

**Por qué.** "Merma" no tiene una traducción limpia: podría ser _waste_, _loss_, _spoilage_ o _shrinkage_, y cada una significa algo un poco distinto. Si cada desarrollador elige una, en seis meses el código habla tres idiomas y nadie sabe si `waste` incluye lo que se venció. Hablar con el dueño y con el código con el mismo vocabulario elimina una traducción constante — que es un lugar donde se cuelan errores. Al mismo tiempo, traducir los patrones técnicos (`servicios/`, `enrutador`) te deja afuera de todos los ejemplos y toda la documentación que vas a leer mientras aprendés.

**Consecuencias.** Convive `snake_case` en la base con `camelCase` en TypeScript, que es lo normal; Prisma lo mapea con `@@map` y `@map`.

---

## 5. La orden de compra es opcional

**Contexto.** El flujo "de manual" es orden de compra → recepción. En una panadería de barrio, muchas compras se piden por WhatsApp y a veces el proveedor aparece con el remito.

**Decidido.** Se puede recibir **con** orden previa (total o parcial) o **sin** orden (recepción directa).

**Por qué.** Si la orden fuera obligatoria, los usuarios inventarían órdenes falsas para poder recibir, y esos datos basura después ensucian cualquier informe. Un sistema que fuerza un circuito que el negocio no tiene se termina usando mal o no se usa.

**Consecuencias.** `recepcion_compra.orden_compra_id` es **nullable**, y la vista de reposición solo puede contar como "ya pedido" lo que efectivamente tiene una orden cargada.

---

## 6. Sesión en base de datos + cookie `httpOnly`

**Contexto.** Hay que autenticar usuarios desde un navegador.

**Opciones.** (a) JWT guardado en `localStorage` · (b) identificador de sesión en cookie `httpOnly`, con la sesión en una tabla · (c) un servicio externo (Auth0, Clerk, Supabase).

**Decidido: (b).**

**Por qué.** (a) es el camino de los tutoriales y el más fácil de depurar, pero el token queda accesible al JavaScript de la página: cualquier script inyectado (XSS) se lo lleva. Además un JWT **no se puede cancelar**: si echás a un empleado, su token sigue siendo válido hasta que vence. (c) resuelve mucho (recuperar contraseña, 2FA) pero agrega una dependencia externa, un costo y — lo más importante para este proyecto — te saltea entender cómo funciona la autenticación, que es exactamente lo que querés aprender.

Con (b): la cookie `httpOnly` no es legible por JavaScript, el navegador la envía sola, y como la sesión es una fila en una tabla, se puede revocar (logout, "cerrar sesión en todos los dispositivos") y se puede auditar. El costo es una consulta a la base por pedido, irrelevante para una panadería con 6 usuarios.

**Consecuencias.** Hay que entender y configurar CORS y CSRF (`SameSite`), que son dos conceptos que conviene aprender sí o sí. Se guarda el **hash** del token, no el token.

---

## 7. Stock negativo bloqueado, con permiso para forzar

**Contexto.** Un empleado carga un consumo de 20 kg pero el sistema dice que hay 12, porque nadie cargó la recepción de ayer.

**Opciones.** (a) bloquear siempre · (b) permitir y marcar en rojo · (c) bloquear con posibilidad de forzar para roles altos.

**Decidido: (c).**

**Por qué.** (a) es lo más prolijo en teoría, pero en la práctica el empleado no puede registrar lo que realmente pasó, así que inventa un ajuste o no carga nada: en los dos casos los datos quedan peor que con un negativo. (b) es cómodo los primeros días y después envenena todo: un negativo que nadie corrige rompe las alertas de reposición y la valuación. (c) protege por defecto y deja una vía de escape **con nombre y apellido**: el movimiento queda marcado (`forzado = true`) y registrado en auditoría, así que el negativo es visible y alguien lo va a corregir con un conteo.

**Consecuencias.** Un permiso nuevo (`stock:forzar_negativo`), una columna en `movimiento_stock` y un mensaje de error que diga los números concretos ("hay 12,5 kg, intentás sacar 20 kg") en lugar de un "error" seco.

---

## 8. La plataforma de deploy se decide más adelante

**Decidido.** La Fase 11 deja listos los requisitos (variables de entorno, build de producción, migraciones en el despliegue, backup y restore probados) sin atarse a una plataforma.

**Por qué.** Elegir hoy entre un PaaS (Railway, Render, Fly) y un VPS propio no cambia nada del código si se respeta la regla de que **toda la configuración viene de variables de entorno**. Y la decisión se toma mejor cuando el sistema existe y sabés cuánta plata y cuánto mantenimiento estás dispuesto a poner.

**Consecuencias.** Ninguna sobre el diseño; es una decisión postergada a propósito, no olvidada.
