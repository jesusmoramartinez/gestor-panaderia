-- CreateEnum
CREATE TYPE "medio_pago" AS ENUM ('EFECTIVO', 'TRANSFERENCIA', 'MERCADO_PAGO');

-- CreateTable
CREATE TABLE "pago" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "empresa_id" UUID NOT NULL,
    "orden_compra_id" UUID NOT NULL,
    "fecha" TIMESTAMPTZ(6) NOT NULL,
    "monto" DECIMAL(18,4) NOT NULL,
    "medio" "medio_pago" NOT NULL,
    "nota" TEXT,
    "usuario_id" UUID NOT NULL,
    "anulado_at" TIMESTAMPTZ(6),
    "anulado_por_id" UUID,
    "motivo_anulacion" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pago_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "comprobante" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "empresa_id" UUID NOT NULL,
    "pago_id" UUID,
    "recepcion_compra_id" UUID,
    "tipo" TEXT NOT NULL,
    "datos" BYTEA NOT NULL,
    "bytes" INTEGER NOT NULL,
    "usuario_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "comprobante_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "nota_compra" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "empresa_id" UUID NOT NULL,
    "orden_compra_id" UUID NOT NULL,
    "texto" TEXT NOT NULL,
    "usuario_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "nota_compra_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "pago_empresa_id_fecha_idx" ON "pago"("empresa_id", "fecha");

-- CreateIndex
CREATE INDEX "pago_orden_compra_id_idx" ON "pago"("orden_compra_id");

-- CreateIndex
CREATE INDEX "comprobante_pago_id_idx" ON "comprobante"("pago_id");

-- CreateIndex
CREATE INDEX "comprobante_recepcion_compra_id_idx" ON "comprobante"("recepcion_compra_id");

-- CreateIndex
CREATE INDEX "nota_compra_orden_compra_id_idx" ON "nota_compra"("orden_compra_id");

-- AddForeignKey
ALTER TABLE "pago" ADD CONSTRAINT "pago_empresa_id_fkey" FOREIGN KEY ("empresa_id") REFERENCES "empresa"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pago" ADD CONSTRAINT "pago_orden_compra_id_fkey" FOREIGN KEY ("orden_compra_id") REFERENCES "orden_compra"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pago" ADD CONSTRAINT "pago_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pago" ADD CONSTRAINT "pago_anulado_por_id_fkey" FOREIGN KEY ("anulado_por_id") REFERENCES "usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comprobante" ADD CONSTRAINT "comprobante_empresa_id_fkey" FOREIGN KEY ("empresa_id") REFERENCES "empresa"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comprobante" ADD CONSTRAINT "comprobante_pago_id_fkey" FOREIGN KEY ("pago_id") REFERENCES "pago"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comprobante" ADD CONSTRAINT "comprobante_recepcion_compra_id_fkey" FOREIGN KEY ("recepcion_compra_id") REFERENCES "recepcion_compra"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comprobante" ADD CONSTRAINT "comprobante_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "nota_compra" ADD CONSTRAINT "nota_compra_empresa_id_fkey" FOREIGN KEY ("empresa_id") REFERENCES "empresa"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "nota_compra" ADD CONSTRAINT "nota_compra_orden_compra_id_fkey" FOREIGN KEY ("orden_compra_id") REFERENCES "orden_compra"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "nota_compra" ADD CONSTRAINT "nota_compra_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ===========================================================================
-- Reglas que Postgres verifica en cada fila (última línea de defensa: la API
-- ya las valida, pero un bug o un SQL a mano no pueden saltearlas).
-- ===========================================================================

-- Un pago es plata que salió: siempre positiva.
ALTER TABLE "pago"
  ADD CONSTRAINT "pago_monto_positivo" CHECK ("monto" > 0);

-- Anulado del todo o nada: si tiene fecha de anulación, tiene quién y por qué.
ALTER TABLE "pago"
  ADD CONSTRAINT "pago_anulacion_completa" CHECK (
    ("anulado_at" IS NULL AND "anulado_por_id" IS NULL AND "motivo_anulacion" IS NULL)
    OR ("anulado_at" IS NOT NULL AND "anulado_por_id" IS NOT NULL AND "motivo_anulacion" IS NOT NULL)
  );

-- Un comprobante cuelga de UNA sola cosa: de un pago O de una entrega.
ALTER TABLE "comprobante"
  ADD CONSTRAINT "comprobante_de_una_sola_cosa" CHECK (num_nonnulls("pago_id", "recepcion_compra_id") = 1);

-- Solo los tres tipos de imagen que el servidor sabe reconocer, y con tope:
-- 2 MB (el navegador la achica a ~300 KB; esto frena un error, no al usuario).
ALTER TABLE "comprobante"
  ADD CONSTRAINT "comprobante_tipo_imagen" CHECK ("tipo" IN ('image/jpeg', 'image/png', 'image/webp'));
ALTER TABLE "comprobante"
  ADD CONSTRAINT "comprobante_tamano" CHECK ("bytes" > 0 AND "bytes" <= 2097152 AND "bytes" = length("datos"));

ALTER TABLE "nota_compra"
  ADD CONSTRAINT "nota_compra_texto_no_vacio" CHECK (length(btrim("texto")) > 0);

-- ===========================================================================
-- RLS (regla 17): toda tabla nueva lo lleva. Sin políticas: nadie que no sea
-- el dueño de la tabla (la API) ve una fila.
-- ===========================================================================
ALTER TABLE "pago" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "comprobante" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "nota_compra" ENABLE ROW LEVEL SECURITY;
