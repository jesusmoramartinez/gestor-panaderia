import { z } from 'zod';

/** Los tres roles del sistema. Coincide con el enum de la base. */
export const RolSchema = z.enum(['DUENO', 'ENCARGADO', 'EMPLEADO']);
export type Rol = z.infer<typeof RolSchema>;

/**
 * Email NORMALIZADO: sin espacios alrededor y en minúsculas.
 *
 * La normalización es parte del esquema, no algo que cada endpoint recuerde
 * hacer. Postgres distingue mayúsculas, así que sin esto "Juan@mail.com" y
 * "juan@mail.com" serían dos cuentas distintas para el sistema y la misma
 * para la persona.
 */
export const EmailSchema = z.string().trim().toLowerCase().pipe(z.email('Email inválido'));

export const LoginSchema = z.object({
  email: EmailSchema,
  // En el login NO se exige largo mínimo: hay que aceptar lo que el usuario
  // escriba y simplemente verificar. El mínimo se exige al CREAR la contraseña.
  password: z.string().min(1, 'La contraseña es obligatoria').max(200),
});
export type LoginInput = z.infer<typeof LoginSchema>;

export const PasswordNuevaSchema = z
  .string()
  .min(8, 'La contraseña debe tener al menos 8 caracteres')
  .max(200);

export const CrearUsuarioSchema = z.object({
  email: EmailSchema,
  nombre: z.string().trim().min(1, 'El nombre es obligatorio').max(120),
  rol: RolSchema,
  password: PasswordNuevaSchema,
  /** Sucursales donde podrá operar. El dueño accede a todas sin esta lista. */
  sucursalIds: z.array(z.uuid()).default([]),
});
export type CrearUsuarioInput = z.infer<typeof CrearUsuarioSchema>;

export const SucursalResumenSchema = z.object({
  id: z.uuid(),
  codigo: z.string(),
  nombre: z.string(),
  esCentral: z.boolean(),
});
export type SucursalResumen = z.infer<typeof SucursalResumenSchema>;

/**
 * Lo que devuelve GET /api/auth/me: todo lo que el frontend necesita saber de
 * la sesión. Nunca incluye el hash de la contraseña (ni ningún otro secreto):
 * lo que no está en el esquema, no sale del servidor.
 */
export const UsuarioSesionSchema = z.object({
  id: z.uuid(),
  email: z.string(),
  nombre: z.string(),
  rol: RolSchema,
  empresa: z.object({
    id: z.uuid(),
    nombre: z.string(),
    zonaHoraria: z.string(),
  }),
  sucursales: z.array(SucursalResumenSchema),
  permisos: z.array(z.string()),
});
export type UsuarioSesion = z.infer<typeof UsuarioSesionSchema>;

/** Forma de los errores que devuelve la API. Igual para todos los endpoints. */
export const ErrorApiSchema = z.object({
  codigo: z.string(),
  mensaje: z.string(),
  detalles: z.unknown().optional(),
});
export type ErrorApi = z.infer<typeof ErrorApiSchema>;

/**
 * Un usuario tal como lo ve el listado. Fijate que NO incluye passwordHash:
 * el esquema es también la lista de lo que el servidor tiene permitido
 * devolver. Lo que no está acá, no sale.
 */
export const UsuarioResumenSchema = z.object({
  id: z.uuid(),
  email: z.string(),
  nombre: z.string(),
  rol: RolSchema,
  activo: z.boolean(),
  /** ISO 8601 en UTC, o null si nunca entró. El front lo muestra en hora de Argentina. */
  ultimoAccesoAt: z.string().nullable(),
  sucursales: z.array(SucursalResumenSchema),
});
export type UsuarioResumen = z.infer<typeof UsuarioResumenSchema>;

/**
 * Tiene que coincidir con el enum `AccionAuditoria` del schema de Prisma.
 *
 * Están declarados dos veces porque viven en mundos distintos (uno genera SQL,
 * el otro valida JSON), y eso significa que se pueden desincronizar. Pasó: al
 * agregar FORZAR_STOCK_NEGATIVO en la Fase 6 me olvidé de este archivo, y lo
 * encontró `pnpm typecheck` antes de que llegara a ningún lado.
 */
export const AccionAuditoriaSchema = z.enum([
  'CREAR',
  'ACTUALIZAR',
  'DESACTIVAR',
  'ANULAR',
  'LOGIN',
  'LOGIN_FALLIDO',
  'LOGOUT',
  'FORZAR_STOCK_NEGATIVO',
]);
export type AccionAuditoria = z.infer<typeof AccionAuditoriaSchema>;

export const EventoAuditoriaSchema = z.object({
  id: z.uuid(),
  accion: AccionAuditoriaSchema,
  entidad: z.string(),
  entidadId: z.uuid().nullable(),
  usuario: z.object({ id: z.uuid(), nombre: z.string(), email: z.string() }).nullable(),
  ip: z.string().nullable(),
  createdAt: z.string(),
  datosAntes: z.unknown().nullable(),
  datosDespues: z.unknown().nullable(),
});
export type EventoAuditoria = z.infer<typeof EventoAuditoriaSchema>;

/** Paginación simple por límite. Los números llegan como texto en el query. */
export const PaginacionSchema = z.object({
  limite: z.coerce.number().int().min(1).max(200).default(50),
});
