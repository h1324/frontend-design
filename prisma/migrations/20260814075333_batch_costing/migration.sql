-- CreateEnum
CREATE TYPE "CostRateKind" AS ENUM ('LABOUR', 'OVERHEAD', 'ENERGY');

-- CreateEnum
CREATE TYPE "CostRateBasis" AS ENUM ('PER_KG', 'PER_HOUR', 'PER_KWH', 'PER_ROLL');

-- AlterTable
ALTER TABLE "Roll" ADD COLUMN     "unitCostPaise" BIGINT;

-- CreateTable
CREATE TABLE "CostRate" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "kind" "CostRateKind" NOT NULL,
    "ratePaise" BIGINT NOT NULL,
    "basis" "CostRateBasis" NOT NULL DEFAULT 'PER_KG',
    "effectiveFrom" TIMESTAMP(3) NOT NULL,
    "effectiveTo" TIMESTAMP(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CostRate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LotCost" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "lotId" TEXT NOT NULL,
    "rmCostPaise" BIGINT NOT NULL DEFAULT 0,
    "regrindCreditPaise" BIGINT NOT NULL DEFAULT 0,
    "energyCostPaise" BIGINT NOT NULL DEFAULT 0,
    "labourCostPaise" BIGINT NOT NULL DEFAULT 0,
    "overheadCostPaise" BIGINT NOT NULL DEFAULT 0,
    "totalCostPaise" BIGINT NOT NULL DEFAULT 0,
    "outputKg" DECIMAL(14,3) NOT NULL DEFAULT 0,
    "outputM2" DECIMAL(14,4) NOT NULL DEFAULT 0,
    "costPerKgPaise" BIGINT NOT NULL DEFAULT 0,
    "costPerM2Paise" BIGINT NOT NULL DEFAULT 0,
    "computedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LotCost_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConvertingOrderCost" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "inputCostPaise" BIGINT NOT NULL DEFAULT 0,
    "conversionCostPaise" BIGINT NOT NULL DEFAULT 0,
    "totalCostPaise" BIGINT NOT NULL DEFAULT 0,
    "outputKg" DECIMAL(14,3) NOT NULL DEFAULT 0,
    "costPerKgPaise" BIGINT NOT NULL DEFAULT 0,
    "computedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ConvertingOrderCost_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CostRate_companyId_kind_idx" ON "CostRate"("companyId", "kind");

-- CreateIndex
CREATE UNIQUE INDEX "LotCost_lotId_key" ON "LotCost"("lotId");

-- CreateIndex
CREATE INDEX "LotCost_companyId_idx" ON "LotCost"("companyId");

-- CreateIndex
CREATE UNIQUE INDEX "ConvertingOrderCost_orderId_key" ON "ConvertingOrderCost"("orderId");

-- CreateIndex
CREATE INDEX "ConvertingOrderCost_companyId_idx" ON "ConvertingOrderCost"("companyId");

-- AddForeignKey
ALTER TABLE "CostRate" ADD CONSTRAINT "CostRate_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LotCost" ADD CONSTRAINT "LotCost_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LotCost" ADD CONSTRAINT "LotCost_lotId_fkey" FOREIGN KEY ("lotId") REFERENCES "Lot"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConvertingOrderCost" ADD CONSTRAINT "ConvertingOrderCost_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConvertingOrderCost" ADD CONSTRAINT "ConvertingOrderCost_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "ConvertingOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

