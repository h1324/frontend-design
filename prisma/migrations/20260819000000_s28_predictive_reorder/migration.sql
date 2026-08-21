-- CreateEnum
CREATE TYPE "ReorderPolicy" AS ENUM ('MANUAL', 'AUTO_SUGGEST');
-- CreateEnum
CREATE TYPE "ReorderSuggestionStatus" AS ENUM ('OPEN', 'PO_DRAFTED', 'DISMISSED', 'EXPIRED');
-- AlterTable
ALTER TABLE "Item" ADD COLUMN     "leadTimeDays" INTEGER,
ADD COLUMN     "reorderPoint" DECIMAL(16,3),
ADD COLUMN     "reorderPolicy" "ReorderPolicy" NOT NULL DEFAULT 'AUTO_SUGGEST',
ADD COLUMN     "safetyStock" DECIMAL(16,3);
-- CreateTable
CREATE TABLE "ReorderSuggestion" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "asOf" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "onHandQty" DECIMAL(16,3) NOT NULL,
    "reorderPoint" DECIMAL(16,3) NOT NULL,
    "avgDailyConsumption" DECIMAL(16,4) NOT NULL,
    "suggestedQty" DECIMAL(16,3) NOT NULL,
    "preferredSupplierId" TEXT,
    "status" "ReorderSuggestionStatus" NOT NULL DEFAULT 'OPEN',
    "resultPoId" TEXT,
    "dismissedReason" TEXT,
    "generatedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ReorderSuggestion_pkey" PRIMARY KEY ("id")
);
-- CreateIndex
CREATE INDEX "ReorderSuggestion_companyId_idx" ON "ReorderSuggestion"("companyId");
-- CreateIndex
CREATE INDEX "ReorderSuggestion_companyId_status_idx" ON "ReorderSuggestion"("companyId", "status");
-- CreateIndex
CREATE INDEX "ReorderSuggestion_itemId_idx" ON "ReorderSuggestion"("itemId");
-- AddForeignKey
ALTER TABLE "ReorderSuggestion" ADD CONSTRAINT "ReorderSuggestion_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "ReorderSuggestion" ADD CONSTRAINT "ReorderSuggestion_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "ReorderSuggestion" ADD CONSTRAINT "ReorderSuggestion_preferredSupplierId_fkey" FOREIGN KEY ("preferredSupplierId") REFERENCES "Supplier"("id") ON DELETE SET NULL ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "ReorderSuggestion" ADD CONSTRAINT "ReorderSuggestion_resultPoId_fkey" FOREIGN KEY ("resultPoId") REFERENCES "PurchaseOrder"("id") ON DELETE SET NULL ON UPDATE CASCADE;
