-- CreateEnum
CREATE TYPE "QcRefType" AS ENUM ('GRN_LINE', 'ROLL');

-- CreateEnum
CREATE TYPE "QcResult" AS ENUM ('PASS', 'FAIL', 'PARTIAL');

-- CreateEnum
CREATE TYPE "QcMetric" AS ENUM ('DENSITY', 'THICKNESS', 'DIMENSION', 'VISUAL', 'OTHER');

-- AlterEnum
ALTER TYPE "Role" ADD VALUE 'QC';

-- AlterEnum
ALTER TYPE "RollState" ADD VALUE 'REJECTED';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "StockReason" ADD VALUE 'QC_PASS';
ALTER TYPE "StockReason" ADD VALUE 'QC_FAIL';

-- AlterTable
ALTER TABLE "Item" ADD COLUMN     "densityTolerance" DECIMAL(9,3);

-- AlterTable
ALTER TABLE "Location" ADD COLUMN     "isReject" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Roll" ADD COLUMN     "qcInspectedAt" TIMESTAMP(3),
ADD COLUMN     "qcStatus" "QcLineStatus" NOT NULL DEFAULT 'PENDING';

-- CreateTable
CREATE TABLE "QcInspection" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "docNo" TEXT NOT NULL,
    "refType" "QcRefType" NOT NULL,
    "refId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "result" "QcResult" NOT NULL,
    "qtyPassed" DECIMAL(14,3) NOT NULL DEFAULT 0,
    "qtyFailed" DECIMAL(14,3) NOT NULL DEFAULT 0,
    "remarks" TEXT,
    "inspectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "QcInspection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QcReading" (
    "id" TEXT NOT NULL,
    "inspectionId" TEXT NOT NULL,
    "metric" "QcMetric" NOT NULL,
    "value" DECIMAL(14,4),
    "uom" TEXT,
    "withinSpec" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "QcReading_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "QcInspection_companyId_idx" ON "QcInspection"("companyId");

-- CreateIndex
CREATE INDEX "QcInspection_refType_refId_idx" ON "QcInspection"("refType", "refId");

-- CreateIndex
CREATE UNIQUE INDEX "QcInspection_companyId_docNo_key" ON "QcInspection"("companyId", "docNo");

-- CreateIndex
CREATE INDEX "QcReading_inspectionId_idx" ON "QcReading"("inspectionId");

-- AddForeignKey
ALTER TABLE "QcInspection" ADD CONSTRAINT "QcInspection_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QcInspection" ADD CONSTRAINT "QcInspection_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QcReading" ADD CONSTRAINT "QcReading_inspectionId_fkey" FOREIGN KEY ("inspectionId") REFERENCES "QcInspection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

