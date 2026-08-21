-- CreateEnum
CREATE TYPE "EInvoiceStatus" AS ENUM ('NONE', 'GENERATED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "EInvoiceAction" AS ENUM ('GEN_IRN', 'CANCEL_IRN', 'GEN_EWB', 'CANCEL_EWB');

-- CreateEnum
CREATE TYPE "EInvoiceLogStatus" AS ENUM ('OK', 'ERROR');

-- AlterTable
ALTER TABLE "Invoice" ADD COLUMN     "ackDate" TIMESTAMP(3),
ADD COLUMN     "ackNo" TEXT,
ADD COLUMN     "einvoiceStatus" "EInvoiceStatus" NOT NULL DEFAULT 'NONE';

-- CreateTable
CREATE TABLE "EInvoiceLog" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "action" "EInvoiceAction" NOT NULL,
    "provider" TEXT NOT NULL,
    "status" "EInvoiceLogStatus" NOT NULL,
    "requestHash" TEXT NOT NULL,
    "responseRef" TEXT,
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EInvoiceLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "EInvoiceLog_companyId_idx" ON "EInvoiceLog"("companyId");

-- CreateIndex
CREATE INDEX "EInvoiceLog_invoiceId_idx" ON "EInvoiceLog"("invoiceId");

-- AddForeignKey
ALTER TABLE "EInvoiceLog" ADD CONSTRAINT "EInvoiceLog_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EInvoiceLog" ADD CONSTRAINT "EInvoiceLog_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

