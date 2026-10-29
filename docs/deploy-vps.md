# Desplegar en el VPS, paso a paso

La panadería corre en el mismo VPS de DigitalOcean que la clínica, con el mismo
circuito: Docker, Caddy adelante y una base propia. La configuración del
servidor (qué hay instalado, cómo está protegido, cómo se despliega la clínica)
está en el repo **`infra`** (`PLAN.md`). Esta guía cubre solo lo de la panadería.

```
Internet ─► Caddy (HTTPS, cabeceras de seguridad)  panaderia-j.duckdns.org
              │  red "web"
              ▼
         panaderia-api  (Express: /api/* y también las pantallas)
              │  red "interna" (sin salida a internet)
              ▼
         panaderia-db   (PostgreSQL 18.6, volumen panaderia_pgdata)
```

- **Una sola imagen** (`panaderia-api:AAAA-MM-DD-commit`) trae la API y las
  pantallas ya compiladas: la web y la API de una versión siempre viajan
  juntas, y volver atrás es cambiar una etiqueta.
- La imagen se arma **en la laptop** desde el commit que está en GitHub y viaja
  por SSH. No hay registro de imágenes.
- Los secretos se generan **en el servidor** y nunca pasan por el repo.

| Archivo                                         | Dónde vive                          |
| ----------------------------------------------- | ----------------------------------- |
| `Dockerfile`, `scripts/deploy.sh`               | este repo                           |
| `servidor/panaderia/compose.yaml`               | repo `infra` → `/srv/panaderia/`    |
| `servidor/panaderia/actualizar.sh`              | repo `infra` → `/srv/panaderia/`    |
| `servidor/caddy/Caddyfile` (bloque `panaderia`) | repo `infra` → `/srv/caddy/`        |
| `db.env`, `app.env` (secretos)                  | solo en `/srv/panaderia/`, root 600 |

> Todos los comandos con `ssh vps` necesitan la clave SSH desbloqueada en el
> agente (vence sola a las 4 h).

---

## 1. El subdominio (una sola vez)

En [duckdns.org](https://www.duckdns.org), con la cuenta de la clínica: crear
**`panaderia-j`** apuntando a **`138.197.171.198`**.

**Verificá** desde la laptop:

```bash
getent hosts panaderia-j.duckdns.org     # tiene que decir 138.197.171.198
```

## 2. Preparar `/srv/panaderia` (una sola vez)

Desde la laptop, en el repo `infra`:

```bash
scp servidor/panaderia/compose.yaml servidor/panaderia/actualizar.sh vps:/tmp/
ssh vps 'sudo install -m 644 /tmp/compose.yaml /srv/panaderia/compose.yaml \
      && sudo install -m 755 /tmp/actualizar.sh /srv/panaderia/actualizar.sh \
      && rm /tmp/compose.yaml /tmp/actualizar.sh'
```

Los secretos, **generados en el servidor** y sin mostrarlos en pantalla. Es
una sola contraseña (la de la base), que va en dos archivos: el de la base y
la cadena de conexión de la API. Va en hexadecimal para que no tenga
caracteres que haya que escapar en la URL.

```bash
ssh vps 'sudo sh -c "umask 077; P=\$(openssl rand -hex 32);
  printf \"POSTGRES_PASSWORD=%s\n\" \"\$P\" > /srv/panaderia/db.env;
  printf \"DATABASE_URL=postgresql://panaderia:%s@db:5432/panaderia\n\" \"\$P\" > /srv/panaderia/app.env"'
ssh vps 'sudo ls -l /srv/panaderia'      # db.env y app.env: -rw------- root root
```

Copiá la contraseña a tu gestor de contraseñas leyéndola en **tu** terminal:
`ssh vps 'sudo cat /srv/panaderia/db.env'`.

## 3. Primer deploy

Desde la laptop, en este repo, con todo commiteado y subido a GitHub:

```bash
pnpm run deploy:vps
```

Hace todo lo de `scripts/deploy.sh`: arma la imagen, la manda y corre
`actualizar.sh`, que la primera vez crea la base, aplica las 10 migraciones y
levanta la API. Termina con `Activa: panaderia-api:<etiqueta>`.

**Verificá** (todavía sin Caddy, desde adentro del servidor):

```bash
ssh vps 'cd /srv/panaderia && sudo docker compose ps'
# api y db: "Up ... (healthy)", y ninguno con puertos publicados
```

## 4. Caddy: el HTTPS (una sola vez)

En el repo `infra`, el `Caddyfile` ya tiene el bloque de
`panaderia-j.duckdns.org`. Copiarlo y **recargar** (no reiniciar: `reload`
no corta la clínica):

```bash
ssh vps 'cp /srv/caddy/Caddyfile /srv/caddy/Caddyfile.antes-panaderia'
scp servidor/caddy/Caddyfile vps:/srv/caddy/Caddyfile
ssh vps 'cd /srv/caddy && sudo docker compose exec -w /etc/caddy caddy caddy reload'
```

Caddy saca el certificado de Let's Encrypt solo (unos segundos).

**Verificá:**

```bash
curl -s https://panaderia-j.duckdns.org/api/health     # "api":"ok" y "db":"ok"
curl -sI http://panaderia-j.duckdns.org | head -1      # 308: redirige a HTTPS
curl -s https://consultorios-j.duckdns.org/salud       # la clínica sigue bien
```

Si algo falla, volver atrás: `cp /srv/caddy/Caddyfile.antes-panaderia
/srv/caddy/Caddyfile` y el mismo `reload`.

## 5. Dar de alta la panadería (una sola vez)

La base arranca **vacía**. El alta crea la empresa, sus sucursales, el catálogo
base (unidades, motivos y categorías) y el usuario del dueño. Los insumos y
los proveedores los carga el dueño desde las pantallas.

1. En la laptop, copiá `docs/ejemplos/empresa.json` **fuera del repo** y
   completalo con los datos reales (nombre, CUIT, sucursales, email y nombre
   del dueño). No lleva contraseñas.
2. Mandalo al servidor y corré el alta. La contraseña inicial del dueño se
   escribe sin que se vea, y no queda en el historial:

```bash
scp ~/empresa.json vps:/tmp/empresa.json
ssh -t vps
# --- ya en el servidor:
cd /srv/panaderia
read -rsp 'Contraseña inicial del dueño (8+ caracteres): ' ALTA_PASSWORD; echo; export ALTA_PASSWORD
sudo --preserve-env=ALTA_PASSWORD docker compose run -T --rm --no-deps -e ALTA_PASSWORD \
  api node dist/alta/alta-cli.js empresa /dev/stdin < /tmp/empresa.json
unset ALTA_PASSWORD; rm /tmp/empresa.json; exit
```

Imprime `[alta] empresa creada: <id>`. **Guardá ese id** en el gestor de
contraseñas: hace falta para dar de alta a los demás usuarios.

**Verificá:** entrá a `https://panaderia-j.duckdns.org` desde la tablet de la
panadería con el email del dueño. Tiene que ver **Inicio** con "Todo en orden"
y el stock vacío.

## 6. Los demás usuarios

Igual que el alta, con `docs/ejemplos/usuario.json` (el `empresaId` del paso
anterior, `rol` `ENCARGADO` o `EMPLEADO` y las sucursales por código):

```bash
scp ~/usuario.json vps:/tmp/usuario.json
ssh -t vps
cd /srv/panaderia
read -rsp 'Contraseña inicial: ' ALTA_PASSWORD; echo; export ALTA_PASSWORD
sudo --preserve-env=ALTA_PASSWORD docker compose run -T --rm --no-deps -e ALTA_PASSWORD \
  api node dist/alta/alta-cli.js usuario /dev/stdin < /tmp/usuario.json
unset ALTA_PASSWORD; rm /tmp/usuario.json; exit
```

La contraseña se le pasa a la persona por un canal privado.

---

## Desplegar una versión nueva

1. Commit y `git push` (el script se niega si hay cambios sin commitear o sin
   subir, y conviene que el CI esté en verde).
2. `pnpm run deploy:vps`. En el servidor, `actualizar.sh`:
   1. hace un **backup** de la base en
      `/srv/backups/panaderia/antes-<etiqueta>-<fecha>.dump`;
   2. corre el migrador con la imagen nueva (`dist/migraciones/migrar-cli.js`,
      lo mismo que `prisma migrate deploy` pero sin la CLI de Prisma): solo
      aplica las pendientes; si falla, la versión anterior sigue andando;
   3. activa la imagen nueva y espera a que `/api/health` responda.
3. Entrar y mirar que todo ande. Quien tenga la web abierta tiene que recargar.

Cada deploy corta la panadería unos segundos: desplegar fuera del horario de
trabajo.

## Volver atrás

Las imágenes anteriores quedan en el servidor:

```bash
ssh vps 'sudo docker images panaderia-api'                       # ver las etiquetas
ssh vps 'sudo /srv/panaderia/actualizar.sh <etiqueta-anterior>'
```

⚠️ Si la versión nueva trajo una **migración**, volver la imagen atrás no
deshace la migración. Las migraciones de este proyecto solo agregan (tablas,
columnas), así que la versión anterior suele andar igual; si no, restaurar el
backup `antes-<etiqueta>-….dump` (se pierde lo cargado después del deploy).
Ver `docs/operacion.md`.

## Backups

Tres copias, el mismo esquema pensado para la clínica:

| Copia           | Dónde                                          | Cuándo                               | Cuánto dura           |
| --------------- | ---------------------------------------------- | ------------------------------------ | --------------------- |
| Antes de deploy | `/srv/backups/panaderia/antes-*.dump`          | cada `actualizar.sh`                 | hasta borrarlo a mano |
| Local           | `/srv/backups/panaderia/automaticos/*.sql.gpg` | 9:00 y 21:00 de Buenos Aires         | 7 días                |
| Google Drive    | `gdrive:backups-vps/panaderia/`                | las mismas, **solo si hubo cambios** | 30 días               |
| Laptop          | `~/backups/panaderia/`                         | cuando quieras: `pnpm backup:bajar`  | lo que quieras        |

- Cada backup es `pg_dump | gpg --symmetric --cipher-algo AES256`: el dump
  **nunca** toca el disco sin cifrar, ni en el servidor ni en Drive.
- "Solo si hubo cambios": se compara el sha256 del dump con el del último
  subido. El log dice `sin cambios … no se sube`.
- La retención nunca borra el más nuevo: si la panadería cierra dos semanas,
  el último backup sigue ahí.
- Si algo falla, avisa healthchecks.io (y lo dice el log:
  `/var/log/backup-panaderia.log`).
- Los archivos están en el repo `infra`, `servidor/backups/`.

### Instalar los backups (una sola vez)

**En la laptop (vos):**

1. Instalar rclone: `sudo pacman -S rclone`.
2. Autorizar Google Drive con la cuenta donde van a vivir los backups:
   `rclone config` → `n` (nuevo) → nombre **`gdrive`** → tipo `drive` →
   `client_id` y `client_secret` vacíos → scope **`drive.file`** (rclone solo
   ve lo que él mismo sube: no puede leer ni borrar el resto de tu Drive) →
   el resto por defecto → se abre el navegador, aceptás → `y` → `q`.
   Comprobar: `rclone lsd gdrive:`.
3. En [healthchecks.io](https://healthchecks.io), crear un chequeo
   "backup panadería": **Cron** `0 9,21 * * *`, zona
   `America/Argentina/Buenos_Aires`, gracia **1 hora**. Copiar su URL de ping
   (`https://hc-ping.com/…`).

**En el servidor (con aprobación, paso por paso):**

```bash
# 4. rclone (gpg ya viene con Ubuntu)
ssh vps 'sudo apt-get install -y rclone && rclone version | head -1'

# 5. La clave de cifrado: generada EN el servidor, sin mostrarla
ssh vps 'sudo install -d -m 700 /root/.config/backup /root/.config/rclone /etc/backup \
  && sudo sh -c "umask 077; openssl rand -base64 32 > /root/.config/backup/pass.txt"'
#    Copiala al gestor de contraseñas leyéndola en TU terminal (sin ella, los
#    backups no se abren nunca más):
ssh vps 'sudo cat /root/.config/backup/pass.txt'

# 6. La autorización de Drive (el rclone.conf de la laptop)
scp ~/.config/rclone/rclone.conf vps:/tmp/rclone.conf
ssh vps 'sudo install -m 600 /tmp/rclone.conf /root/.config/rclone/rclone.conf && rm /tmp/rclone.conf'

# 7. El script, el timer y el logrotate (desde el repo infra)
scp servidor/backups/{backup-proyecto.sh,backup@.service,backup@.timer,logrotate-backups,backup.env.ejemplo} vps:/tmp/
ssh vps 'sudo install -m 755 /tmp/backup-proyecto.sh /usr/local/sbin/backup-proyecto \
  && sudo install -m 644 /tmp/backup@.service /tmp/backup@.timer /etc/systemd/system/ \
  && sudo install -m 644 /tmp/logrotate-backups /etc/logrotate.d/backups \
  && sudo install -m 600 /tmp/backup.env.ejemplo /etc/backup/panaderia.env \
  && rm /tmp/backup-proyecto.sh /tmp/backup@.* /tmp/logrotate-backups /tmp/backup.env.ejemplo'

# 8. Poner la URL de healthchecks en /etc/backup/panaderia.env (HC_URL=...)
ssh -t vps 'sudo nano /etc/backup/panaderia.env'

# 9. Probar a mano, mirar el log y Drive, y recién ahí activar el timer
ssh vps 'sudo systemctl daemon-reload && sudo systemctl start backup@panaderia.service \
  && sudo tail -n 3 /var/log/backup-panaderia.log'
rclone ls gdrive:backups-vps/panaderia
ssh vps 'sudo systemctl enable --now backup@panaderia.timer && systemctl list-timers "backup@*"'
```

10. **Restauración de prueba** desde la laptop (obligatoria antes de dar esto
    por terminado): `pnpm backup:bajar` y
    `pnpm db:restaurar ~/backups/panaderia/<archivo>.sql.gpg panaderia_restaurada`
    (pide la clave del paso 5). Comparar las filas con las del servidor.

## Lo que se probó antes de desplegar

En la laptop, con los mismos `compose.yaml`, `actualizar.sh` y scripts de
backup del repo `infra` (y un proyecto de Docker con otro nombre, para no
chocar con el de desarrollo):

- la primera activación (base nueva, el migrador aplica las 10 migraciones,
  API sana) y una segunda (backup previo con las 25 tablas, "nada pendiente");
- el alta con los datos reales (Panadería Morinigo, Catán Central y
  Laferrere, Marcelo como dueño) dentro de la imagen, y la semilla
  **ausente** de la imagen;
- detrás de un Caddy con el mismo bloque de cabeceras: cada cabecera una sola
  vez, HSTS de 1 día, CSP de la app; `/stock` devuelve la web, `/api/xx` y
  `/assets/xx` inexistentes dan 404; assets con caché de un año e
  `index.html` sin caché;
- un navegador entrando con el dueño recién creado y recorriendo Inicio,
  Stock, Compras, Insumos y Reposición: sin errores de consola ni de CSP;
- memoria en reposo: API 73 MB y base 34 MB (límites de 256 MB cada una);
- la imagen pasó de 715 a **306 MB** (sin la CLI de Prisma: nota 20);
- **backups**, con un Drive de mentira (rclone contra una carpeta) y un
  receptor de pings: primera corrida sube (25 tablas verificadas), la segunda
  dice "sin cambios" (el dump sale idéntico), un login cambia la base y sube
  otro; la retención borra lo viejo y **nunca** el más nuevo; con la base
  caída falla, avisa `/fail` y no deja nada a medias;
- **restauración real**: el último `.sql.gpg` con `pnpm db:restaurar` en una
  base nueva → las 25 tablas idénticas fila por fila (md5) a la original; y
  el procedimiento de recuperar producción (`docs/operacion.md`) contra la
  base simulada: idéntica, con el orden en español (ICU) y el login andando.

Lo que **no** se pudo probar desde acá: el certificado de Let's Encrypt, la
tablet de la panadería, el servidor de verdad, Google Drive de verdad (OAuth),
healthchecks.io de verdad y `pnpm backup:bajar` (necesita el servidor).
