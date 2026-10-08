# Monorepo, workspaces y por qué pnpm

_Leer antes de la Fase 0._

## El problema que resuelve

Nuestro sistema son dos programas distintos que tienen que hablar entre sí:

- el **frontend** (`apps/web`), que corre en el navegador de la tablet,
- el **backend** (`apps/api`), que corre en un servidor con Node.js.

Y hablan de las mismas cosas: un insumo, un movimiento de stock, una recepción de compra.

La pregunta es dónde vive la definición de "insumo". Hay tres caminos:

1. **Definirla dos veces**, una en cada lado. Es lo que hacen la mayoría de los tutoriales. Funciona hasta que agregás un campo en el backend y te olvidás del frontend. No hay error, no hay aviso: simplemente el formulario deja de enviar un dato y te enterás cuando el dueño te llama.
2. **Dos repositorios y una librería publicada** con los tipos compartidos. Es lo que hacen las empresas grandes. Cada cambio en los tipos implica publicar una versión nueva y actualizarla en los dos lados: tres pasos en vez de uno.
3. **Un solo repositorio con los tres paquetes adentro** (un _monorepo_). Cambiás el esquema compartido y TypeScript te marca los errores **en los dos lados, en el mismo commit**.

Elegimos el 3.

## Qué es un monorepo

Un repositorio de git con varios proyectos adentro, cada uno con su `package.json`:

```
panaderia/                  ← un solo repositorio de git
├── package.json            ← la raíz: scripts y herramientas comunes
├── pnpm-workspace.yaml     ← "los paquetes están en apps/* y packages/*"
├── apps/
│   ├── api/   package.json
│   └── web/   package.json
└── packages/
    └── shared/ package.json
```

**No es** "poner todo en una carpeta": cada paquete declara sus propias dependencias y se puede testear y construir por separado. Lo que comparten es el repositorio, el historial de git y una única instalación de `node_modules`.

## Qué es un workspace

Es la función del gestor de paquetes que hace que ese esquema funcione. Con workspaces:

- `pnpm install` en la raíz instala las dependencias de los tres paquetes de una vez;
- `apps/web` puede importar `@panaderia/shared` como si fuera una librería instalada, pero apunta a la carpeta local — sin publicar nada, sin copiar archivos;
- cuando cambiás `shared`, los otros dos ven el cambio al instante.

En `apps/web/package.json`:

```json
{ "dependencies": { "@panaderia/shared": "workspace:*" } }
```

`workspace:*` significa "la versión que está en este repositorio".

## Por qué pnpm (y no npm, que ya tenés)

npm **también** tiene workspaces y alcanzaría. Elegimos pnpm por tres razones concretas:

### 1. Aislamiento estricto (la razón principal)

npm **aplana** las dependencias: mete todo en un `node_modules` grande en la raíz. Consecuencia: si `apps/web` escribe `import { z } from 'zod'` pero **nunca declaró** zod — lo declaró el backend —, funciona igual, porque zod está ahí arriba. Se llama _dependencia fantasma_. El día que separes los proyectos o despliegues solo el frontend, explota.

pnpm arma un `node_modules` donde cada paquete ve **solo lo que declaró**. Si te olvidás de declarar algo, falla ya, en tu máquina. Para alguien que está aprendiendo, eso es un profesor gratis.

### 2. Disco y velocidad

pnpm guarda cada versión de cada librería **una sola vez** en tu disco (en un almacén global) y en los proyectos pone enlaces duros. Tres paquetes que usan la misma versión de TypeScript no la tienen tres veces. Instalar es notablemente más rápido, y en un monorepo instalás seguido.

### 3. `--filter`

```bash
pnpm --filter api test            # tests solo del backend
pnpm --filter web dev             # levantar solo el frontend
pnpm --filter shared build        # compilar solo lo compartido
```

Es lo que vas a usar todo el día.

**Costo:** un comando de instalación global (`npm install -g pnpm`) y acordarte de escribir `pnpm` en lugar de `npm`.

> Nota: en muchos proyectos se usa `corepack` (que viene con Node) para fijar la versión de pnpm. En tu Node no está disponible, así que instalamos pnpm global. Es equivalente para lo que necesitamos.

## Alternativas que descartamos

| Opción                     | Por qué no                                                                                                                                                                                                                              |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **npm workspaces**         | Funciona y no hay que instalar nada, pero sin aislamiento estricto: las dependencias fantasma son un error silencioso justo del tipo que cuesta aprender a ver.                                                                         |
| **Yarn (berry)**           | Capacidades parecidas a pnpm, configuración más particular y hoy menos frecuente en proyectos nuevos.                                                                                                                                   |
| **Turborepo / Nx**         | Agregan caché de builds y orquestación de tareas. Brillan con 10 paquetes y CI. Con 3 paquetes serían una herramienta más que aprender sin resolver un problema que tengas. **Se pueden sumar después sin tocar una línea del código.** |
| **Un repositorio por app** | Las dos partes se desincronizan y cada cambio compartido se vuelve un trámite de tres pasos.                                                                                                                                            |

## La regla de dependencias

```
web ──► shared ◄── api
```

- `web` puede importar `shared`. `api` puede importar `shared`.
- `shared` **no** importa a nadie: ni Express, ni Prisma, ni React.
- `web` **nunca** importa de `api`, ni al revés. Se hablan por HTTP.

¿Por qué tanta insistencia? Porque `shared` se ejecuta **en el navegador**. Si alguien importa Prisma ahí, el navegador va a intentar cargar una librería de base de datos: el error es confuso y la pista está a tres capas de distancia. Mantener `shared` limpio evita toda esa clase de problema.

Lo que sí va en `shared`:

- esquemas Zod (la forma de los datos y sus reglas),
- tipos y enums del dominio (`TipoMovimiento`, `EstadoOrden`),
- lógica **pura**: conversión de unidades, cálculo del costo promedio.

Fijate que la conversión de unidades vive ahí: el formulario del front puede mostrar "4 bolsas = 100 kg" mientras escribís, usando exactamente la misma función que el backend usa para guardar el movimiento. Un solo lugar donde esa cuenta puede estar mal.
