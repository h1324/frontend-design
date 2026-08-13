-- CreateEnum
CREATE TYPE "ReceiptMode" AS ENUM ('CASH', 'BANK', 'UPI', 'CHEQUE', 'ADJUSTMENT');

-- CreateEnum
CREATE TYPE "ReceiptSource" AS ENUM ('MANUAL', 'TALLY');

-- CreateEnum
CREATE TYPE "ReceiptStatus" AS ENUM ('POSTED', 'CANCELLED');

-- AlterTable
ALTER TABLE "Invoice" ADD COLUMN     "amountSettledPaise" BIGINT NOT NULL DEFAULT 0,
ADD COLUMN     "dueDate" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "Receipt" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "docNo" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "mode" "ReceiptMode" NOT NULL DEFAULT 'BANK',
    "amountPaise" BIGINT NOT NULL,
    "reference" TEXT,
    "source" "ReceiptSource" NOT NULL DEFAULT 'MANUAL',
    "status" "ReceiptStatus" NOT NULL DEFAULT 'POSTED',
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Receipt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReceiptAllocation" (
    "id" TEXT NOT NULL,
    "receiptId" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "amountPaise" BIGINT NOT NULL,

    CONSTRAINT "ReceiptAllocation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Receipt_companyId_idx" ON "Receipt"("companyId");

-- CreateIndex
CREATE INDEX "Receipt_companyId_customerId_idx" ON "Receipt"("companyId", "customerId");

-- CreateIndex
CREATE UNIQUE INDEX "Receipt_companyId_docNo_key" ON "Receipt"("companyId", "docNo");

-- CreateIndex
CREATE INDEX "ReceiptAllocation_receiptId_idx" ON "ReceiptAllocation"("receiptId");

-- CreateIndex
CREATE INDEX "ReceiptAllocation_invoiceId_idx" ON "ReceiptAllocation"("invoiceId");

-- CreateIndex
CREATE UNIQUE INDEX "ReceiptAllocation_receiptId_invoiceId_key" ON "ReceiptAllocation"("receiptId", "invoiceId");

-- AddForeignKey
ALTER TABLE "Receipt" ADD CONSTRAINT "Receipt_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Receipt" ADD CONSTRAINT "Receipt_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReceiptAllocation" ADD CONSTRAINT "ReceiptAllocation_receiptId_fkey" FOREIGN KEY ("receiptId") REFERENCES "Receipt"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReceiptAllocation" ADD CONSTRAINT "ReceiptAllocation_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

