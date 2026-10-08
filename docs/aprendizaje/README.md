# Notas de aprendizaje

Una nota por concepto, en Markdown. No son documentación del sistema (eso es `PLAN.md`): son **tu material de estudio**, escritas para que las entienda alguien que está empezando, con ejemplos de la panadería.

## Cómo usarlas

- Leé la nota **antes** de la fase que la usa; volvé a leerla **después**, con el código en la mano. Se entiende distinto.
- Si una nota no te queda clara, decilo: se reescribe. Una nota que no se entiende es una nota mal escrita, no un problema tuyo.
- Cada vez que aparezca un concepto nuevo durante la implementación, se agrega una nota acá.

## Índice

| Nota                                                                   | De qué se trata                                                                                                                                                                                                             | Cuándo leerla                               |
| ---------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------- |
| [00-glosario-tecnico.md](00-glosario-tecnico.md)                       | Todos los términos técnicos que aparecen en `PLAN.md`, definidos cortos. Tu diccionario de consulta rápida.                                                                                                                 | Ya, y cada vez que no entiendas una palabra |
| [01-monorepo-y-workspaces.md](01-monorepo-y-workspaces.md)             | Qué es un monorepo, qué es un workspace, por qué pnpm y no npm                                                                                                                                                              | Antes de la Fase 0                          |
| [02-decisiones-de-arranque.md](02-decisiones-de-arranque.md)           | Las 8 decisiones que tomamos antes de escribir código, con las alternativas que descartamos y por qué                                                                                                                       | Ya                                          |
| [03-kardex-stock-calculado.md](03-kardex-stock-calculado.md)           | El concepto más importante del proyecto: por qué el stock se calcula y no se guarda                                                                                                                                         | Antes de la Fase 6 (pero leela ya)          |
| [04-dinero-y-cantidades-decimal.md](04-dinero-y-cantidades-decimal.md) | Por qué `0.1 + 0.2 ≠ 0.3` y qué hacemos al respecto                                                                                                                                                                         | Antes de la Fase 1                          |
| [05-unidades-y-conversiones.md](05-unidades-y-conversiones.md)         | Unidad base, dimensiones, presentaciones de compra y la regla del snapshot                                                                                                                                                  | Antes de la Fase 3                          |
| [06-multiempresa-y-aislamiento.md](06-multiempresa-y-aislamiento.md)   | Qué es multi-tenancy y cómo se evita que una panadería vea los datos de otra                                                                                                                                                | Antes de la Fase 2                          |
| [07-fase-0-plomeria.md](07-fase-0-plomeria.md)                         | Lo que apareció al armar la Fase 0: validar variables de entorno, CORS y el proxy, el pool de conexiones, los `.js` en los imports, `AggregateError`, el cambio de ruta del volumen en PostgreSQL 18 y por qué TypeScript 6 | Después de la Fase 0                        |

## Todavía no escritas (se agregan al llegar a su fase)

- Migraciones de base de datos → Fase 1
- Transacciones y ACID → Fase 6
- Condiciones de carrera y bloqueos → Fase 6
- Autenticación: cookies, sesiones, hash de contraseñas, CSRF → Fase 2
- Zod y tipos derivados → Fase 4
- TanStack Query y el caché del servidor → Fase 4
- Costo promedio ponderado paso a paso → Fase 8
- Índices y `EXPLAIN` → Fase 10
- Backups y restore → Fase 11
