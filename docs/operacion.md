# Operación del Gestor de Panadería

Una página para quien tenga que mantener el sistema funcionando. Hace falta la
laptop con este repo y el repo `infra`, y la clave SSH del servidor
desbloqueada (`ssh vps`). La primera instalación está en
`docs/deploy-vps.md`; esto es el día a día.

## Dónde está cada cosa

| Qué                           | Dónde                                                                |
| ----------------------------- | -------------------------------------------------------------------- |
| La aplicación                 | `https://panaderia-j.duckdns.org`                                    |
| El servidor                   | VPS de DigitalOcean (Toronto), `ssh vps`, compartido con la clínica  |
| La app y su base              | `/srv/panaderia` (contenedores `panaderia-api-1` y `panaderia-db-1`) |
| Los datos                     | volumen de Docker `panaderia_panaderia_pgdata` (**no borrar**)       |
| Backups                       | `/srv/backups/panaderia/` y Google Drive (`backups-vps/panaderia`)   |
| Claves (base, backups, dueño) | gestor de contraseñas de Jesús                                       |
| **A quién llamar si se cae**  | _nombre y teléfono_                                                  |

## Verificar que todo anda

1. `https://panaderia-j.duckdns.org/api/health` → `"api":"ok"` y `"db":"ok"`.
2. Entrar con un usuario y abrir **Stock**.
3. `ssh vps 'cd /srv/panaderia && sudo docker compose ps'` → los dos
   `(healthy)`.

## Si un usuario ve "Ocurrió un error inesperado"

La pantalla muestra un código (por ejemplo `5196a08a`). Buscarlo en los logs:

```bash
ssh vps 'cd /srv/panaderia && sudo docker compose logs --since 24h api | grep 5196a08a'
```

Aparece el pedido con el error completo. Mandar esa línea a quien mantiene el
código.

## Si la app no responde

```bash
ssh vps 'cd /srv/panaderia && sudo docker compose ps'           # ¿qué está caído?
ssh vps 'cd /srv/panaderia && sudo docker compose logs --tail 50 api'
ssh vps 'cd /srv/panaderia && sudo docker compose restart api'   # reiniciar solo la app
```

Los contenedores vuelven solos si el servidor se reinicia (`restart:
unless-stopped`). Los parches de seguridad reinician el servidor a las 04:00
de Argentina cuando hace falta.

## Crear un usuario

Ver el paso 6 de `docs/deploy-vps.md`: se completa `docs/ejemplos/usuario.json`
**fuera del repo** y se corre el alta en el servidor. La contraseña inicial
se escribe sin que se vea y se le pasa a la persona por un canal privado.

## Desplegar una versión nueva y volver atrás

`pnpm run deploy:vps` (con todo commiteado y subido). Hace un backup antes de
tocar nada. Para volver atrás:
`ssh vps 'sudo /srv/panaderia/actualizar.sh <etiqueta-anterior>'`. El detalle,
en `docs/deploy-vps.md`.

## Los backups

Automáticos a las 9:00 y a las 21:00 de Buenos Aires: cifrados, en el servidor
(7 días) y en Google Drive (30 días, solo si hubo cambios). Cómo están
armados: `docs/deploy-vps.md`, sección Backups.

```bash
ssh vps 'sudo tail -n 6 /var/log/backup-panaderia.log'   # las últimas corridas
ssh vps 'systemctl list-timers "backup@*"'               # cuándo es la próxima
ssh vps 'sudo systemctl start backup@panaderia'          # uno ahora
```

Si healthchecks.io avisa que falló: mirar el log. Los motivos más probables
son la base caída (`docker compose ps`) o la autorización de Drive vencida
(rehacer `rclone config reconnect gdrive:` en la laptop y copiar otra vez el
`rclone.conf`, paso 6 de `deploy-vps.md`).

**Bajar uno a la laptop** cuando quieras (hace uno nuevo y lo baja, cifrado):

```bash
pnpm backup:bajar             # o: pnpm backup:bajar --ultimo (el último que ya está)
```

Queda en `~/backups/panaderia/` (carpeta 700, archivo 600), verificado con
sha256 contra el del servidor.

## Restaurar un backup

**Un backup que nunca se restauró no es un backup.** Probarlo en la laptop una
vez por mes, nunca contra el servidor:

```bash
pnpm db:up
pnpm db:restaurar ~/backups/panaderia/panaderia-<fecha>.sql.gpg panaderia_restaurada
```

Pide la clave de los backups (la del gestor de contraseñas), crea la base
`panaderia_restaurada` (nunca pisa una existente: se niega), descifra al vuelo
y muestra las filas de cada tabla. Solo puede restaurar en el Postgres local
de desarrollo: no recibe ninguna dirección de base.

**Para recuperar producción** (se rompió la base). **Reemplaza todos los
datos**: con aprobación, fuera del horario de la panadería y con un backup
nuevo antes. Se pierde lo cargado después del backup que se restaura.

```bash
ssh -t vps
cd /srv/panaderia
sudo systemctl start backup@panaderia      # una foto de cómo está ahora, por las dudas
B=/srv/backups/panaderia/automaticos/panaderia-<fecha>.sql.gpg   # el que se restaura
sudo docker compose stop api
sudo docker compose exec -T db sh -c 'dropdb -U "$POSTGRES_USER" --force "$POSTGRES_DB" && createdb -U "$POSTGRES_USER" "$POSTGRES_DB"'
sudo gpg --batch --quiet --pinentry-mode loopback --passphrase-file /root/.config/backup/pass.txt --decrypt "$B" \
  | sudo docker compose exec -T db sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -v ON_ERROR_STOP=1 --single-transaction --quiet' >/dev/null
sudo docker compose start api
```

_(Ensayado en la laptop contra una copia del servidor: la base quedó idéntica
al backup, tabla por tabla, y el login anduvo.)_

## Lo que NO hay que hacer nunca

- `docker compose down -v` en `/srv/panaderia`: el `-v` **borra la base**.
- Borrar el volumen `panaderia_panaderia_pgdata`, los `antes-*.dump` o
  `/root/.config/backup/pass.txt` (sin esa clave, ningún backup se abre).
- Correr `prisma migrate dev` o `prisma migrate reset` contra el servidor
  (`reset` borra todo). En el servidor las migraciones las aplica
  `actualizar.sh`, con el migrador de la imagen (que nunca borra nada).
- Editar una migración que ya se aplicó en el servidor.
- Publicar puertos (`ports:`) en el `compose.yaml`: Docker se saltea el
  firewall. Solo Caddy publica el 80 y el 443.
- Subir al repositorio un `.env`, un backup o un archivo con contraseñas.
