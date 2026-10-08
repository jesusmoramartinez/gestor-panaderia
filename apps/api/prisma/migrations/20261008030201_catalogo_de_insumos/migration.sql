-- CreateTable
CREATE TABLE "categoria_insumo" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "empresa_id" UUID NOT NULL,
    "nombre" TEXT NOT NULL,
    "activa" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "categoria_insumo_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "insumo" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "empresa_id" UUID NOT NULL,
    "codigo" TEXT,
    "nombre" TEXT NOT NULL,
    "categoria_id" UUID,
    "unidad_base_id" UUID NOT NULL,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "insumo_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "presentacion_insumo" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "empresa_id" UUID NOT NULL,
    "insumo_id" UUID NOT NULL,
    "nombre" TEXT NOT NULL,
    "cantidad_base" DECIMAL(18,6) NOT NULL,
    "es_default" BOOLEAN NOT NULL DEFAULT false,
    "activa" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "presentacion_insumo_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "insumo_sucursal" (
    "insumo_id" UUID NOT NULL,
    "sucursal_id" UUID NOT NULL,
    "empresa_id" UUID NOT NULL,
    "stock_minimo" DECIMAL(18,6) NOT NULL DEFAULT 0,
    "stock_maximo" DECIMAL(18,6),
    "ubicacion" TEXT,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "insumo_sucursal_pkey" PRIMARY KEY ("insumo_id","sucursal_id")
);

-- CreateIndex
CREATE INDEX "categoria_insumo_empresa_id_idx" ON "categoria_insumo"("empresa_id");

-- CreateIndex
CREATE UNIQUE INDEX "categoria_insumo_empresa_id_nombre_key" ON "categoria_insumo"("empresa_id", "nombre");

-- CreateIndex
CREATE INDEX "insumo_empresa_id_activo_idx" ON "insumo"("empresa_id", "activo");

-- CreateIndex
CREATE INDEX "insumo_categoria_id_idx" ON "insumo"("categoria_id");

-- CreateIndex
CREATE UNIQUE INDEX "insumo_empresa_id_nombre_key" ON "insumo"("empresa_id", "nombre");

-- CreateIndex
CREATE UNIQUE INDEX "insumo_empresa_id_codigo_key" ON "insumo"("empresa_id", "codigo");

-- CreateIndex
CREATE INDEX "presentacion_insumo_insumo_id_idx" ON "presentacion_insumo"("insumo_id");

-- CreateIndex
CREATE UNIQUE INDEX "presentacion_insumo_insumo_id_nombre_key" ON "presentacion_insumo"("insumo_id", "nombre");

-- CreateIndex
CREATE INDEX "insumo_sucursal_empresa_id_sucursal_id_idx" ON "insumo_sucursal"("empresa_id", "sucursal_id");

-- AddForeignKey
ALTER TABLE "categoria_insumo" ADD CONSTRAINT "categoria_insumo_empresa_id_fkey" FOREIGN KEY ("empresa_id") REFERENCES "empresa"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "insumo" ADD CONSTRAINT "insumo_empresa_id_fkey" FOREIGN KEY ("empresa_id") REFERENCES "empresa"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "insumo" ADD CONSTRAINT "insumo_categoria_id_fkey" FOREIGN KEY ("categoria_id") REFERENCES "categoria_insumo"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "insumo" ADD CONSTRAINT "insumo_unidad_base_id_fkey" FOREIGN KEY ("unidad_base_id") REFERENCES "unidad_medida"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "presentacion_insumo" ADD CONSTRAINT "presentacion_insumo_insumo_id_fkey" FOREIGN KEY ("insumo_id") REFERENCES "insumo"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "insumo_sucursal" ADD CONSTRAINT "insumo_sucursal_insumo_id_fkey" FOREIGN KEY ("insumo_id") REFERENCES "insumo"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "insumo_sucursal" ADD CONSTRAINT "insumo_sucursal_sucursal_id_fkey" FOREIGN KEY ("sucursal_id") REFERENCES "sucursal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ===========================================================================
-- Agregado a mano: reglas que el schema de Prisma no puede expresar.
-- ===========================================================================

-- Una presentación que trae cero (o menos) no significa nada, y además
-- dividiría por cero al convertir de presentación a unidad base.
ALTER TABLE "presentacion_insumo"
  ADD CONSTRAINT "presentacion_cantidad_positiva" CHECK ("cantidad_base" > 0);

-- UNA sola presentación por defecto por insumo. Índice único PARCIAL: la
-- cláusula WHERE hace que la restricción valga solo para las filas marcadas
-- como default; sin ella, un insumo no podría tener dos presentaciones.
CREATE UNIQUE INDEX "presentacion_una_default_por_insumo"
  ON "presentacion_insumo" ("insumo_id")
  WHERE "es_default";

-- Un stock mínimo negativo no tiene sentido.
ALTER TABLE "insumo_sucursal"
  ADD CONSTRAINT "insumo_sucursal_minimo_no_negativo" CHECK ("stock_minimo" >= 0);

-- Y un máximo por debajo del mínimo haría imposible la sugerencia de compra.
ALTER TABLE "insumo_sucursal"
  ADD CONSTRAINT "insumo_sucursal_maximo_coherente"
  CHECK ("stock_maximo" IS NULL OR "stock_maximo" >= "stock_minimo");
