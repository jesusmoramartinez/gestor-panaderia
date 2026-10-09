# Fase 11: de "anda en mi máquina" a producción

_Escrita después de preparar la Fase 11. El sistema no está desplegado todavía
(las cuentas de Vercel y Supabase las crea el cliente; ver
`docs/deploy-vercel-supabase.md`), pero todo lo que depende del código está
hecho y probado. Esta nota junta lo que cambia cuando el software sale de tu
máquina, y tres cosas que se encontraron **probando**: un backup que no se
podía restaurar, un "en mi máquina anda" que atrapó el CI, y una puerta
trasera que abre Supabase sola._

---

## 1. Desarrollo y producción no son el mismo lugar

En tu máquina hay un solo usuario (vos), un solo proceso, la base al lado, y
si algo se rompe lo ves en la consola. En producción hay desconocidos en
internet, muchos procesos que nacen y mueren solos (Vercel), la base en otro
país, y nadie mirando la consola. Casi todo lo de esta fase sale de esa
diferencia.

La idea que ordena todo se llama **12-factor** (doce reglas para aplicaciones
que corren en la nube). Las que usamos:

- **La configuración vive en el entorno, no en el código.** La misma
  aplicación compilada corre en tu máquina y en Vercel; lo que cambia son las
  variables (`DATABASE_URL`, `TRUST_PROXY`...). Y cada variable se **valida al
  arrancar** (`config/env.schema.ts`): si falta una, el proceso no arranca y
  dice cuál, en vez de fallar tres pantallas después.
- **Los logs son un flujo, no un archivo.** La aplicación escribe a la salida
  estándar y la plataforma los junta. En Vercel el disco de la función se
  borra: un archivo de log ahí se perdería.
- **Los procesos son descartables.** Una función de Vercel puede morir entre
  dos pedidos. Nada importante puede vivir solo en memoria (por eso el
  limitador de intentos del login no alcanza solo, y hace falta el firewall).

---

## 2. Logs que sirven

Un log útil responde "¿qué le pasó a ESTE pedido?". Por eso:

- **Una línea JSON por evento** (pino). `{"level":50,"req":{"id":"5196…"},"msg":"error no manejado"}`
  se puede filtrar por campo; `[api] algo falló` no.
- **Un id por pedido** (`X-Request-Id`), en la respuesta y en todas las líneas
  de log de ese pedido. Cuando el usuario ve "avisá con este código:
  5196a08a", ese código encuentra todo en los logs.
- **Lo que nunca va a un log**: la cookie de sesión (quien la ve, entra como
  esa persona), contraseñas, tokens. Se ocultan con `redact`.
- **Ruido no**: una línea por pedido, con método, URL, status y duración. Sin
  las cabeceras completas.

Y la regla de los errores, que ahora tiene test: **el usuario recibe un
mensaje genérico con el código; el detalle completo (mensaje, pila, SQL) va
solo al log.** Un mensaje de error con `relation "usuario" does not exist` le
dice a un atacante cómo se llaman tus tablas.

---

## 3. Las cabeceras de seguridad

Son instrucciones que el servidor le da al navegador. Las más importantes:

| Cabecera                              | Qué evita                                                                                                    |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `Strict-Transport-Security`           | que alguien en el wifi del bar te baje a HTTP sin cifrar                                                     |
| `Content-Security-Policy`             | que un script inyectado (XSS) corra: solo se ejecuta el JavaScript que viene de tu propio sitio, en archivos |
| `X-Frame-Options` / `frame-ancestors` | que otro sitio te meta en un `<iframe>` invisible y te haga hacer clic (clickjacking)                        |
| `X-Content-Type-Options: nosniff`     | que el navegador "adivine" que un JSON es un script                                                          |

Las de la API las pone **helmet**; las del front, **Vercel** (`vercel.json`).

La CSP encontró algo enseguida: el script que evita el parpadeo del tema
estaba escrito adentro del `index.html`, y la CSP prohíbe los scripts en
línea (es exactamente la forma de un XSS). Pasó a un archivo
(`public/tema-inicial.js`). Y para no enterarnos en producción, **Playwright
corre contra el build de producción con las mismas cabeceras** (`vite.config`
las lee de `vercel.json`): si algo choca con la CSP, la prueba falla.

---

## 4. ⭐ Backup y restauración: el simulacro encontró el bug

> Un backup que nunca se restauró no es un backup.

Los scripts (`pnpm db:backup` y `pnpm db:restaurar`) se escribieron, se
corrieron… y **la primera restauración falló en la primera línea**:

```
pg_restore: error: could not execute query: ERROR:  schema "public" already exists
```

El backup se hace solo del esquema `public` (en Supabase hay otros que son de
la plataforma), y un backup así trae su propio `CREATE SCHEMA public`. Pero
toda base nueva ya viene con un `public` vacío. Con `--exit-on-error`, el
restore paraba ahí.

Si este backup se hubiera configurado y nunca probado, el día del desastre
habríamos descubierto que **no se podía restaurar**. Arreglado (en la base
recién creada, que está vacía, se borra el esquema antes de restaurar) y
comprobado:

- las **25 tablas idénticas fila por fila** contra la original;
- los mismos 41 `CHECK`, 85 índices y 62 claves foráneas;
- la vista del stock;
- la API levantada contra la base restaurada: el login entra y el stock está.

Otras dos decisiones del backup:

- **`--exit-on-error`**: un restore "a medias" que siguió de largo es el peor
  resultado posible, porque parece que anduvo.
- **El script verifica que el archivo tenga tablas** (`pg_restore --list`):
  un backup vacío da una falsa tranquilidad.

Y la **retención** (7 diarios + 4 semanales): no alcanza con el de ayer. Si un
error se metió hace 5 días y nadie lo vio, el backup de ayer ya lo tiene.

---

## 5. ⭐ La puerta trasera de Supabase (y RLS)

Supabase publica **automáticamente** todas las tablas del esquema `public` por
una API REST, para un rol llamado `anon`, cuya clave se considera **pública**
(está pensada para ir en el JavaScript de una página). Nosotros no usamos esa
API. Pero si las tablas quedaban así, cualquiera con esa clave podía leer y
escribir la base **salteándose toda nuestra API**: los permisos, el
aislamiento entre empresas, el motor de stock. Diez fases de reglas,
esquivadas con un `curl`.

La defensa va en capas:

1. **RLS (Row Level Security) en todas las tablas, sin políticas.** RLS hace
   que cada fila pida permiso para verse. Sin políticas, nadie ve nada…
   **salvo el dueño de la tabla**, que no está sujeto a RLS. Nuestra API se
   conecta como el dueño, así que no le cambia nada.
2. **La vista en `security_invoker`.** Una vista, por defecto, consulta con
   los permisos de quien la creó: sería un agujero que se saltea el RLS.
3. **Sacarles todos los permisos a `anon` y `authenticated`.**
4. **Apagar la Data API** en el panel (está en la guía).

Y el test que lo protege a futuro **simula ser Supabase**: crea un rol que no
es dueño, le da permiso de lectura a todo (el peor caso) y verifica que ve
**cero filas**. Comprobado al revés: sin el RLS, ese rol veía las 2 empresas y
los 5 usuarios.

---

## 6. El CI: "en mi máquina anda" no es una prueba

El CI (GitHub Actions) corre todo en una máquina **limpia** en cada push. El
primer push ya encontró algo: las pruebas de Playwright levantan la API y el
front **en paralelo**, y la API necesita el paquete compartido compilado
(`dist/`). En mi máquina siempre existía de antes; en una máquina limpia, la
API arrancaba antes de que se compilara. Se compila una vez, antes.

Y el CI usa **Postgres 17** (la versión de Supabase), mientras que en
desarrollo usamos la 18: cada push verifica que las migraciones y todos los
tests funcionan en la versión de producción.

---

## 7. Serverless y la base: el pooler

En Vercel no hay un servidor: hay **funciones** que se levantan cuando llega un
pedido. Cada una abre su conexión a la base, y puede haber decenas a la vez.
Postgres tiene un límite de conexiones; con `max: 10` por función se agota
enseguida. Por eso:

- `DB_POOL_MAX=1`: una conexión por función;
- la conexión pasa por el **pooler** de Supabase en modo _transaction_, que
  presta una conexión real solo mientras dura una transacción;
- las **migraciones** usan el modo _session_ (`DIRECT_URL`): necesitan la
  conexión entera para ellas.

Y las migraciones se aplican en el build de Vercel **solo en producción**:
Vercel construye también una "preview" por cada rama, y una preview nunca
puede tocar la base real.

---

## 8. Volumen: los índices de la Fase 6 alcanzaron

Con 3 años simulados (75.000 movimientos de la panadería y 500.000 de otra
empresa en la misma tabla), las cuatro consultas que más se usan entran por
índice:

| Consulta                                        | Tiempo |
| ----------------------------------------------- | ------ |
| Stock de una sucursal (suma 37.500 movimientos) | 14 ms  |
| Historial de un insumo (primera página)         | 0,1 ms |
| Saldo de un insumo (el motor, en cada carga)    | 0,8 ms |
| Recalcular el costo promedio                    | 2,2 ms |

No hizo falta ningún índice nuevo: los que se diseñaron en la Fase 6 pensando
en estas consultas alcanzan con holgura.

---

## Resumen en una línea por idea

- La configuración, en el entorno y validada al arrancar.
- Los logs, en JSON, con un id por pedido y sin secretos.
- Al usuario un mensaje genérico; al log, el detalle.
- Las cabeceras de seguridad se prueban con el build de producción.
- Un backup que nunca se restauró no es un backup (y este no se podía restaurar).
- Supabase abre una API pública sola: RLS en todo, con un test.
- El CI atrapa el "en mi máquina anda".
- En serverless, una conexión por función y por el pooler.
