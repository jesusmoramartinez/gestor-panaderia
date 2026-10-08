-- CreateEnum
CREATE TYPE "dimension_unidad" AS ENUM ('PESO', 'VOLUMEN', 'UNIDAD');

-- CreateTable
CREATE TABLE "unidad_medida" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "empresa_id" UUID NOT NULL,
    "codigo" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "dimension" "dimension_unidad" NOT NULL,
    "factor_a_base" DECIMAL(20,10) NOT NULL,
    "es_base" BOOLEAN NOT NULL DEFAULT false,
    "activa" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "unidad_medida_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "unidad_medida_empresa_id_idx" ON "unidad_medida"("empresa_id");

-- CreateIndex
CREATE UNIQUE INDEX "unidad_medida_empresa_id_codigo_key" ON "unidad_medida"("empresa_id", "codigo");

-- AddForeignKey
ALTER TABLE "unidad_medida" ADD CONSTRAINT "unidad_medida_empresa_id_fkey" FOREIGN KEY ("empresa_id") REFERENCES "empresa"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ===========================================================================
-- Agregado a mano: reglas que el schema de Prisma no puede expresar.
--
-- Se escriben acá porque la BASE es la última línea de defensa: aunque el
-- código tenga un bug, estos datos imposibles no entran.
-- ===========================================================================

-- Un factor de conversión de cero o negativo no significa nada, y además
-- rompería la división al convertir.
ALTER TABLE "unidad_medida"
  ADD CONSTRAINT "unidad_medida_factor_positivo" CHECK ("factor_a_base" > 0);

-- La unidad BASE de una dimensión es, por definición, la que vale 1.
-- (NOT es_base OR ...) se lee: "si es base, entonces el factor es 1".
ALTER TABLE "unidad_medida"
  ADD CONSTRAINT "unidad_medida_base_factor_uno"
  CHECK (NOT "es_base" OR "factor_a_base" = 1);

-- UNA sola unidad base por dimensión y por empresa.
-- Es un índice único PARCIAL: la cláusula WHERE hace que la restricción valga
-- solo para las filas con es_base = true. Sin el WHERE, no podría haber dos
-- unidades no-base de la misma dimensión, que es justamente lo normal.
CREATE UNIQUE INDEX "unidad_medida_una_base_por_dimension"
  ON "unidad_medida" ("empresa_id", "dimension")
  WHERE "es_base";
