/**
 * Los datos de la semilla y la lógica para cargarlos.
 *
 * Está separado de seed.ts para que lo puedan usar DOS clientes distintos:
 *   - seed.ts, que siembra la base de desarrollo;
 *   - la preparación de los tests, que siembra una base aparte.
 * Por eso `sembrar` recibe el cliente de Prisma como parámetro en lugar de
 * importarlo: así quien llama decide contra qué base trabaja.
 */
import type { PrismaClient } from '../src/generated/prisma/client.js';
import {
  CATEGORIAS,
  type DefinicionInsumo,
  INSUMOS_LAFERRERE,
  INSUMOS_VECINA,
} from './semilla-insumos.js';
import {
  type DefinicionProveedor,
  PROVEEDORES_LAFERRERE,
  PROVEEDORES_VECINA,
} from './semilla-proveedores.js';
import { hashearPassword } from '../src/lib/password.js';

/**
 * Contraseña única para todos los usuarios de desarrollo.
 * Es visible a propósito: son datos de prueba. El seed se niega a correr en
 * producción, así que esto nunca llega a un servidor.
 */
export const PASSWORD_DEV = 'panaderia123';

/**
 * Las unidades de medida básicas. Son iguales para toda panadería, así que no
 * forman parte de la definición de cada empresa: se cargan para todas.
 *
 * `factorABase` va como TEXTO, nunca como number: es el factor del que
 * depende cada conversión del sistema.
 */
export const UNIDADES = [
  { codigo: 'kg', nombre: 'Kilogramo', dimension: 'PESO', factorABase: '1', esBase: true },
  { codigo: 'g', nombre: 'Gramo', dimension: 'PESO', factorABase: '0.001', esBase: false },
  { codigo: 'l', nombre: 'Litro', dimension: 'VOLUMEN', factorABase: '1', esBase: true },
  { codigo: 'ml', nombre: 'Mililitro', dimension: 'VOLUMEN', factorABase: '0.001', esBase: false },
  { codigo: 'u', nombre: 'Unidad', dimension: 'UNIDAD', factorABase: '1', esBase: true },
] as const;

export type DefinicionSucursal = {
  codigo: string;
  nombre: string;
  esCentral: boolean;
};

export type DefinicionUsuario = {
  email: string;
  nombre: string;
  rol: 'DUENO' | 'ENCARGADO' | 'EMPLEADO';
  /** Códigos de sucursal. El DUEÑO va con lista vacía: accede a todas. */
  sucursales: readonly string[];
};

export type DefinicionEmpresa = {
  id: string;
  nombre: string;
  costoIncluyeIva: boolean;
  sucursales: readonly DefinicionSucursal[];
  usuarios: readonly DefinicionUsuario[];
  insumos: readonly DefinicionInsumo[];
  proveedores: readonly DefinicionProveedor[];
};

// ===========================================================================
// DATOS DEL CLIENTE — cambiá estos valores por los reales
// ===========================================================================

export const EMPRESAS: readonly DefinicionEmpresa[] = [
  {
    // Id FIJO a propósito. La tabla `empresa` no tiene otra columna única por
    // la cual buscarla, así que un id fijo es lo que hace que el upsert
    // encuentre siempre la misma fila en lugar de crear una empresa nueva en
    // cada corrida.
    //
    // Con forma válida según la RFC de UUID (dígito de versión 4 y de variante
    // 8), porque nuestros propios validadores Zod la verifican: un UUID
    // inventado tipo '1111-1111-...' lo rechazaría z.uuid().
    id: '11111111-1111-4111-8111-111111111111',
    // TODO(cliente): nombre provisorio, falta confirmarlo con el dueño.
    nombre: 'Panadería Laferrere',
    // Supuesto de la pregunta C-11 del PLAN.md: monotributista, así que el IVA
    // que paga es parte del costo del insumo. Si es responsable inscripto,
    // esto pasa a false y el costo se registra neto.
    costoIncluyeIva: true,
    sucursales: [
      { codigo: 'CEN', nombre: 'Central', esCentral: true },
      { codigo: 'LAF', nombre: 'Laferrere', esCentral: false },
    ],
    usuarios: [
      { email: 'dueno@panaderia.test', nombre: 'Dueño', rol: 'DUENO', sucursales: [] },
      {
        email: 'encargado@panaderia.test',
        nombre: 'Encargado',
        rol: 'ENCARGADO',
        // Cubre las dos panaderías: justo el caso que justificó la decisión de
        // "un usuario, varias sucursales" (PLAN.md, decisión 3).
        sucursales: ['CEN', 'LAF'],
      },
      {
        email: 'empleado@panaderia.test',
        nombre: 'Empleado',
        rol: 'EMPLEADO',
        sucursales: ['LAF'],
      },
    ],
    insumos: INSUMOS_LAFERRERE,
    proveedores: PROVEEDORES_LAFERRERE,
  },

  // ===========================================================================
  // SEGUNDA EMPRESA — existe para poder probar el aislamiento multi-empresa.
  //
  // No es relleno: sin una segunda empresa cargada no hay forma de demostrar
  // que un usuario no puede ver los datos de otra panadería. Los tests de
  // aislamiento se loguean con este dueño e intentan leer datos de la empresa
  // de arriba. También te sirve para comprobarlo a mano desde la pantalla.
  // ===========================================================================
  {
    id: '22222222-2222-4222-8222-222222222222',
    nombre: 'Panadería Vecina (datos de prueba)',
    costoIncluyeIva: true,
    sucursales: [{ codigo: 'UNI', nombre: 'Única', esCentral: true }],
    usuarios: [
      { email: 'dueno@vecina.test', nombre: 'Dueño Vecino', rol: 'DUENO', sucursales: [] },
      {
        email: 'empleado@vecina.test',
        nombre: 'Empleado Vecino',
        rol: 'EMPLEADO',
        sucursales: ['UNI'],
      },
    ],
    insumos: INSUMOS_VECINA,
    proveedores: PROVEEDORES_VECINA,
  },
];

// ===========================================================================

/**
 * Carga los datos. Es IDEMPOTENTE: se puede correr cien veces y el resultado
 * es siempre el mismo, gracias a `upsert` ("insertá si no existe, actualizá si
 * existe").
 */
export async function sembrar(prisma: PrismaClient): Promise<void> {
  // Hasheamos ANTES de abrir las transacciones: cada hasheo tarda ~130 ms a
  // propósito, y no conviene tener una transacción abierta mientras esperamos.
  const hashes = new Map<string, string>();
  for (const empresa of EMPRESAS) {
    for (const usuario of empresa.usuarios) {
      hashes.set(usuario.email, await hashearPassword(PASSWORD_DEV));
    }
  }

  for (const definicionEmpresa of EMPRESAS) {
    // Una transacción por empresa: si algo falla a mitad de camino, no queda
    // una empresa sin sucursales ni un usuario sin permisos.
    await prisma.$transaction(async (tx) => {
      const empresa = await tx.empresa.upsert({
        where: { id: definicionEmpresa.id },
        create: {
          id: definicionEmpresa.id,
          nombre: definicionEmpresa.nombre,
          costoIncluyeIva: definicionEmpresa.costoIncluyeIva,
        },
        update: {
          nombre: definicionEmpresa.nombre,
          costoIncluyeIva: definicionEmpresa.costoIncluyeIva,
        },
      });

      for (const unidad of UNIDADES) {
        await tx.unidadMedida.upsert({
          where: { empresaId_codigo: { empresaId: empresa.id, codigo: unidad.codigo } },
          create: { ...unidad, empresaId: empresa.id },
          update: {
            nombre: unidad.nombre,
            dimension: unidad.dimension,
            factorABase: unidad.factorABase,
            esBase: unidad.esBase,
          },
        });
      }

      const sucursalesPorCodigo = new Map<string, string>();
      for (const sucursal of definicionEmpresa.sucursales) {
        const fila = await tx.sucursal.upsert({
          // empresaId_codigo es el nombre que Prisma le da a la clave única
          // compuesta @@unique([empresaId, codigo]) del schema.
          where: { empresaId_codigo: { empresaId: empresa.id, codigo: sucursal.codigo } },
          create: { ...sucursal, empresaId: empresa.id },
          update: { nombre: sucursal.nombre, esCentral: sucursal.esCentral },
        });
        sucursalesPorCodigo.set(sucursal.codigo, fila.id);
      }

      for (const usuario of definicionEmpresa.usuarios) {
        const hash = hashes.get(usuario.email);
        if (!hash) throw new Error(`Falta el hash de ${usuario.email}`);

        const fila = await tx.usuario.upsert({
          where: { email: usuario.email },
          create: {
            empresaId: empresa.id,
            email: usuario.email,
            nombre: usuario.nombre,
            passwordHash: hash,
            rol: usuario.rol,
          },
          update: {
            nombre: usuario.nombre,
            rol: usuario.rol,
            passwordHash: hash,
            activo: true,
          },
        });

        // Para las asignaciones de sucursal, el seed declara el estado FINAL:
        // borra las que haya y crea las que corresponden. Así, si mañana
        // cambiás la lista de arriba, la corrida siguiente refleja el cambio
        // en lugar de ir acumulando asignaciones viejas.
        await tx.usuarioSucursal.deleteMany({ where: { usuarioId: fila.id } });
        if (usuario.sucursales.length > 0) {
          await tx.usuarioSucursal.createMany({
            data: usuario.sucursales.map((codigo) => {
              const sucursalId = sucursalesPorCodigo.get(codigo);
              if (!sucursalId) throw new Error(`No existe la sucursal ${codigo}`);
              return { usuarioId: fila.id, sucursalId };
            }),
          });
        }
      }

      // --- Catálogo: categorías, insumos, presentaciones y mínimos ---

      const categoriasPorNombre = new Map<string, string>();
      for (const nombre of CATEGORIAS) {
        const fila = await tx.categoriaInsumo.upsert({
          where: { empresaId_nombre: { empresaId: empresa.id, nombre } },
          create: { empresaId: empresa.id, nombre },
          update: {},
        });
        categoriasPorNombre.set(nombre, fila.id);
      }

      const unidades = await tx.unidadMedida.findMany({
        where: { empresaId: empresa.id },
        select: { id: true, codigo: true },
      });
      const unidadesPorCodigo = new Map(unidades.map((u) => [u.codigo, u.id]));

      for (const definicion of definicionEmpresa.insumos) {
        const unidadBaseId = unidadesPorCodigo.get(definicion.unidad);
        if (!unidadBaseId) throw new Error(`No existe la unidad ${definicion.unidad}`);
        const categoriaId = categoriasPorNombre.get(definicion.categoria) ?? null;

        const insumo = await tx.insumo.upsert({
          where: { empresaId_nombre: { empresaId: empresa.id, nombre: definicion.nombre } },
          create: {
            empresaId: empresa.id,
            nombre: definicion.nombre,
            codigo: definicion.codigo ?? null,
            categoriaId,
            unidadBaseId,
          },
          update: { codigo: definicion.codigo ?? null, categoriaId, activo: true },
          select: { id: true },
        });

        for (const presentacion of definicion.presentaciones) {
          await tx.presentacionInsumo.upsert({
            where: { insumoId_nombre: { insumoId: insumo.id, nombre: presentacion.nombre } },
            create: {
              empresaId: empresa.id,
              insumoId: insumo.id,
              nombre: presentacion.nombre,
              cantidadBase: presentacion.cantidadBase,
              esDefault: presentacion.esDefault ?? false,
            },
            update: {
              cantidadBase: presentacion.cantidadBase,
              esDefault: presentacion.esDefault ?? false,
              activa: true,
            },
          });
        }

        for (const [codigoSucursal, stockMinimo] of Object.entries(definicion.minimos)) {
          const sucursalId = sucursalesPorCodigo.get(codigoSucursal);
          if (!sucursalId) throw new Error(`No existe la sucursal ${codigoSucursal}`);
          await tx.insumoSucursal.upsert({
            where: { insumoId_sucursalId: { insumoId: insumo.id, sucursalId } },
            create: { insumoId: insumo.id, sucursalId, empresaId: empresa.id, stockMinimo },
            update: { stockMinimo },
          });
        }
      }

      // --- Proveedores y qué insumo le compramos a cada uno ---

      // Los insumos ya están sembrados: los leemos una vez y resolvemos los
      // nombres contra ids. Buscar por nombre adentro del loop haría una
      // consulta por línea.
      const insumos = await tx.insumo.findMany({
        where: { empresaId: empresa.id },
        select: { id: true, nombre: true, presentaciones: { select: { id: true, nombre: true } } },
      });
      const insumosPorNombre = new Map(insumos.map((fila) => [fila.nombre, fila]));

      /** Las que hay que marcar como preferidas en la segunda pasada. */
      const preferidas: { insumoId: string; asociacionId: string }[] = [];

      for (const definicion of definicionEmpresa.proveedores) {
        const { insumos: lineas, ...datosProveedor } = definicion;

        const proveedor = await tx.proveedor.upsert({
          where: { empresaId_nombre: { empresaId: empresa.id, nombre: definicion.nombre } },
          create: { empresaId: empresa.id, ...datosProveedor },
          update: { ...datosProveedor, activo: true },
          select: { id: true },
        });

        for (const linea of lineas) {
          const insumo = insumosPorNombre.get(linea.insumo);
          if (!insumo) throw new Error(`No existe el insumo ${linea.insumo}`);

          const presentacionId =
            linea.presentacion === undefined
              ? null
              : (insumo.presentaciones.find((fila) => fila.nombre === linea.presentacion)?.id ??
                null);
          if (linea.presentacion !== undefined && presentacionId === null) {
            throw new Error(`No existe la presentación ${linea.presentacion} de ${linea.insumo}`);
          }

          const precio = linea.ultimoPrecio ?? null;
          const datos = {
            presentacionId,
            codigoProveedor: linea.codigoProveedor ?? null,
            ultimoPrecio: precio,
            // El CHECK de la base exige que el precio y su fecha vayan juntos.
            ultimoPrecioAt: precio === null ? null : new Date(),
            activo: true,
          };

          const asociacion = await tx.proveedorInsumo.upsert({
            where: {
              proveedorId_insumoId: { proveedorId: proveedor.id, insumoId: insumo.id },
            },
            // En esta pasada NADIE queda preferido: así el índice único parcial
            // no puede chocar, sin importar en qué orden estén los datos de
            // arriba. Las marcas se ponen después, cuando ya están todas.
            create: {
              empresaId: empresa.id,
              proveedorId: proveedor.id,
              insumoId: insumo.id,
              esPreferido: false,
              ...datos,
            },
            update: { esPreferido: false, ...datos },
            select: { id: true },
          });

          if (linea.esPreferido === true) {
            preferidas.push({ insumoId: insumo.id, asociacionId: asociacion.id });
          }
        }
      }

      for (const { asociacionId } of preferidas) {
        await tx.proveedorInsumo.update({
          where: { id: asociacionId },
          data: { esPreferido: true },
        });
      }
    });
  }
}
