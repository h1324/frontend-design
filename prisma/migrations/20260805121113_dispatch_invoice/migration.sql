
-- CreateEnum
CREATE TYPE "DispatchStatus" AS ENUM ('OPEN', 'DISPATCHED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "InvoiceStatus" AS ENUM ('DRAFT', 'ISSUED', 'CANCELLED');

-- AlterTable
ALTER TABLE "Item" ADD COLUMN     "gstRatePct" DECIMAL(5,2);

-- CreateTable
CREATE TABLE "DispatchNote" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "docNo" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "shipToId" TEXT NOT NULL,
    "dispatchedAt" TIMESTAMP(3),
    "transporter" TEXT,
    "vehicleNo" TEXT,
    "lrNo" TEXT,
    "status" "DispatchStatus" NOT NULL DEFAULT 'OPEN',
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DispatchNote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DispatchRoll" (
    "id" TEXT NOT NULL,
    "dispatchNoteId" TEXT NOT NULL,
    "rollId" TEXT NOT NULL,

    CONSTRAINT "DispatchRoll_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Invoice" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "docNo" TEXT NOT NULL,
    "dispatchNoteId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "shipToId" TEXT NOT NULL,
    "invoiceDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "placeOfSupplyStateCode" TEXT NOT NULL,
    "taxableValuePaise" BIGINT NOT NULL,
    "cgstPaise" BIGINT NOT NULL DEFAULT 0,
    "sgstPaise" BIGINT NOT NULL DEFAULT 0,
    "igstPaise" BIGINT NOT NULL DEFAULT 0,
    "roundOffPaise" BIGINT NOT NULL DEFAULT 0,
    "totalPaise" BIGINT NOT NULL,
    "irn" TEXT,
    "signedQr" TEXT,
    "ewbNo" TEXT,
    "ewbValidTill" TIMESTAMP(3),
    "status" "InvoiceStatus" NOT NULL DEFAULT 'DRAFT',
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Invoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InvoiceLine" (
    "id" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "hsnCode" TEXT,
    "qtyKg" DECIMAL(14,3) NOT NULL,
    "qtyM2" DECIMAL(14,4) NOT NULL,
    "ratePaise" BIGINT NOT NULL,
    "gstRatePct" DECIMAL(5,2) NOT NULL,
    "taxableValuePaise" BIGINT NOT NULL,
    "cgstPaise" BIGINT NOT NULL DEFAULT 0,
    "sgstPaise" BIGINT NOT NULL DEFAULT 0,
    "igstPaise" BIGINT NOT NULL DEFAULT 0,

    CONSTRAINT "InvoiceLine_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DispatchNote_companyId_idx" ON "DispatchNote"("companyId");

-- CreateIndex
CREATE INDEX "DispatchNote_companyId_status_idx" ON "DispatchNote"("companyId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "DispatchNote_companyId_docNo_key" ON "DispatchNote"("companyId", "docNo");

-- CreateIndex
CREATE INDEX "DispatchRoll_dispatchNoteId_idx" ON "DispatchRoll"("dispatchNoteId");

-- CreateIndex
CREATE INDEX "DispatchRoll_rollId_idx" ON "DispatchRoll"("rollId");

-- CreateIndex
CREATE UNIQUE INDEX "DispatchRoll_dispatchNoteId_rollId_key" ON "DispatchRoll"("dispatchNoteId", "rollId");

-- CreateIndex
CREATE UNIQUE INDEX "Invoice_dispatchNoteId_key" ON "Invoice"("dispatchNoteId");

-- CreateIndex
CREATE INDEX "Invoice_companyId_idx" ON "Invoice"("companyId");

-- CreateIndex
CREATE INDEX "Invoice_companyId_status_idx" ON "Invoice"("companyId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Invoice_companyId_docNo_key" ON "Invoice"("companyId", "docNo");

-- CreateIndex
CREATE INDEX "InvoiceLine_invoiceId_idx" ON "InvoiceLine"("invoiceId");

-- AddForeignKey
ALTER TABLE "DispatchNote" ADD CONSTRAINT "DispatchNote_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DispatchNote" ADD CONSTRAINT "DispatchNote_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DispatchNote" ADD CONSTRAINT "DispatchNote_shipToId_fkey" FOREIGN KEY ("shipToId") REFERENCES "ShipToAddress"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DispatchRoll" ADD CONSTRAINT "DispatchRoll_dispatchNoteId_fkey" FOREIGN KEY ("dispatchNoteId") REFERENCES "DispatchNote"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DispatchRoll" ADD CONSTRAINT "DispatchRoll_rollId_fkey" FOREIGN KEY ("rollId") REFERENCES "Roll"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_dispatchNoteId_fkey" FOREIGN KEY ("dispatchNoteId") REFERENCES "DispatchNote"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_shipToId_fkey" FOREIGN KEY ("shipToId") REFERENCES "ShipToAddress"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoiceLine" ADD CONSTRAINT "InvoiceLine_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoiceLine" ADD CONSTRAINT "InvoiceLine_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

