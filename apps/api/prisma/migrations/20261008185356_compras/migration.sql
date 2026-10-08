-- CreateEnum
CREATE TYPE "tipo_documento" AS ENUM ('ORDEN_COMPRA', 'RECEPCION_COMPRA');

-- CreateEnum
CREATE TYPE "estado_orden_compra" AS ENUM ('BORRADOR', 'PEDIDA', 'PARCIAL', 'RECIBIDA', 'CERRADA', 'CANCELADA');

-- CreateEnum
CREATE TYPE "estado_recepcion" AS ENUM ('CONFIRMADA', 'ANULADA');

-- AlterTable
ALTER TABLE "insumo" ADD COLUMN     "costo_promedio" DECIMAL(18,4);

-- AlterTable
ALTER TABLE "movimiento_stock" ADD COLUMN     "recepcion_compra_id" UUID;

-- CreateTable
CREATE TABLE "contador_documento" (
    "empresa_id" UUID NOT NULL,
    "tipo_documento" "tipo_documento" NOT NULL,
    "ultimo_numero" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "contador_documento_pkey" PRIMARY KEY ("empresa_id","tipo_documento")
);

-- CreateTable
CREATE TABLE "orden_compra" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "empresa_id" UUID NOT NULL,
    "sucursal_id" UUID NOT NULL,
    "proveedor_id" UUID NOT NULL,
    "numero" INTEGER NOT NULL,
    "estado" "estado_orden_compra" NOT NULL,
    "fecha_entrega_estimada" DATE,
    "notas" TEXT,
    "usuario_id" UUID NOT NULL,
    "pedida_at" TIMESTAMPTZ(6),
    "cerrada_at" TIMESTAMPTZ(6),
    "nota_cierre" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "orden_compra_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "linea_orden_compra" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "empresa_id" UUID NOT NULL,
    "orden_compra_id" UUID NOT NULL,
    "insumo_id" UUID NOT NULL,
    "presentacion_id" UUID,
    "cantidad" DECIMAL(18,6) NOT NULL,
    "factor_conversion" DECIMAL(20,10) NOT NULL,
    "cantidad_base" DECIMAL(18,6) NOT NULL,
    "precio_unitario" DECIMAL(18,4),

    CONSTRAINT "linea_orden_compra_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recepcion_compra" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "empresa_id" UUID NOT NULL,
    "sucursal_id" UUID NOT NULL,
    "proveedor_id" UUID NOT NULL,
    "orden_compra_id" UUID,
    "numero" INTEGER NOT NULL,
    "fecha" TIMESTAMPTZ(6) NOT NULL,
    "numero_remito" TEXT,
    "numero_factura" TEXT,
    "notas" TEXT,
    "estado" "estado_recepcion" NOT NULL DEFAULT 'CONFIRMADA',
    "usuario_id" UUID NOT NULL,
    "operacion_id" UUID NOT NULL,
    "anulada_at" TIMESTAMPTZ(6),
    "anulada_por_id" UUID,
    "motivo_anulacion" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "recepcion_compra_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "linea_recepcion_compra" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "empresa_id" UUID NOT NULL,
    "recepcion_compra_id" UUID NOT NULL,
    "linea_orden_compra_id" UUID,
    "insumo_id" UUID NOT NULL,
    "presentacion_id" UUID,
    "cantidad" DECIMAL(18,6) NOT NULL,
    "factor_conversion" DECIMAL(20,10) NOT NULL,
    "cantidad_base" DECIMAL(18,6) NOT NULL,
    "precio_unitario" DECIMAL(18,4) NOT NULL,
    "costo_unitario_base" DECIMAL(18,4) NOT NULL,

    CONSTRAINT "linea_recepcion_compra_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "plantilla_pedido" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "empresa_id" UUID NOT NULL,
    "nombre" TEXT NOT NULL,
    "proveedor_id" UUID NOT NULL,
    "sucursal_id" UUID NOT NULL,
    "notas" TEXT,
    "activa" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "plantilla_pedido_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "linea_plantilla_pedido" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "empresa_id" UUID NOT NULL,
    "plantilla_id" UUID NOT NULL,
    "insumo_id" UUID NOT NULL,
    "presentacion_id" UUID,
    "cantidad" DECIMAL(18,6) NOT NULL,

    CONSTRAINT "linea_plantilla_pedido_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "orden_compra_empresa_id_estado_idx" ON "orden_compra"("empresa_id", "estado");

-- CreateIndex
CREATE INDEX "orden_compra_empresa_id_sucursal_id_idx" ON "orden_compra"("empresa_id", "sucursal_id");

-- CreateIndex
CREATE INDEX "orden_compra_proveedor_id_idx" ON "orden_compra"("proveedor_id");

-- CreateIndex
CREATE UNIQUE INDEX "orden_compra_empresa_id_numero_key" ON "orden_compra"("empresa_id", "numero");

-- CreateIndex
CREATE INDEX "linea_orden_compra_insumo_id_idx" ON "linea_orden_compra"("insumo_id");

-- CreateIndex
CREATE UNIQUE INDEX "linea_orden_compra_orden_compra_id_insumo_id_key" ON "linea_orden_compra"("orden_compra_id", "insumo_id");

-- CreateIndex
CREATE INDEX "recepcion_compra_empresa_id_sucursal_id_fecha_idx" ON "recepcion_compra"("empresa_id", "sucursal_id", "fecha");

-- CreateIndex
CREATE INDEX "recepcion_compra_orden_compra_id_idx" ON "recepcion_compra"("orden_compra_id");

-- CreateIndex
CREATE INDEX "recepcion_compra_proveedor_id_idx" ON "recepcion_compra"("proveedor_id");

-- CreateIndex
CREATE UNIQUE INDEX "recepcion_compra_empresa_id_numero_key" ON "recepcion_compra"("empresa_id", "numero");

-- CreateIndex
CREATE INDEX "linea_recepcion_compra_linea_orden_compra_id_idx" ON "linea_recepcion_compra"("linea_orden_compra_id");

-- CreateIndex
CREATE INDEX "linea_recepcion_compra_insumo_id_idx" ON "linea_recepcion_compra"("insumo_id");

-- CreateIndex
CREATE UNIQUE INDEX "linea_recepcion_compra_recepcion_compra_id_insumo_id_key" ON "linea_recepcion_compra"("recepcion_compra_id", "insumo_id");

-- CreateIndex
CREATE INDEX "plantilla_pedido_empresa_id_activa_idx" ON "plantilla_pedido"("empresa_id", "activa");

-- CreateIndex
CREATE UNIQUE INDEX "plantilla_pedido_empresa_id_nombre_key" ON "plantilla_pedido"("empresa_id", "nombre");

-- CreateIndex
CREATE INDEX "linea_plantilla_pedido_insumo_id_idx" ON "linea_plantilla_pedido"("insumo_id");

-- CreateIndex
CREATE UNIQUE INDEX "linea_plantilla_pedido_plantilla_id_insumo_id_key" ON "linea_plantilla_pedido"("plantilla_id", "insumo_id");

-- CreateIndex
CREATE INDEX "movimiento_stock_recepcion_compra_id_idx" ON "movimiento_stock"("recepcion_compra_id");

-- AddForeignKey
ALTER TABLE "movimiento_stock" ADD CONSTRAINT "movimiento_stock_recepcion_compra_id_fkey" FOREIGN KEY ("recepcion_compra_id") REFERENCES "recepcion_compra"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contador_documento" ADD CONSTRAINT "contador_documento_empresa_id_fkey" FOREIGN KEY ("empresa_id") REFERENCES "empresa"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orden_compra" ADD CONSTRAINT "orden_compra_empresa_id_fkey" FOREIGN KEY ("empresa_id") REFERENCES "empresa"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orden_compra" ADD CONSTRAINT "orden_compra_sucursal_id_fkey" FOREIGN KEY ("sucursal_id") REFERENCES "sucursal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orden_compra" ADD CONSTRAINT "orden_compra_proveedor_id_fkey" FOREIGN KEY ("proveedor_id") REFERENCES "proveedor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orden_compra" ADD CONSTRAINT "orden_compra_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "linea_orden_compra" ADD CONSTRAINT "linea_orden_compra_orden_compra_id_fkey" FOREIGN KEY ("orden_compra_id") REFERENCES "orden_compra"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "linea_orden_compra" ADD CONSTRAINT "linea_orden_compra_insumo_id_fkey" FOREIGN KEY ("insumo_id") REFERENCES "insumo"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "linea_orden_compra" ADD CONSTRAINT "linea_orden_compra_presentacion_id_fkey" FOREIGN KEY ("presentacion_id") REFERENCES "presentacion_insumo"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recepcion_compra" ADD CONSTRAINT "recepcion_compra_empresa_id_fkey" FOREIGN KEY ("empresa_id") REFERENCES "empresa"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recepcion_compra" ADD CONSTRAINT "recepcion_compra_sucursal_id_fkey" FOREIGN KEY ("sucursal_id") REFERENCES "sucursal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recepcion_compra" ADD CONSTRAINT "recepcion_compra_proveedor_id_fkey" FOREIGN KEY ("proveedor_id") REFERENCES "proveedor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recepcion_compra" ADD CONSTRAINT "recepcion_compra_orden_compra_id_fkey" FOREIGN KEY ("orden_compra_id") REFERENCES "orden_compra"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recepcion_compra" ADD CONSTRAINT "recepcion_compra_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recepcion_compra" ADD CONSTRAINT "recepcion_compra_anulada_por_id_fkey" FOREIGN KEY ("anulada_por_id") REFERENCES "usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "linea_recepcion_compra" ADD CONSTRAINT "linea_recepcion_compra_recepcion_compra_id_fkey" FOREIGN KEY ("recepcion_compra_id") REFERENCES "recepcion_compra"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "linea_recepcion_compra" ADD CONSTRAINT "linea_recepcion_compra_linea_orden_compra_id_fkey" FOREIGN KEY ("linea_orden_compra_id") REFERENCES "linea_orden_compra"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "linea_recepcion_compra" ADD CONSTRAINT "linea_recepcion_compra_insumo_id_fkey" FOREIGN KEY ("insumo_id") REFERENCES "insumo"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "linea_recepcion_compra" ADD CONSTRAINT "linea_recepcion_compra_presentacion_id_fkey" FOREIGN KEY ("presentacion_id") REFERENCES "presentacion_insumo"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plantilla_pedido" ADD CONSTRAINT "plantilla_pedido_empresa_id_fkey" FOREIGN KEY ("empresa_id") REFERENCES "empresa"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plantilla_pedido" ADD CONSTRAINT "plantilla_pedido_proveedor_id_fkey" FOREIGN KEY ("proveedor_id") REFERENCES "proveedor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plantilla_pedido" ADD CONSTRAINT "plantilla_pedido_sucursal_id_fkey" FOREIGN KEY ("sucursal_id") REFERENCES "sucursal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "linea_plantilla_pedido" ADD CONSTRAINT "linea_plantilla_pedido_plantilla_id_fkey" FOREIGN KEY ("plantilla_id") REFERENCES "plantilla_pedido"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "linea_plantilla_pedido" ADD CONSTRAINT "linea_plantilla_pedido_insumo_id_fkey" FOREIGN KEY ("insumo_id") REFERENCES "insumo"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "linea_plantilla_pedido" ADD CONSTRAINT "linea_plantilla_pedido_presentacion_id_fkey" FOREIGN KEY ("presentacion_id") REFERENCES "presentacion_insumo"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ===========================================================================
-- Agregado a mano: los invariantes de las compras.
--
-- Igual que en la migración del motor: Zod y el servicio validan antes, y esto
-- es la última línea de defensa si un bug futuro se saltea las dos.
-- ===========================================================================

-- 1) EL INVARIANTE DEL COSTO: una COMPRA siempre sabe de qué recepción viene
--    y cuánto costó. Sin esto, una compra sin costo rompería el promedio, y
--    una compra sin recepción no se podría anular desde ningún lado.
ALTER TABLE "movimiento_stock"
  ADD CONSTRAINT "movimiento_compra_con_recepcion_y_costo" CHECK (
    "tipo" <> 'COMPRA' OR ("recepcion_compra_id" IS NOT NULL AND "costo_unitario" IS NOT NULL)
  );

-- 2) El costo promedio no puede ser negativo.
ALTER TABLE "insumo"
  ADD CONSTRAINT "insumo_costo_promedio_no_negativo"
  CHECK ("costo_promedio" IS NULL OR "costo_promedio" >= 0);

-- 3) Los números de documento empiezan en 1.
ALTER TABLE "contador_documento"
  ADD CONSTRAINT "contador_no_negativo" CHECK ("ultimo_numero" >= 0);
ALTER TABLE "orden_compra"
  ADD CONSTRAINT "orden_numero_positivo" CHECK ("numero" > 0);
ALTER TABLE "recepcion_compra"
  ADD CONSTRAINT "recepcion_numero_positivo" CHECK ("numero" > 0);

-- 4) Los estados de la orden tienen que ser coherentes con sus fechas:
--    todo lo que salió del borrador (salvo una cancelación de borrador) tiene
--    fecha de pedido, y solo lo cerrado o cancelado tiene fecha de cierre.
ALTER TABLE "orden_compra"
  ADD CONSTRAINT "orden_pedida_con_fecha" CHECK (
    "estado" NOT IN ('PEDIDA', 'PARCIAL', 'RECIBIDA', 'CERRADA') OR "pedida_at" IS NOT NULL
  );
ALTER TABLE "orden_compra"
  ADD CONSTRAINT "orden_borrador_sin_fecha_de_pedido" CHECK (
    "estado" <> 'BORRADOR' OR "pedida_at" IS NULL
  );
ALTER TABLE "orden_compra"
  ADD CONSTRAINT "orden_cierre_con_fecha" CHECK (
    ("estado" IN ('CERRADA', 'CANCELADA')) = ("cerrada_at" IS NOT NULL)
  );

-- 5) Una recepción anulada sabe cuándo y quién; una confirmada, ninguna de
--    las dos cosas. Los tres datos van juntos o no van.
ALTER TABLE "recepcion_compra"
  ADD CONSTRAINT "recepcion_anulacion_completa" CHECK (
    ("estado" = 'ANULADA') = ("anulada_at" IS NOT NULL) AND
    ("anulada_at" IS NULL) = ("anulada_por_id" IS NULL)
  );

-- 6) Cantidades, factores y precios de las líneas. Un precio en cero sí vale
--    (una bonificación); negativo no existe.
ALTER TABLE "linea_orden_compra"
  ADD CONSTRAINT "linea_orden_cantidad_positiva" CHECK ("cantidad" > 0 AND "cantidad_base" > 0),
  ADD CONSTRAINT "linea_orden_factor_positivo" CHECK ("factor_conversion" > 0),
  ADD CONSTRAINT "linea_orden_precio_no_negativo"
    CHECK ("precio_unitario" IS NULL OR "precio_unitario" >= 0);

ALTER TABLE "linea_recepcion_compra"
  ADD CONSTRAINT "linea_recepcion_cantidad_positiva" CHECK ("cantidad" > 0 AND "cantidad_base" > 0),
  ADD CONSTRAINT "linea_recepcion_factor_positivo" CHECK ("factor_conversion" > 0),
  ADD CONSTRAINT "linea_recepcion_precio_no_negativo"
    CHECK ("precio_unitario" >= 0 AND "costo_unitario_base" >= 0);

ALTER TABLE "linea_plantilla_pedido"
  ADD CONSTRAINT "linea_plantilla_cantidad_positiva" CHECK ("cantidad" > 0);
