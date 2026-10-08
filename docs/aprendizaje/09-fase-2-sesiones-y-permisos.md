# Fase 2: sesiones, permisos y aislamiento

_Escrita después de hacer la Fase 2. Es la nota más importante del proyecto en
materia de seguridad: acá están los conceptos que, si quedan flojos, no se
arreglan después con un parche._

---

## 1. El problema de fondo: HTTP no se acuerda de nada

Cada pedido HTTP es independiente. El servidor atiende `GET /api/usuarios` y no
tiene la menor idea de quién lo mandó: no hay nada en el protocolo que relacione
ese pedido con el login de hace cinco minutos.

Entonces, en cada pedido, el navegador tiene que **demostrar** quién es. La
pregunta de diseño es: ¿con qué, y dónde se guarda ese algo?

---

## 2. Cookie `httpOnly` vs token en `localStorage`

La opción que muestran casi todos los tutoriales: el login devuelve un token, el
front lo guarda en `localStorage` y lo manda en un header `Authorization`.

Funciona. Y tiene un agujero: **cualquier JavaScript que corra en tu página
puede leer `localStorage`**. Si alguien logra inyectar un script —un ataque
**XSS** (_Cross-Site Scripting_), por ejemplo a través de un campo de texto que
se renderiza sin escapar— se lleva el token y es ese usuario hasta que el token
venza.

Lo que elegimos: el token va en una cookie con el atributo `httpOnly`.

```ts
res.cookie('panaderia_sesion', token, {
  httpOnly: true, // el JavaScript de la página NO puede leerla
  sameSite: 'lax',
  secure: env.NODE_ENV === 'production',
  path: '/',
  expires: expiraAt,
});
```

Con `httpOnly`, `document.cookie` **no muestra la cookie**. El navegador la
guarda y la adjunta solo él, en cada pedido al mismo sitio. Un XSS todavía puede
hacer daño (puede pedir cosas en tu nombre mientras estás en la página), pero no
se puede llevar la sesión para usarla más tarde desde otra máquina.

Hay un test que lo verifica de verdad:

```ts
expect(cookie).toMatch(/HttpOnly/i);
```

Consecuencia que conviene entender: **el frontend no sabe si estás logueado**.
No puede: no ve la cookie. Por eso `useSesion()` se lo **pregunta** al servidor
(`GET /api/auth/me`). Eso es una ventaja, no una limitación: la única fuente de
verdad sobre tu sesión es el servidor.

---

## 3. `SameSite` y los ataques CSRF

Que el navegador mande la cookie solo trae un problema nuevo. Imaginá que estás
logueado en el sistema de la panadería y abrís otra pestaña con una página
cualquiera. Esa página tiene escondido:

```html
<form action="https://tu-panaderia.com/api/usuarios" method="POST"></form>
```

y lo envía sola. El navegador **adjunta tu cookie** porque va a tu dominio, y la
API ejecuta la acción creyendo que fuiste vos. Eso es **CSRF** (_Cross-Site
Request Forgery_).

La defensa que usamos es el atributo `sameSite: 'lax'`: el navegador manda la
cookie cuando navegás normalmente a nuestro sitio, pero **no** la manda en un
POST que venga de otro dominio. El ataque de arriba llega sin cookie y la API
responde 401.

Para una aplicación como esta —front y API en el mismo dominio, sin formularios
que deban aceptar envíos de terceros— `SameSite=Lax` alcanza. Si en el futuro
hiciera falta más (por ejemplo, un subdominio aparte), el paso siguiente es un
**token CSRF**: un valor que el front tiene que repetir en un header, que una
página ajena no puede leer. Queda anotado, no implementado.

---

## 4. Sesión en una tabla, no un JWT

Un **JWT** (_JSON Web Token_) es un token firmado que lleva los datos adentro:
el servidor verifica la firma y no necesita consultar nada. Es rápido y es lo
que casi todo el mundo usa.

Tiene una propiedad incómoda: **no se puede cancelar**. Es válido hasta que
vence. Si echás a un empleado y su token dura 7 días, su token funciona 7 días.
Las soluciones habituales (tokens muy cortos + refresh tokens, o una lista negra
de tokens revocados) terminan necesitando... una tabla en la base.

Nosotros fuimos directo a la tabla:

```
sesion
  id, usuario_id, token_hash, expira_at, revocada_at, ultimo_uso_at, ip, user_agent
```

Lo que se gana: el logout **de verdad** mata la sesión, se puede cerrar sesión en
todos los dispositivos, y queda registro de desde dónde entró cada uno. Lo que
se paga: una consulta a la base por pedido. Para una panadería con seis usuarios
eso es gratis.

El test que importa no es "el logout devuelve 204", es este:

```ts
const token = api.cookie(COOKIE);
await api.post('/api/auth/logout');
api.ponerCookie(COOKIE, token); // reusamos el token a mano
expect((await api.get('/api/auth/me')).status).toBe(401);
```

Es decir: comprobar que el token está muerto **en el servidor**, no solo borrado
del navegador. Si solo se borrara la cookie, alguien que la copió antes seguiría
entrando.

### Sesión "deslizante"

La sesión dura 7 días, pero se **renueva al usarse**: si queda menos de la mitad
del tiempo, al próximo pedido se extiende. Así no se le corta la sesión al
encargado en medio de un conteo de inventario. Y para no escribir en la base en
cada pedido, el "último uso" se actualiza como máximo cada 5 minutos.

---

## 5. Dos hashes distintos, porque son dos problemas distintos

Esto confunde al principio. En el proyecto hay dos hashes:

| Qué             | Con qué                    | Por qué                                                                                                                                                                   |
| --------------- | -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Contraseña      | **scrypt**, ~130 ms        | La eligió una persona: tiene poca entropía y se puede adivinar probando. El hash tiene que ser **lento** para que probar salga carísimo.                                  |
| Token de sesión | **SHA-256**, microsegundos | Son 32 bytes **aleatorios**. No hay nada que adivinar: probar por fuerza bruta 2²⁵⁶ opciones no es una estrategia. Un hash lento solo agregaría 130 ms a **cada** pedido. |

La regla general: **el hash lento se usa cuando el secreto lo eligió un humano.**
Cuando el secreto lo generó un generador aleatorio con suficientes bits, un hash
rápido es lo correcto.

(¿Y para qué hashear el token, si es aleatorio? Para que, si alguien consigue
leer la tabla `sesion`, no pueda hacerse pasar por nadie. Mismo razonamiento que
con las contraseñas.)

---

## 6. Lo que el sistema NO dice

Dos mensajes de error que parecen un detalle y no lo son.

**No decimos si el email existe.** El login responde exactamente lo mismo para
"ese email no existe" y para "la contraseña está mal":

```
401  CREDENCIALES_INVALIDAS  "Email o contraseña incorrectos."
```

Si fueran distintos, cualquiera podría usar el login como un buscador de emails
registrados. Y hay un test que compara las dos respuestas campo por campo:

```ts
expect(cuerpoError(noExiste)).toEqual(cuerpoError(malPassword));
```

**Y tampoco lo decimos con el tiempo.** Acá está lo interesante. Si el email no
existe y respondiéramos de inmediato, el login tardaría 2 ms; con un email real
tardaría 130 ms, porque verifica la contraseña con scrypt. Midiendo ese tiempo se
puede averiguar qué emails están registrados, aunque el mensaje sea idéntico. Eso
se llama **ataque de temporización** (_timing attack_).

La solución, en `service.ts`:

```ts
if (usuario && usuario.activo) {
  passwordOk = await verificarPassword(entrada.password, usuario.passwordHash);
} else {
  // Gastamos el mismo tiempo que si verificáramos, para que el tiempo de
  // respuesta no delate si el email existe.
  await gastarTiempoComoSiVerificara(entrada.password);
}
```

Es la misma familia de problema que resuelve `timingSafeEqual` al comparar
hashes (nota 08): **el tiempo que tarda un programa también es información.**

---

## 7. Limitar los intentos

Con scrypt, cada intento cuesta 130 ms: eso ya frena bastante, pero un script
igual prueba ~27.000 contraseñas por hora. Hay que cortar antes.

Escribimos un limitador de **ventana deslizante** (`lib/limitador.ts`): cuenta
los fallos de los últimos 15 minutos contados desde _ahora_. Con bloques fijos de
tiempo, alguien puede gastar el límite al final de un bloque y otra vez al
principio del siguiente, duplicando los intentos reales.

Y hay **dos** limitadores, porque frenan dos ataques distintos:

| Limitador     | Límite      | Qué frena                                                                                                                                                              |
| ------------- | ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Por **email** | 5 / 15 min  | Probar muchas contraseñas sobre **una** cuenta, aunque el atacante rote de IP                                                                                          |
| Por **IP**    | 20 / 15 min | Probar **una** contraseña común ("123456") sobre muchas cuentas: ahí cada email recibe un solo intento y el límite por email nunca salta. Se llama _password spraying_ |

Dos detalles de diseño que valen para cualquier cosa que escribas así:

- **El reloj se inyecta.** El constructor recibe una función `reloj`. Gracias a
  eso, el test de "la ventana es deslizante" corre en milisegundos en lugar de
  esperar 15 minutos de verdad. Cuando algo depende del tiempo, hacé que el
  tiempo sea un parámetro.
- **Un login exitoso borra el historial.** Si no, errarle tres veces a la
  contraseña y después acertar te dejaría con tres fallos acumulados para la
  próxima vez.

---

## 8. 401, 403 y 404: cada uno dice algo distinto

| Código                 | Significa                                | Cuándo lo usamos                                               |
| ---------------------- | ---------------------------------------- | -------------------------------------------------------------- |
| **401** No autenticado | "No sé quién sos"                        | Falta la cookie, o el token es inválido, vencido o revocado    |
| **403** Prohibido      | "Sé quién sos, y esto no te corresponde" | Un empleado pidiendo la auditoría                              |
| **404** No existe      | "Acá no hay nada"                        | Y también cuando el recurso **existe pero es de otra empresa** |

Ese último caso es el importante. Si a un recurso de otra empresa respondiéramos
`403`, le estaríamos confirmando a quien prueba UUIDs que ese recurso existe y
es de alguien. Un `404` no dice nada. **Para vos, los datos de otra empresa no
existen.**

---

## 9. El orden de los middlewares no es decorativo

```ts
usuariosRouter.post(
  '/usuarios',
  requiereAutenticacion, // 1. ¿quién sos?
  requierePermiso('usuario:crear'), // 2. ¿podés?
  postUsuario, // 3. hacerlo
);
```

Se ejecutan en ese orden y cada uno puede cortar la cadena. No se puede
preguntar "¿podés?" antes de saber quién es, y el controlador no se ejecuta si
alguno de los dos cortó. Hay un test que lo comprueba del lado que importa: tras
un 403, **la base no se tocó**.

```ts
const fila = await prisma.usuario.findUnique({ where: { email: '...' } });
expect(fila).toBeNull();
```

---

## 10. El `empresa_id` sale de la sesión. Siempre

Es la regla más importante del sistema, y la Fase 2 es donde se implementa.

El middleware de autenticación construye un **contexto** a partir de la cookie:

```
cookie → tabla sesion → usuario → usuario.empresa_id → ctx.empresaId
```

Y todo el código de ahí para adentro usa `ctx.empresaId`. **Nunca**
`req.body.empresaId` ni `req.query.empresaId`: todo lo que viene en el pedido lo
controla el cliente, y el cliente puede ser cualquiera con las herramientas del
navegador abiertas.

Esto no se verifica leyendo el código, se verifica atacándolo. En
`test/aislamiento.test.ts` nos logueamos como el dueño de una empresa e
intentamos llegar a la otra por todos los caminos que existen:

```ts
it('mandar un empresaId en el cuerpo del pedido no cambia nada', async () => {
  await entrarComo('dueno@vecina.test');
  const r = await api.post('/api/usuarios', {
    email: 'inyectado@vecina.test',
    // ...
    empresaId: laferrere.empresaId, // <- el ataque
  });
  expect(r.status).toBe(201);
  const creado = await prisma.usuario.findUniqueOrThrow({
    where: { email: 'inyectado@vecina.test' },
  });
  expect(creado.empresaId).not.toBe(laferrere.empresaId); // se ignoró
});
```

Dos capas lo impiden: Zod **descarta** los campos que no están en el esquema, y
el servicio usa el `ctx.empresaId` de la sesión. Hay además un test que verifica
que ni un solo UUID de la otra empresa aparece en las respuestas:

```ts
for (const id of laferrere.usuarioIds) {
  expect(JSON.stringify(usuarios)).not.toContain(id);
}
```

**Este archivo de tests crece con cada endpoint nuevo.** Está anotado como regla
en `CLAUDE.md`: si una fase agrega un endpoint que devuelve datos, agrega su caso
de aislamiento.

---

## 11. Esconder un botón no es seguridad

La matriz de permisos vive en `packages/shared` y la usan los dos lados, pero
para cosas distintas:

- el **backend** la usa para **rechazar** → eso es la seguridad;
- el **frontend** la usa para no mostrar botones que van a dar 403 → eso es
  comodidad.

El frontend corre en la máquina del usuario. Se puede modificar, se pueden
borrar las condiciones, se puede llamar a la API con `curl`. Un control que solo
existe en el front **no existe**.

Mismo razonamiento con `RutaProtegida`: evita mostrar una pantalla vacía y llena
de errores, pero lo que protege los datos es que la API responda 401 a cada
pedido sin sesión. Y eso está probado:

```ts
for (const ruta of ['/api/usuarios', '/api/auditoria', '/api/auth/me']) {
  expect((await api.get(ruta)).status).toBe(401);
}
```

---

## 12. Cómo se testea todo esto

Los tests de esta fase son de **integración**: levantan la aplicación de verdad.
Cuatro decisiones que los hacen posibles sin ninguna dependencia nueva:

**Una base de datos aparte.** `panaderia_test` se borra y se vuelve a crear en
cada corrida. Si usaran la base de desarrollo, un test te borraría los datos con
los que estás trabajando. Y partir de cero en cada corrida es lo que hace que
los tests sean **repetibles**: no importa qué dejó la corrida anterior.

**Las migraciones se aplican ejecutando el SQL real**, leyendo los
`migration.sql` en orden, en lugar de llamar al CLI de Prisma. Así los tests
verifican, de paso, que el SQL que vamos a aplicar en producción funciona sobre
una base vacía.

**La app se levanta en el puerto 0**, que significa "elegí uno libre":

```ts
const servidor = crearApp().listen(0, '127.0.0.1');
```

Eso permite pegarle con `fetch` sin ocupar un puerto fijo y sin instalar
`supertest`. Y el test pasa por todo: middlewares, cookies, base de datos.

**Un frasco de cookies de 20 líneas.** `ClienteHttp` guarda las cookies entre
pedidos, como hace un navegador. Es lo que permite loguearse en un test y seguir
autenticado en el pedido siguiente, y lo que permite inspeccionar los atributos
de la cookie.

Un detalle que apareció al correrlos: el limitador de intentos vive **en
memoria** y lo comparten todos los tests del archivo, así que los fallos de un
test bloqueaban al siguiente. De ahí salió `reiniciarLimitadores()` en el
`beforeEach`. Cuando algo tiene estado global, los tests lo descubren enseguida.

---

## 13. La auditoría, y dos decisiones que parecen menores

```
auditoria
  id, empresa_id?, usuario_id?, entidad, entidad_id?, accion,
  datos_antes, datos_despues, ip, created_at
```

**`empresa_id` es nullable, a propósito.** Un intento de login con un email que
no existe no pertenece a ninguna empresa — y ese intento es justamente uno de
los que más interesa registrar. Si la columna fuera obligatoria, habría que
elegir entre inventar un dato o no guardar el evento.

**Las claves foráneas son `ON DELETE RESTRICT`, no `SET NULL`.** Esto lo
corregimos sobre la marcha, después de leer el SQL generado. Con `SET NULL`,
borrar un usuario dejaría todo su historial de auditoría **sin autor**: o sea,
una forma de tapar el rastro. Con `RESTRICT`, la base impide borrar a quien
tenga auditoría. En este sistema los usuarios no se borran, se desactivan
(`activo = false`), así que la restricción no molesta a nadie — salvo a quien
quiera borrar evidencia.

Y dos reglas sobre qué se guarda:

- La auditoría se escribe **en la misma transacción que el cambio que audita**.
  Si el cambio se deshace, el registro también: nunca queda constancia de algo
  que no pasó. Por eso `registrarAuditoria` recibe el cliente de Prisma como
  parámetro, y así funciona igual con el cliente normal y con el `tx` de una
  transacción.
- **El registro de un login fallido es la excepción**: se escribe fuera de toda
  transacción, porque el pedido termina en error y aun así ese registro no se
  puede perder.
- La contraseña **no se audita nunca**, ni hasheada, ni parcialmente. Hay un test
  que busca la contraseña intentada dentro del registro y exige no encontrarla.
