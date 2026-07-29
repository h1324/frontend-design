-- CreateEnum
CREATE TYPE "ItemType" AS ENUM ('RAW_MATERIAL', 'WIP_ROLL', 'FINISHED_GOOD', 'CONSUMABLE', 'PACKING');

-- CreateEnum
CREATE TYPE "RollState" AS ENUM ('CURING', 'AVAILABLE', 'ALLOCATED', 'DISPATCHED', 'CONSUMED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "SurfaceTreatment" AS ENUM ('PLAIN', 'ANTI_STATIC', 'LAMINATED', 'PERFORATED');

-- CreateEnum
CREATE TYPE "StockDirection" AS ENUM ('IN', 'OUT');

-- AlterTable
ALTER TABLE "Company" ADD COLUMN     "gstin" TEXT,
ADD COLUMN     "legalName" TEXT;

-- CreateTable
CREATE TABLE "Plant" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "addressJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Plant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "actorUserId" TEXT,
    "beforeJson" JSONB,
    "afterJson" JSONB,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DocSeries" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "docType" TEXT NOT NULL,
    "financialYear" TEXT NOT NULL,
    "prefix" TEXT NOT NULL,
    "nextSeq" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "DocSeries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Plant_companyId_idx" ON "Plant"("companyId");

-- CreateIndex
CREATE UNIQUE INDEX "Plant_companyId_code_key" ON "Plant"("companyId", "code");

-- CreateIndex
CREATE INDEX "AuditLog_companyId_idx" ON "AuditLog"("companyId");

-- CreateIndex
CREATE INDEX "AuditLog_entity_entityId_idx" ON "AuditLog"("entity", "entityId");

-- CreateIndex
CREATE INDEX "AuditLog_at_idx" ON "AuditLog"("at");

-- CreateIndex
CREATE UNIQUE INDEX "DocSeries_companyId_docType_financialYear_key" ON "DocSeries"("companyId", "docType", "financialYear");

-- AddForeignKey
ALTER TABLE "Plant" ADD CONSTRAINT "Plant_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocSeries" ADD CONSTRAINT "DocSeries_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Append-only enforcement: reject UPDATE and DELETE on AuditLog at the database level, so
-- the audit trail cannot be altered even by direct SQL (CLAUDE.md rules 6 & 8). Inserts
-- (including reversing/correction rows) remain allowed.
CREATE OR REPLACE FUNCTION audit_log_append_only() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'AuditLog is append-only: % is not permitted', TG_OP;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER audit_log_append_only
  BEFORE UPDATE OR DELETE ON "AuditLog"
  FOR EACH ROW EXECUTE FUNCTION audit_log_append_only();
