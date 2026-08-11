-- CreateEnum
CREATE TYPE "ConvertingOperation" AS ENUM ('LAMINATION', 'SLITTING', 'BAG_MAKING');

-- AlterTable
ALTER TABLE "Roll" ADD COLUMN     "convertingOrderId" TEXT;

-- CreateTable
CREATE TABLE "ConvertingOrder" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "docNo" TEXT NOT NULL,
    "operation" "ConvertingOperation" NOT NULL,
    "machineId" TEXT NOT NULL,
    "shiftId" TEXT NOT NULL,
    "operatorId" TEXT NOT NULL,
    "targetItemId" TEXT NOT NULL,
    "status" "LotStatus" NOT NULL DEFAULT 'OPEN',
    "inputKg" DECIMAL(14,3) NOT NULL DEFAULT 0,
    "outputKg" DECIMAL(14,3) NOT NULL DEFAULT 0,
    "scrapKg" DECIMAL(14,3) NOT NULL DEFAULT 0,
    "trimKg" DECIMAL(14,3) NOT NULL DEFAULT 0,
    "startedAt" TIMESTAMP(3),
    "endedAt" TIMESTAMP(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ConvertingOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConvertingInput" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "rollId" TEXT NOT NULL,

    CONSTRAINT "ConvertingInput_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ConvertingOrder_companyId_idx" ON "ConvertingOrder"("companyId");

-- CreateIndex
CREATE INDEX "ConvertingOrder_companyId_status_idx" ON "ConvertingOrder"("companyId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ConvertingOrder_companyId_docNo_key" ON "ConvertingOrder"("companyId", "docNo");

-- CreateIndex
CREATE INDEX "ConvertingInput_orderId_idx" ON "ConvertingInput"("orderId");

-- CreateIndex
CREATE INDEX "ConvertingInput_rollId_idx" ON "ConvertingInput"("rollId");

-- CreateIndex
CREATE UNIQUE INDEX "ConvertingInput_orderId_rollId_key" ON "ConvertingInput"("orderId", "rollId");

-- AddForeignKey
ALTER TABLE "Roll" ADD CONSTRAINT "Roll_convertingOrderId_fkey" FOREIGN KEY ("convertingOrderId") REFERENCES "ConvertingOrder"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConvertingOrder" ADD CONSTRAINT "ConvertingOrder_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConvertingOrder" ADD CONSTRAINT "ConvertingOrder_machineId_fkey" FOREIGN KEY ("machineId") REFERENCES "Machine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConvertingOrder" ADD CONSTRAINT "ConvertingOrder_shiftId_fkey" FOREIGN KEY ("shiftId") REFERENCES "Shift"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConvertingOrder" ADD CONSTRAINT "ConvertingOrder_operatorId_fkey" FOREIGN KEY ("operatorId") REFERENCES "Operator"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConvertingOrder" ADD CONSTRAINT "ConvertingOrder_targetItemId_fkey" FOREIGN KEY ("targetItemId") REFERENCES "Item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConvertingInput" ADD CONSTRAINT "ConvertingInput_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "ConvertingOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConvertingInput" ADD CONSTRAINT "ConvertingInput_rollId_fkey" FOREIGN KEY ("rollId") REFERENCES "Roll"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

