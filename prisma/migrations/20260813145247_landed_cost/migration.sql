-- CreateEnum
CREATE TYPE "ChargeType" AS ENUM ('FREIGHT', 'DUTY', 'INSURANCE', 'CLEARING', 'OTHER');

-- CreateEnum
CREATE TYPE "ApportionBasis" AS ENUM ('VALUE', 'QTY', 'WEIGHT');

-- AlterTable
ALTER TABLE "GoodsReceiptLine" ADD COLUMN     "landedUnitCostPaise" BIGINT;

-- AlterTable
ALTER TABLE "Item" ADD COLUMN     "costedQtyBase" DECIMAL(16,3) NOT NULL DEFAULT 0,
ADD COLUMN     "movingAvgCostPaise" BIGINT NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "GrnCharge" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "grnId" TEXT NOT NULL,
    "chargeType" "ChargeType" NOT NULL,
    "amountPaise" BIGINT NOT NULL,
    "apportionBasis" "ApportionBasis" NOT NULL DEFAULT 'VALUE',
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GrnCharge_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ItemCostHistory" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "grnLineId" TEXT,
    "asOf" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "qtyIn" DECIMAL(16,3) NOT NULL,
    "unitCostPaise" BIGINT NOT NULL,
    "newMovingAvgPaise" BIGINT NOT NULL,

    CONSTRAINT "ItemCostHistory_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "GrnCharge_companyId_idx" ON "GrnCharge"("companyId");

-- CreateIndex
CREATE INDEX "GrnCharge_grnId_idx" ON "GrnCharge"("grnId");

-- CreateIndex
CREATE INDEX "ItemCostHistory_companyId_itemId_idx" ON "ItemCostHistory"("companyId", "itemId");

-- CreateIndex
CREATE INDEX "ItemCostHistory_grnLineId_idx" ON "ItemCostHistory"("grnLineId");

-- AddForeignKey
ALTER TABLE "GrnCharge" ADD CONSTRAINT "GrnCharge_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GrnCharge" ADD CONSTRAINT "GrnCharge_grnId_fkey" FOREIGN KEY ("grnId") REFERENCES "GoodsReceipt"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ItemCostHistory" ADD CONSTRAINT "ItemCostHistory_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ItemCostHistory" ADD CONSTRAINT "ItemCostHistory_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

