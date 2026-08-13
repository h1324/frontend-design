-- CreateEnum
CREATE TYPE "QcLineStatus" AS ENUM ('PENDING', 'PASSED', 'FAILED', 'PARTIAL');

-- AlterTable
ALTER TABLE "Location" ADD COLUMN     "isQcHold" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "GoodsReceipt" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "docNo" TEXT NOT NULL,
    "supplierId" TEXT,
    "poId" TEXT,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "docketNo" TEXT,
    "vehicleNo" TEXT,
    "status" "MaterialDocStatus" NOT NULL DEFAULT 'POSTED',
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GoodsReceipt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GoodsReceiptLine" (
    "id" TEXT NOT NULL,
    "grnId" TEXT NOT NULL,
    "poLineId" TEXT,
    "itemId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "qtyReceived" DECIMAL(14,3) NOT NULL,
    "qtyAccepted" DECIMAL(14,3) NOT NULL DEFAULT 0,
    "ratePaise" BIGINT,
    "qcStatus" "QcLineStatus" NOT NULL DEFAULT 'PENDING',
    "ledgerId" TEXT,

    CONSTRAINT "GoodsReceiptLine_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "GoodsReceipt_companyId_idx" ON "GoodsReceipt"("companyId");

-- CreateIndex
CREATE INDEX "GoodsReceipt_companyId_status_idx" ON "GoodsReceipt"("companyId", "status");

-- CreateIndex
CREATE INDEX "GoodsReceipt_poId_idx" ON "GoodsReceipt"("poId");

-- CreateIndex
CREATE UNIQUE INDEX "GoodsReceipt_companyId_docNo_key" ON "GoodsReceipt"("companyId", "docNo");

-- CreateIndex
CREATE INDEX "GoodsReceiptLine_grnId_idx" ON "GoodsReceiptLine"("grnId");

-- CreateIndex
CREATE INDEX "GoodsReceiptLine_poLineId_idx" ON "GoodsReceiptLine"("poLineId");

-- CreateIndex
CREATE INDEX "GoodsReceiptLine_itemId_idx" ON "GoodsReceiptLine"("itemId");

-- AddForeignKey
ALTER TABLE "GoodsReceipt" ADD CONSTRAINT "GoodsReceipt_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GoodsReceipt" ADD CONSTRAINT "GoodsReceipt_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GoodsReceipt" ADD CONSTRAINT "GoodsReceipt_poId_fkey" FOREIGN KEY ("poId") REFERENCES "PurchaseOrder"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GoodsReceiptLine" ADD CONSTRAINT "GoodsReceiptLine_grnId_fkey" FOREIGN KEY ("grnId") REFERENCES "GoodsReceipt"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GoodsReceiptLine" ADD CONSTRAINT "GoodsReceiptLine_poLineId_fkey" FOREIGN KEY ("poLineId") REFERENCES "PurchaseOrderLine"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GoodsReceiptLine" ADD CONSTRAINT "GoodsReceiptLine_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GoodsReceiptLine" ADD CONSTRAINT "GoodsReceiptLine_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

