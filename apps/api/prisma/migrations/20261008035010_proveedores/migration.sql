-- CreateTable
CREATE TABLE "proveedor" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "empresa_id" UUID NOT NULL,
    "nombre" TEXT NOT NULL,
    "razon_social" TEXT,
    "cuit" TEXT,
    "email" TEXT,
    "telefono" TEXT,
    "direccion" TEXT,
    "contacto_nombre" TEXT,
    "dias_entrega" INTEGER,
    "notas" TEXT,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "proveedor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "proveedor_insumo" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "empresa_id" UUID NOT NULL,
    "proveedor_id" UUID NOT NULL,
    "insumo_id" UUID NOT NULL,
    "presentacion_id" UUID,
    "codigo_proveedor" TEXT,
    "ultimo_precio" DECIMAL(18,4),
    "ultimo_precio_at" TIMESTAMPTZ(6),
    "es_preferido" BOOLEAN NOT NULL DEFAULT false,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "proveedor_insumo_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "proveedor_empresa_id_activo_idx" ON "proveedor"("empresa_id", "activo");

-- CreateIndex
CREATE UNIQUE INDEX "proveedor_empresa_id_nombre_key" ON "proveedor"("empresa_id", "nombre");

-- CreateIndex
CREATE INDEX "proveedor_insumo_empresa_id_idx" ON "proveedor_insumo"("empresa_id");

-- CreateIndex
CREATE INDEX "proveedor_insumo_insumo_id_idx" ON "proveedor_insumo"("insumo_id");

-- CreateIndex
CREATE INDEX "proveedor_insumo_presentacion_id_idx" ON "proveedor_insumo"("presentacion_id");

-- CreateIndex
CREATE UNIQUE INDEX "proveedor_insumo_proveedor_id_insumo_id_key" ON "proveedor_insumo"("proveedor_id", "insumo_id");

-- AddForeignKey
ALTER TABLE "proveedor" ADD CONSTRAINT "proveedor_empresa_id_fkey" FOREIGN KEY ("empresa_id") REFERENCES "empresa"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "proveedor_insumo" ADD CONSTRAINT "proveedor_insumo_proveedor_id_fkey" FOREIGN KEY ("proveedor_id") REFERENCES "proveedor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "proveedor_insumo" ADD CONSTRAINT "proveedor_insumo_insumo_id_fkey" FOREIGN KEY ("insumo_id") REFERENCES "insumo"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "proveedor_insumo" ADD CONSTRAINT "proveedor_insumo_presentacion_id_fkey" FOREIGN KEY ("presentacion_id") REFERENCES "presentacion_insumo"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ===========================================================================
-- Agregado a mano: reglas que el schema de Prisma no puede expresar.
-- Son la última línea de defensa, por debajo de Zod y de las reglas del
-- servicio. Si un bug futuro se saltea el servicio, acá la base dice no.
-- ===========================================================================

-- UN SOLO proveedor preferido por insumo. Índice único PARCIAL: la cláusula
-- WHERE hace que la restricción valga solo para las filas marcadas como
-- preferidas, así un insumo puede tener cinco proveedores y un solo preferido.
-- (Mismo patrón que presentacion_una_default_por_insumo.)
CREATE UNIQUE INDEX "proveedor_insumo_un_preferido_por_insumo"
  ON "proveedor_insumo" ("insumo_id")
  WHERE "es_preferido";

-- Una relación desactivada no puede seguir siendo la preferida: la vista de
-- reposición agruparía la compra bajo un proveedor al que ya no le compramos.
ALTER TABLE "proveedor_insumo"
  ADD CONSTRAINT "proveedor_insumo_preferido_activo"
  CHECK (NOT "es_preferido" OR "activo");

-- Un precio negativo no existe. Cero sí: una bonificación o una muestra.
ALTER TABLE "proveedor_insumo"
  ADD CONSTRAINT "proveedor_insumo_precio_no_negativo"
  CHECK ("ultimo_precio" IS NULL OR "ultimo_precio" >= 0);

-- El precio y su fecha viajan juntos o no viajan. Con inflación, un precio sin
-- fecha no se puede comparar con nada, y una fecha sin precio no dice nada.
ALTER TABLE "proveedor_insumo"
  ADD CONSTRAINT "proveedor_insumo_precio_con_fecha"
  CHECK (("ultimo_precio" IS NULL) = ("ultimo_precio_at" IS NULL));

-- Los días de entrega son un plazo, no pueden ser negativos. Cero significa
-- "entrega en el día", que es distinto de null ("no sabemos cuánto tarda").
ALTER TABLE "proveedor"
  ADD CONSTRAINT "proveedor_dias_entrega_no_negativo"
  CHECK ("dias_entrega" IS NULL OR "dias_entrega" >= 0);
