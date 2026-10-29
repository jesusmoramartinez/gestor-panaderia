# Backups automáticos: cifrados, fuera del servidor y probados

_Escrita el 29/10/2026, al armar los backups del VPS (el esquema pensado para
la clínica, hecho primero para la panadería). Cinco ideas: por qué tres
copias, cifrar sin dejar rastros en el disco, "solo si cambió" y el problema
de la huella, la retención que no se come el último backup, y el bug de bash
que encontró la prueba._

---

## 1. Tres copias, tres desastres distintos

| Copia                   | Te salva de…                                                |
| ----------------------- | ----------------------------------------------------------- |
| En el servidor (7 días) | "borré algo sin querer ayer": se restaura en minutos        |
| Google Drive (30 días)  | "se perdió el servidor" (DigitalOcean, un error, un hackeo) |
| La laptop (manual)      | "perdí el acceso a todo lo de la nube"                      |

Una copia que vive en la misma máquina que los datos no es un backup contra
la pérdida de la máquina. Por eso la de Drive no es opcional.

---

## 2. ⭐ Cifrar sin dejar rastros

Drive es **un tercero**: lo que se sube ahí lo puede ver Google, o quien entre
a la cuenta. La base tiene los datos de la panadería (proveedores, precios,
usuarios con sus hashes). Entonces se cifra **antes** de subir:

```
pg_dump │ tee (copia para la huella) │ gpg --symmetric --cipher-algo AES256 > archivo.sql.gpg
```

Los `│` son **tubos**: cada programa le pasa los datos al siguiente en
memoria, de a pedazos. El dump sin cifrar **nunca se escribe en el disco**.
Si se escribiera primero y se cifrara después, quedaría en el disco aunque se
borre (borrar un archivo no borra los datos del disco, solo deja de
apuntarlos).

**Cifrado simétrico** = una sola clave para cifrar y descifrar
(`/root/.config/backup/pass.txt`). Es más simple que `age` (clave pública y
privada), con un costo aceptado: quien entre como root al servidor puede abrir
los backups. La misma clave va al gestor de contraseñas: **si se pierde, todos
los backups son basura**.

---

## 3. "Solo si cambió", y por qué la huella no daba igual

Para no llenar Drive con 60 copias idénticas por mes, se calcula una
**huella** (sha256) del dump y se compara con la del último subido. Igual
huella = mismos bytes = no hubo cambios.

El problema: el formato comprimido de `pg_dump` (`-Fc`), el que se venía
usando, **guarda adentro la hora en que se hizo**. Dos dumps de la misma base
nunca darían la misma huella. Solución: SQL plano (texto), que no tiene hora.

Y otra trampa más: desde la versión 18, `pg_dump` pone en el SQL una clave al
azar (`\restrict …`), una protección de `psql` contra dumps maliciosos. Al
azar = distinta cada vez. Se fija con `--restrict-key`.

Se verificó: dos corridas seguidas → misma huella, "sin cambios". Alguien
entra a la app (se escribe una sesión) → huella distinta → se sube.

---

## 4. La retención que no se come el último backup

La regla del pedido era "en Drive, borrar lo de más de 30 días"
(`rclone delete --min-age 30d`). Pensemos el caso borde: **nadie usa el
sistema durante un mes** (vacaciones, una sucursal cerrada).
Como no hay cambios, no se sube nada nuevo. Al día 31, "más de 30 días" son
**todos** los backups, y la regla los borra a todos.

Por eso: en el servidor, el más nuevo no se borra nunca; en Drive, solo se
poda si hay al menos uno de los últimos 30 días. Se probó con archivos de
fecha falsa (`touch -d '40 days ago'`): quedó el último, y el log dice por
qué no podó.

> Una regla de borrado se piensa siempre con el caso "no pasó nada en mucho
> tiempo". Es el caso en el que nadie está mirando.

---

## 5. ⭐ El bug que encontró la prueba: `wait $!`

La primera versión calculaba la huella así:

```bash
pg_dump | tee >(sha256sum > huella) | gpg ... > archivo
wait $!     # "esperá a que termine sha256sum"
```

`$!` es "el último proceso que se lanzó en segundo plano". Se supone que era
`sha256sum`... pero bash no lo actualiza para un `>(...)` dentro de un tubo.
`$!` seguía siendo el proceso anterior: el `tee` que copia todo al log, que
**nunca termina**. El script se quedó esperando para siempre, con el backup ya
escrito.

El arreglo: un **tubo con nombre** (FIFO, `mkfifo`), con el `sha256sum`
lanzado aparte y su número de proceso guardado a mano en ese mismo momento:

```bash
mkfifo copia
sha256sum < copia > huella &
PID_HUELLA=$!            # acá sí: es exactamente este
pg_dump | tee copia | gpg ... > archivo
wait "$PID_HUELLA"
```

Ningún análisis del código lo habría encontrado: se vio corriendo el script.

---

## 6. Un backup sin restauración probada no cuenta

Se probó la cadena entera, con un "Drive" de mentira (rclone contra una
carpeta) y un receptor de avisos local:

1. backup → `pnpm db:restaurar` en una base nueva → **huella md5 de cada
   tabla** igual a la original (las 25);
2. el procedimiento de recuperar producción (borrar y recrear la base,
   descifrar y cargar) contra una copia del servidor → idéntica, con el login
   andando;
3. con la base caída → el backup falla, avisa (`/fail`), no deja archivos a
   medias, y el último bueno sigue siendo el último bueno.

**Lo que protege contra el accidente:** el script de restaurar no recibe
ninguna dirección de base (solo restaura en el Postgres local de desarrollo)
y se niega si la base de destino ya existe. Recuperar producción no tiene
script: es un procedimiento a mano, con aprobación.

---

## Resumen en una línea por idea

- Tres copias contra tres desastres distintos.
- Se cifra antes de subir, y el dump sin cifrar nunca toca el disco.
- Para comparar huellas, el dump tiene que salir idéntico: SQL plano y clave fija.
- La retención se piensa con el caso "no pasó nada en un mes".
- `$!` no es lo que parece con `>(...)`: guardá el número de proceso a mano.
- Un backup sin restauración probada no cuenta.
