# Operación del Gestor de Panadería

Una página para quien tenga que mantener el sistema funcionando. No hace falta
saber programar para la mayoría de las tareas; sí tener acceso a las cuentas
de la tabla de abajo y una terminal con el repositorio clonado.

## Dónde está cada cosa

| Qué                                 | Dónde                                          | Quién tiene acceso |
| ----------------------------------- | ---------------------------------------------- | ------------------ |
| La aplicación (front y API)         | Vercel, proyecto `gestor-panaderia`            | _completar_        |
| La base de datos                    | Supabase, proyecto de la panadería (São Paulo) | _completar_        |
| El código y los backups automáticos | GitHub, `gestor-panaderia`                     | _completar_        |
| Las claves (base, backups, dueño)   | Gestor de contraseñas de _completar_           | _completar_        |
| **A quién llamar si se cae**        | _nombre y teléfono_                            |                    |

## Verificar que todo anda

1. Abrir `https://<dominio>/api/health` → tiene que decir `"api":"ok"` y `"db":"ok"`.
2. Entrar con un usuario y abrir **Stock**.
3. En GitHub → **Actions** → **Backup diario**: el último tiene que tener tilde
   verde y ser de hoy o de ayer.

## Si un usuario ve "Ocurrió un error inesperado"

La pantalla muestra un código (por ejemplo `5196a08a`). En **Vercel → Logs**,
buscar ese código: aparece el pedido con el error completo. Mandar esa línea
a quien mantiene el código.

## Crear un usuario

El dueño ya existe desde el alta. Para un encargado o un empleado:

1. Copiar `docs/ejemplos/usuario.json` **fuera del repo** y completarlo:
   `empresaId` (lo imprimió el alta de la empresa; también está en Supabase,
   tabla `empresa`), email, nombre, `rol` (`ENCARGADO` o `EMPLEADO`) y las
   sucursales por código (`["LAF"]`).
2. Correr, desde la raíz del repo:

```bash
ALTA_PASSWORD='contraseña inicial (8+ caracteres)' \
DATABASE_URL='<session pooler de Supabase, puerto 5432>' \
  pnpm --filter @panaderia/api alta usuario /ruta/a/usuario.json
```

3. Pasarle la contraseña a la persona por un canal privado.

## Hacer un backup a mano

**Siempre antes de desplegar una migración nueva** (un cambio en
`apps/api/prisma/migrations`), y cuando haya dudas:

```bash
DATABASE_URL='<session pooler, puerto 5432>' PG_IMAGEN=postgres:17 pnpm db:backup
```

Queda en `backups/diarios/panaderia-AAAA-MM-DD.dump`. **Esa carpeta nunca se
sube al repositorio** (está en `.gitignore`). El script se queda con los 7
diarios y los 4 semanales más nuevos.

También vale: **Actions → Backup diario → Run workflow** (queda cifrado en GitHub).

## Restaurar un backup

**Un backup que nunca se restauró no es un backup.** Probarlo una vez por mes.

1. Si viene de GitHub (un `.dump.gpg`): bajarlo de **Actions → Backup diario →
   el run → Artifacts** y descifrarlo:

```bash
gpg --decrypt panaderia.dump.gpg > panaderia.dump   # pide BACKUP_PASSPHRASE
```

2. **Para probarlo (en tu máquina):** con Docker andando (`pnpm db:up`):

```bash
pnpm db:restaurar panaderia.dump panaderia_restaurada
```

Crea la base `panaderia_restaurada` (nunca pisa una existente), restaura y
muestra las filas de cada tabla. Para usarla, poner en el `.env`
`DATABASE_URL=postgresql://panaderia:panaderia_dev@localhost:5432/panaderia_restaurada`
y `pnpm dev`.

3. **Para recuperar producción** (se perdió o se rompió la base):
   1. En Supabase, primero probar su propio backup: **Database → Backups →
      Restore** (el más simple, si el problema es de los últimos 7 días).
   2. Si eso no alcanza: crear un proyecto nuevo de Supabase, y restaurar ahí:

```bash
docker run --rm -i postgres:17 pg_restore --no-owner --no-privileges --exit-on-error \
  --dbname='<session pooler del proyecto NUEVO>' < panaderia.dump
```

3.  Cambiar `DATABASE_URL` y `DIRECT_URL` en Vercel por las del proyecto
    nuevo, y **Redeploy**.

## Desplegar una versión nueva

Cada push a `main` despliega solo (Vercel), después de que el CI
(GitHub Actions) esté en verde. Si la versión trae una migración, **primero un
backup**: el despliegue aplica las migraciones antes de compilar.

Volver a la versión anterior: **Vercel → Deployments → el anterior → Promote
to Production**. Ojo: si la versión nueva traía una migración, la base ya
cambió; volver atrás el código no la deshace.

## Lo que NO hay que hacer nunca

- Correr `pnpm db:seed` o `pnpm db:reset` contra producción (la semilla se
  niega, pero `db:reset` borra todo).
- Correr `prisma migrate dev` contra producción: es solo para desarrollo.
  En producción, `prisma migrate deploy`.
- Editar una migración que ya se aplicó en producción.
- Subir al repositorio un `.env`, un backup o un archivo con contraseñas.
