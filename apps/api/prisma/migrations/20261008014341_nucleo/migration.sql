-- CreateEnum
CREATE TYPE "rol_usuario" AS ENUM ('DUENO', 'ENCARGADO', 'EMPLEADO');

-- CreateTable
CREATE TABLE "empresa" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "nombre" TEXT NOT NULL,
    "razon_social" TEXT,
    "cuit" TEXT,
    "zona_horaria" TEXT NOT NULL DEFAULT 'America/Argentina/Buenos_Aires',
    "moneda" TEXT NOT NULL DEFAULT 'ARS',
    "costo_incluye_iva" BOOLEAN NOT NULL DEFAULT true,
    "activa" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "empresa_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sucursal" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "empresa_id" UUID NOT NULL,
    "nombre" TEXT NOT NULL,
    "codigo" TEXT NOT NULL,
    "direccion" TEXT,
    "telefono" TEXT,
    "es_central" BOOLEAN NOT NULL DEFAULT false,
    "activa" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sucursal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "usuario" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "empresa_id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "rol" "rol_usuario" NOT NULL,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "ultimo_acceso_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "usuario_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "usuario_sucursal" (
    "usuario_id" UUID NOT NULL,
    "sucursal_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "usuario_sucursal_pkey" PRIMARY KEY ("usuario_id","sucursal_id")
);

-- CreateIndex
CREATE INDEX "sucursal_empresa_id_idx" ON "sucursal"("empresa_id");

-- CreateIndex
CREATE UNIQUE INDEX "sucursal_empresa_id_codigo_key" ON "sucursal"("empresa_id", "codigo");

-- CreateIndex
CREATE UNIQUE INDEX "usuario_email_key" ON "usuario"("email");

-- CreateIndex
CREATE INDEX "usuario_empresa_id_idx" ON "usuario"("empresa_id");

-- CreateIndex
CREATE INDEX "usuario_sucursal_sucursal_id_idx" ON "usuario_sucursal"("sucursal_id");

-- AddForeignKey
ALTER TABLE "sucursal" ADD CONSTRAINT "sucursal_empresa_id_fkey" FOREIGN KEY ("empresa_id") REFERENCES "empresa"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "usuario" ADD CONSTRAINT "usuario_empresa_id_fkey" FOREIGN KEY ("empresa_id") REFERENCES "empresa"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "usuario_sucursal" ADD CONSTRAINT "usuario_sucursal_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuario"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "usuario_sucursal" ADD CONSTRAINT "usuario_sucursal_sucursal_id_fkey" FOREIGN KEY ("sucursal_id") REFERENCES "sucursal"("id") ON DELETE CASCADE ON UPDATE CASCADE;
