-- CreateEnum
CREATE TYPE "tipo_motivo" AS ENUM ('MERMA', 'AJUSTE', 'CONSUMO');

-- CreateEnum
CREATE TYPE "tipo_movimiento" AS ENUM ('SALDO_INICIAL', 'COMPRA', 'CONSUMO', 'MERMA', 'AJUSTE', 'TRANSFERENCIA_SALIDA', 'TRANSFERENCIA_ENTRADA', 'REVERSA');

-- AlterEnum
ALTER TYPE "accion_auditoria" ADD VALUE 'FORZAR_STOCK_NEGATIVO';

-- CreateTable
CREATE TABLE "motivo_movimiento" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "empresa_id" UUID NOT NULL,
    "tipo_aplicable" "tipo_motivo" NOT NULL,
    "nombre" TEXT NOT NULL,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "motivo_movimiento_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "movimiento_stock" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "empresa_id" UUID NOT NULL,
    "sucursal_id" UUID NOT NULL,
    "insumo_id" UUID NOT NULL,
    "tipo" "tipo_movimiento" NOT NULL,
    "cantidad_base" DECIMAL(18,6) NOT NULL,
    "cantidad_ingresada" DECIMAL(18,6) NOT NULL,
    "unidad_ingresada_id" UUID NOT NULL,
    "factor_conversion" DECIMAL(20,10) NOT NULL,
    "costo_unitario" DECIMAL(18,4),
    "fecha" TIMESTAMPTZ(6) NOT NULL,
    "usuario_id" UUID NOT NULL,
    "motivo_id" UUID,
    "notas" TEXT,
    "operacion_id" UUID NOT NULL,
    "revierte_a_id" UUID,
    "forzado" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "movimiento_stock_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "motivo_movimiento_empresa_id_tipo_aplicable_idx" ON "motivo_movimiento"("empresa_id", "tipo_aplicable");

-- CreateIndex
CREATE UNIQUE INDEX "motivo_movimiento_empresa_id_tipo_aplicable_nombre_key" ON "motivo_movimiento"("empresa_id", "tipo_aplicable", "nombre");

-- CreateIndex
CREATE UNIQUE INDEX "movimiento_stock_revierte_a_id_key" ON "movimiento_stock"("revierte_a_id");

-- CreateIndex
CREATE INDEX "movimiento_stock_empresa_id_sucursal_id_insumo_id_fecha_idx" ON "movimiento_stock"("empresa_id", "sucursal_id", "insumo_id", "fecha");

-- CreateIndex
CREATE INDEX "movimiento_stock_empresa_id_insumo_id_fecha_idx" ON "movimiento_stock"("empresa_id", "insumo_id", "fecha");

-- CreateIndex
CREATE INDEX "movimiento_stock_operacion_id_idx" ON "movimiento_stock"("operacion_id");

-- AddForeignKey
ALTER TABLE "motivo_movimiento" ADD CONSTRAINT "motivo_movimiento_empresa_id_fkey" FOREIGN KEY ("empresa_id") REFERENCES "empresa"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "movimiento_stock" ADD CONSTRAINT "movimiento_stock_empresa_id_fkey" FOREIGN KEY ("empresa_id") REFERENCES "empresa"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "movimiento_stock" ADD CONSTRAINT "movimiento_stock_sucursal_id_fkey" FOREIGN KEY ("sucursal_id") REFERENCES "sucursal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "movimiento_stock" ADD CONSTRAINT "movimiento_stock_insumo_id_fkey" FOREIGN KEY ("insumo_id") REFERENCES "insumo"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "movimiento_stock" ADD CONSTRAINT "movimiento_stock_unidad_ingresada_id_fkey" FOREIGN KEY ("unidad_ingresada_id") REFERENCES "unidad_medida"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "movimiento_stock" ADD CONSTRAINT "movimiento_stock_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "movimiento_stock" ADD CONSTRAINT "movimiento_stock_motivo_id_fkey" FOREIGN KEY ("motivo_id") REFERENCES "motivo_movimiento"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "movimiento_stock" ADD CONSTRAINT "movimiento_stock_revierte_a_id_fkey" FOREIGN KEY ("revierte_a_id") REFERENCES "movimiento_stock"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ===========================================================================
-- Agregado a mano: los invariantes del kardex.
--
-- Un CHECK es una regla que Postgres verifica en CADA inserción. Es la última
-- línea de defensa, por debajo de Zod y de las reglas del servicio: tres capas
-- de validación, cada una por si falla la anterior. Si un bug futuro se saltea
-- el servicio, acá la base dice no y la fila imposible no entra.
-- ===========================================================================

-- 1) Un movimiento de cero no significa nada: ni entró ni salió nada.
ALTER TABLE "movimiento_stock"
  ADD CONSTRAINT "movimiento_cantidad_no_cero" CHECK ("cantidad_base" <> 0);

-- 2) EL SIGNO TIENE QUE COINCIDIR CON EL TIPO.
--
-- Es el invariante central del kardex. Como el saldo es SUM(cantidad_base), un
-- consumo guardado en positivo no daría un error: sumaría stock en silencio, y
-- te enterarías meses después por un número que no cuadra.
--
-- AJUSTE y REVERSA admiten los dos signos porque por naturaleza van en
-- cualquier dirección: un conteo puede sobrar o faltar, y una reversa tiene el
-- signo opuesto al movimiento que anula.
ALTER TABLE "movimiento_stock"
  ADD CONSTRAINT "movimiento_signo_segun_tipo" CHECK (
    ("tipo" IN ('COMPRA', 'TRANSFERENCIA_ENTRADA', 'SALDO_INICIAL') AND "cantidad_base" > 0) OR
    ("tipo" IN ('CONSUMO', 'MERMA', 'TRANSFERENCIA_SALIDA')         AND "cantidad_base" < 0) OR
    ("tipo" IN ('AJUSTE', 'REVERSA')                                AND "cantidad_base" <> 0)
  );

-- 3) La cantidad que tipeó la persona NO lleva signo: el signo lo pone el tipo
--    del movimiento. Si alguien escribe "-5 kg" de consumo, es un error de
--    carga, no una entrada.
ALTER TABLE "movimiento_stock"
  ADD CONSTRAINT "movimiento_cantidad_ingresada_positiva" CHECK ("cantidad_ingresada" > 0);

-- 4) Un factor cero o negativo haría imposible la conversión (o la invertiría).
ALTER TABLE "movimiento_stock"
  ADD CONSTRAINT "movimiento_factor_positivo" CHECK ("factor_conversion" > 0);

-- 5) Un costo negativo no existe. Cero sí (una muestra, una bonificación).
ALTER TABLE "movimiento_stock"
  ADD CONSTRAINT "movimiento_costo_no_negativo"
  CHECK ("costo_unitario" IS NULL OR "costo_unitario" >= 0);

-- 6) Una reversa, y SOLO una reversa, apunta a otro movimiento.
--    Sin esto, un CONSUMO podría llevar revierte_a_id y ocupar el lugar de la
--    reversa de otro movimiento (el UNIQUE), dejándolo imposible de anular.
ALTER TABLE "movimiento_stock"
  ADD CONSTRAINT "movimiento_revierte_solo_reversa"
  CHECK (("revierte_a_id" IS NULL) OR ("tipo" = 'REVERSA'));

-- 7) Un movimiento no se puede revertir a sí mismo.
ALTER TABLE "movimiento_stock"
  ADD CONSTRAINT "movimiento_no_se_revierte_a_si_mismo"
  CHECK ("revierte_a_id" IS NULL OR "revierte_a_id" <> "id");

-- NOTA sobre lo que NO se puede poner acá: "la fecha no puede ser futura".
-- Un CHECK solo admite funciones INMUTABLES (que para la misma entrada siempre
-- dan el mismo resultado), y now() no lo es. Esa regla vive en el servicio.
