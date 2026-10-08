# Modo claro/oscuro y contraste: por qué "no se veía bien"

_Escrita después del pedido del cliente: "debería haber modo oscuro y claro, y
que la fuente se vea bien, mejorando la paleta". Es una nota corta pero con una
herramienta concreta que conviene tener a mano: cómo se MIDE si un color se lee._

---

## 1. El contraste no es una opinión: es una división

La accesibilidad web define el contraste entre dos colores con una fórmula, así
que "se ve mal" se puede convertir en un número y discutir con datos.

Primero se calcula la **luminancia relativa** de cada color (cuánta luz emite,
de 0 = negro a 1 = blanco), corrigiendo cada canal porque el ojo no responde de
forma lineal:

```
canal = valor / 255
lineal = canal / 12.92                     si canal ≤ 0,04045
lineal = ((canal + 0,055) / 1,055) ^ 2,4   si no

L = 0,2126·R + 0,7152·G + 0,0722·B
```

Fijate en los pesos: **el verde pesa casi 4 veces más que el rojo y 10 veces más
que el azul**, porque el ojo humano es mucho más sensible al verde. Por eso un
azul oscuro puede tener menos contraste del que parece.

Y el contraste es la relación entre las dos luminancias:

```
contraste = (L_claro + 0,05) / (L_oscuro + 0,05)
```

Da un número entre 1:1 (iguales, invisible) y 21:1 (negro sobre blanco). Los
umbrales que importan:

| Umbral    | Para qué                                                           |
| --------- | ------------------------------------------------------------------ |
| **4,5:1** | texto normal (AA). **Este es el que hay que cumplir.**             |
| 3:1       | texto grande (≥ 24 px, o ≥ 19 px en negrita) y bordes de controles |
| 7:1       | texto normal en nivel AAA                                          |

---

## 2. Qué estaba mal, medido

| Uso                                              | Antes        | Ahora    |
| ------------------------------------------------ | ------------ | -------- |
| Texto secundario (fechas, códigos, "sin precio") | **2,28:1** ✗ | 7,09:1 ✓ |
| Texto de ayuda y subtítulos                      | **4,23:1** ✗ | 7,09:1 ✓ |
| Enlaces y etiquetas de marca                     | **3,93:1** ✗ | 6,23:1 ✓ |
| Botón primario (blanco sobre el marrón de marca) | **3,93:1** ✗ | 6,23:1 ✓ |

El peor era `text-slate-400` sobre el fondo crema: **2,28:1**, menos de la mitad
de lo que hace falta. Y estaba usado en 14 lugares, justo para los datos que uno
va a buscar con la vista (la fecha de un movimiento, el código de un insumo).

**La lección**: el gris "elegante" de las maquetas es casi siempre ilegible. Un
texto secundario no se hace más suave bajándole el contraste; se hace más
pequeño, o con menos peso, o separado con espacio.

### El marrón de marca necesitaba dos tonos, no uno

`--color-corteza: #b4712c` daba 3,93:1 sobre blanco (mal) y 4,54:1 sobre el
fondo oscuro (justo). Es el problema de usar **un solo color de marca para los
dos temas**: lo que se lee sobre negro no se lee sobre blanco.

```css
--color-corteza: #8a5420; /* para fondo claro: 6,2:1 */
--color-corteza-claro: #d99a4e; /* para fondo oscuro: 7,4:1 */
```

Y en el código, cada uso lleva su par: `text-corteza dark:text-corteza-claro`.

### Un detalle que no es contraste pero se siente igual

En modo oscuro, la página era `#2b1d12` (marrón de horno) y las tarjetas
`slate-900` (`#0f172a`). Midiendo las luminancias: la página **era más clara que
las tarjetas**. O sea, las tarjetas se veían como agujeros y no como algo
apoyado encima. Bajando la página a `#14100c` se invierte y vuelve a tener
sentido.

---

## 3. Que el tema lo elija la persona

Por defecto, el prefijo `dark:` de Tailwind responde a `prefers-color-scheme`,
que es la preferencia del **sistema operativo**. Eso significa: si tu Linux está
en modo oscuro, la aplicación está en modo oscuro y no hay nada que hacer.

En Tailwind 4 se cambia con una línea de CSS:

```css
@custom-variant dark (&:where([data-tema='oscuro'], [data-tema='oscuro'] *));
```

Ahora `dark:` responde a un atributo del `<html>`. Se puede verificar en el CSS
compilado:

```css
/* antes */  @media (prefers-color-scheme: dark) { .dark\:bg-slate-900 { ... } }
/* ahora */  .dark\:bg-slate-900:where([data-tema=oscuro], [data-tema=oscuro] *) { ... }
```

El `:where()` está ahí por una razón: **no suma especificidad**. Si fuera
`[data-tema=oscuro] .dark\:bg-slate-900`, esa regla le ganaría a cualquier clase
normal y el orden de Tailwind dejaría de funcionar.

### "Automático" no es un tema, es una instrucción

La persona elige entre tres cosas, pero el `<html>` solo tiene dos valores
posibles. El proveedor resuelve `auto` consultando el sistema **en JavaScript** y
escribe siempre `claro` u `oscuro`:

```ts
const resuelto = tema === 'auto' ? (sistemaOscuro ? 'oscuro' : 'claro') : tema;
```

Esto mantiene el CSS con una sola condición. Y hay un `matchMedia(...)` con un
`addEventListener('change')`: si está en automático y cambiás el tema del
sistema operativo, la aplicación acompaña **sin recargar**.

### Las dos cosas que casi siempre se olvidan

**1. `color-scheme`.** Le dice al navegador de qué color dibujar lo que el CSS
no controla: el desplegable de un `<select>`, el calendario de un
`<input type="datetime-local">`, las barras de scroll, el autocompletado.

```css
:root[data-tema='oscuro'] {
  color-scheme: dark;
}
```

Sin esto, en modo oscuro el desplegable de una lista se abre **blanco
brillante** en medio de una pantalla negra. En este proyecto importa más que en
otros, porque usamos elementos nativos a propósito (decisión de la Fase 4).

**2. El parpadeo inicial.** El navegador pinta la página antes de que React
arranque, así que dibuja en claro y unos milisegundos después cambia todo de
golpe. Se arregla con un script **síncrono** en el `<head>`, antes de cualquier
otra cosa:

```html
<script>
  // lee localStorage, resuelve el tema y pone el atributo
</script>
```

Es el único JavaScript suelto del proyecto, y va ahí a propósito: tiene que
correr **antes de que se pinte el primer pixel**.

---

## 4. El tamaño de la letra, en una sola línea

```css
html {
  font-size: 17px;
}
```

Todo el sistema de medidas de Tailwind está en `rem`, que es relativo a esa
raíz. Así que ese cambio agranda **el texto y los espaciados a la vez**, de
forma proporcional: nada se desarma, y los destinos táctiles (`min-h-12` = 3rem)
pasan de 48 a 51 px. Para una tablet en un depósito, con las manos enharinadas,
es gratis y se nota.

Lo que **no** hay que hacer es subir el tamaño de cada texto a mano: terminás
con 40 decisiones inconsistentes en lugar de una.

---

## Resumen en cuatro líneas

1. "Se ve mal" se mide: `(L_claro + 0,05) / (L_oscuro + 0,05)`, y el umbral para
   texto normal es **4,5:1**.
2. Un color de marca necesita **dos tonos**: uno para fondo claro y otro para
   fondo oscuro.
3. El tema lo elige la persona, no el sistema operativo: `@custom-variant dark`
   - un atributo en el `<html>`, resolviendo "automático" en JavaScript.
4. No te olvides de `color-scheme` (los controles nativos) ni del script
   síncrono en el `<head>` (el parpadeo).
