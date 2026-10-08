-- CreateEnum
CREATE TYPE "estado_transferencia" AS ENUM ('ENVIADA', 'RECIBIDA', 'ANULADA');

-- AlterEnum
ALTER TYPE "tipo_documento" ADD VALUE 'TRANSFERENCIA';

-- AlterTable
ALTER TABLE "movimiento_stock" ADD COLUMN     "transferencia_id" UUID;

-- CreateTable
CREATE TABLE "transferencia" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "empresa_id" UUID NOT NULL,
    "sucursal_origen_id" UUID NOT NULL,
    "sucursal_destino_id" UUID NOT NULL,
    "numero" INTEGER NOT NULL,
    "estado" "estado_transferencia" NOT NULL DEFAULT 'ENVIADA',
    "notas" TEXT,
    "fecha_envio" TIMESTAMPTZ(6) NOT NULL,
    "usuario_envio_id" UUID NOT NULL,
    "operacion_envio_id" UUID NOT NULL,
    "fecha_recepcion" TIMESTAMPTZ(6),
    "usuario_recepcion_id" UUID,
    "operacion_recepcion_id" UUID,
    "nota_recepcion" TEXT,
    "anulada_at" TIMESTAMPTZ(6),
    "anulada_por_id" UUID,
    "motivo_anulacion" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "transferencia_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "linea_transferencia" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "empresa_id" UUID NOT NULL,
    "transferencia_id" UUID NOT NULL,
    "insumo_id" UUID NOT NULL,
    "cantidad_ingresada" DECIMAL(18,6) NOT NULL,
    "unidad_ingresada_id" UUID NOT NULL,
    "factor_conversion" DECIMAL(20,10) NOT NULL,
    "cantidad_base_enviada" DECIMAL(18,6) NOT NULL,
    "cantidad_base_recibida" DECIMAL(18,6),
    "costo_unitario" DECIMAL(18,4),

    CONSTRAINT "linea_transferencia_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "transferencia_empresa_id_sucursal_origen_id_estado_idx" ON "transferencia"("empresa_id", "sucursal_origen_id", "estado");

-- CreateIndex
CREATE INDEX "transferencia_empresa_id_sucursal_destino_id_estado_idx" ON "transferencia"("empresa_id", "sucursal_destino_id", "estado");

-- CreateIndex
CREATE UNIQUE INDEX "transferencia_empresa_id_numero_key" ON "transferencia"("empresa_id", "numero");

-- CreateIndex
CREATE INDEX "linea_transferencia_insumo_id_idx" ON "linea_transferencia"("insumo_id");

-- CreateIndex
CREATE UNIQUE INDEX "linea_transferencia_transferencia_id_insumo_id_key" ON "linea_transferencia"("transferencia_id", "insumo_id");

-- CreateIndex
CREATE INDEX "movimiento_stock_transferencia_id_idx" ON "movimiento_stock"("transferencia_id");

-- AddForeignKey
ALTER TABLE "movimiento_stock" ADD CONSTRAINT "movimiento_stock_transferencia_id_fkey" FOREIGN KEY ("transferencia_id") REFERENCES "transferencia"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transferencia" ADD CONSTRAINT "transferencia_empresa_id_fkey" FOREIGN KEY ("empresa_id") REFERENCES "empresa"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transferencia" ADD CONSTRAINT "transferencia_sucursal_origen_id_fkey" FOREIGN KEY ("sucursal_origen_id") REFERENCES "sucursal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transferencia" ADD CONSTRAINT "transferencia_sucursal_destino_id_fkey" FOREIGN KEY ("sucursal_destino_id") REFERENCES "sucursal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transferencia" ADD CONSTRAINT "transferencia_usuario_envio_id_fkey" FOREIGN KEY ("usuario_envio_id") REFERENCES "usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transferencia" ADD CONSTRAINT "transferencia_usuario_recepcion_id_fkey" FOREIGN KEY ("usuario_recepcion_id") REFERENCES "usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transferencia" ADD CONSTRAINT "transferencia_anulada_por_id_fkey" FOREIGN KEY ("anulada_por_id") REFERENCES "usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "linea_transferencia" ADD CONSTRAINT "linea_transferencia_transferencia_id_fkey" FOREIGN KEY ("transferencia_id") REFERENCES "transferencia"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "linea_transferencia" ADD CONSTRAINT "linea_transferencia_insumo_id_fkey" FOREIGN KEY ("insumo_id") REFERENCES "insumo"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "linea_transferencia" ADD CONSTRAINT "linea_transferencia_unidad_ingresada_id_fkey" FOREIGN KEY ("unidad_ingresada_id") REFERENCES "unidad_medida"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ===========================================================================
-- Agregado a mano: los invariantes de las transferencias.
-- ===========================================================================

-- 1) Una transferencia de una sucursal a sí misma no mueve nada: es un error.
--    (Que las dos sucursales sean de la MISMA empresa no se puede expresar con
--    un CHECK, que solo ve la fila: lo controla el servicio, con su test.)
ALTER TABLE "transferencia"
  ADD CONSTRAINT "transferencia_origen_distinto_de_destino"
  CHECK ("sucursal_origen_id" <> "sucursal_destino_id");

ALTER TABLE "transferencia"
  ADD CONSTRAINT "transferencia_numero_positivo" CHECK ("numero" > 0);

-- 2) Los estados son coherentes con sus datos: lo recibido sabe cuándo, quién
--    y con qué operación; lo anulado, cuándo y quién. Van juntos o no van.
ALTER TABLE "transferencia"
  ADD CONSTRAINT "transferencia_recepcion_completa" CHECK (
    ("estado" = 'RECIBIDA') = ("fecha_recepcion" IS NOT NULL) AND
    ("fecha_recepcion" IS NULL) = ("usuario_recepcion_id" IS NULL) AND
    ("fecha_recepcion" IS NULL) = ("operacion_recepcion_id" IS NULL)
  );
ALTER TABLE "transferencia"
  ADD CONSTRAINT "transferencia_anulacion_completa" CHECK (
    ("estado" = 'ANULADA') = ("anulada_at" IS NOT NULL) AND
    ("anulada_at" IS NULL) = ("anulada_por_id" IS NULL)
  );

-- 3) No se recibe antes de enviar.
ALTER TABLE "transferencia"
  ADD CONSTRAINT "transferencia_recibe_despues_de_enviar"
  CHECK ("fecha_recepcion" IS NULL OR "fecha_recepcion" >= "fecha_envio");

-- 4) Cantidades: se envía algo, y se recibe entre cero y lo enviado. Recibir
--    MÁS de lo enviado no tiene sentido físico: si sobró, es un error de carga.
ALTER TABLE "linea_transferencia"
  ADD CONSTRAINT "linea_transferencia_enviada_positiva"
    CHECK ("cantidad_base_enviada" > 0 AND "cantidad_ingresada" > 0 AND "factor_conversion" > 0),
  ADD CONSTRAINT "linea_transferencia_recibida_en_rango"
    CHECK ("cantidad_base_recibida" IS NULL OR
           ("cantidad_base_recibida" >= 0 AND "cantidad_base_recibida" <= "cantidad_base_enviada")),
  ADD CONSTRAINT "linea_transferencia_costo_no_negativo"
    CHECK ("costo_unitario" IS NULL OR "costo_unitario" >= 0);

-- 5) EL INVARIANTE DEL KARDEX: un movimiento de transferencia siempre sabe de
--    qué transferencia viene. Sin esto, una salida suelta "a la otra
--    sucursal" no se podría seguir ni anular desde ningún lado.
ALTER TABLE "movimiento_stock"
  ADD CONSTRAINT "movimiento_transferencia_con_documento" CHECK (
    "tipo" NOT IN ('TRANSFERENCIA_SALIDA', 'TRANSFERENCIA_ENTRADA') OR "transferencia_id" IS NOT NULL
  );
