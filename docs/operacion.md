# Operación del Gestor de Panadería

Una página para quien tenga que mantener el sistema funcionando. Hace falta la
laptop con este repo y el repo `infra`, y la clave SSH del servidor
desbloqueada (`ssh vps`). La primera instalación está en
`docs/deploy-vps.md`; esto es el día a día.

## Dónde está cada cosa

| Qué                              | Dónde                                                                |
| -------------------------------- | -------------------------------------------------------------------- |
| La aplicación                    | `https://panaderia-j.duckdns.org`                                    |
| El servidor                      | VPS de DigitalOcean (Toronto), `ssh vps`, compartido con la clínica  |
| La app y su base                 | `/srv/panaderia` (contenedores `panaderia-api-1` y `panaderia-db-1`) |
| Los datos                        | volumen de Docker `panaderia_panaderia_pgdata` (**no borrar**)       |
| Backups previos a cada deploy    | `/srv/backups/panaderia/`                                            |
| Claves (base, dueño, id empresa) | gestor de contraseñas de Jesús                                       |
| **A quién llamar si se cae**     | _nombre y teléfono_                                                  |

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

## Hacer una copia de la base a la laptop

Igual que con la clínica: el dump sale por SSH y se **cifra al vuelo** con
`age` en la laptop (el archivo sin cifrar nunca toca un disco). Usa la misma
clave pública que la clínica (`~/.config/age/clinica-backups.pub`).

```bash
set -o pipefail; mkdir -p -m 700 ~/backups/panaderia
f=~/backups/panaderia/panaderia-$(date -u +%Y%m%dT%H%M%SZ).dump.age
ssh vps 'cd /srv/panaderia && sudo docker compose exec -T db sh -c "pg_dump -U \"\$POSTGRES_USER\" -Fc \"\$POSTGRES_DB\""' \
  | age -R ~/.config/age/clinica-backups.pub > "$f.part" && mv "$f.part" "$f" && chmod 600 "$f"
```

## Restaurar un backup

**Un backup que nunca se restauró no es un backup.** Probarlo en la laptop una
vez por mes, nunca contra el servidor:

```bash
age -d -i <archivo-con-la-clave-privada> panaderia-….dump.age > panaderia.dump
pnpm db:up
pnpm db:restaurar panaderia.dump panaderia_restaurada
```

Crea la base `panaderia_restaurada` (nunca pisa una existente), restaura y
muestra las filas de cada tabla. Después borrá `panaderia.dump`.

**Para recuperar producción** (se rompió la base): **siempre con un backup
nuevo antes**, porque reemplaza los datos. Con la app parada:

```bash
ssh vps 'cd /srv/panaderia && sudo docker compose stop api'
# copiar el .dump al servidor (scp) y:
ssh vps 'cd /srv/panaderia && sudo docker compose exec -T db sh -c \
  "pg_restore -U \"\$POSTGRES_USER\" -d \"\$POSTGRES_DB\" --clean --if-exists --no-owner --exit-on-error" < /tmp/el-backup.dump'
ssh vps 'cd /srv/panaderia && sudo docker compose start api'
```

Se pierde todo lo cargado después de ese backup. _(Este camino todavía no se probó contra el servidor:
ensayarlo primero con la copia de la laptop.)_

## Lo que NO hay que hacer nunca

- `docker compose down -v` en `/srv/panaderia`: el `-v` **borra la base**.
- Borrar el volumen `panaderia_panaderia_pgdata` o los `antes-*.dump`.
- Correr `prisma migrate dev` o `prisma migrate reset` contra el servidor
  (`reset` borra todo). En el servidor solo `migrate deploy`, y lo corre
  `actualizar.sh`.
- Editar una migración que ya se aplicó en el servidor.
- Publicar puertos (`ports:`) en el `compose.yaml`: Docker se saltea el
  firewall. Solo Caddy publica el 80 y el 443.
- Subir al repositorio un `.env`, un backup o un archivo con contraseñas.
