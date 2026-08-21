-- CreateEnum
CREATE TYPE "SalesOrderSource" AS ENUM ('DESK', 'MOBILE');

-- CreateEnum
CREATE TYPE "MobileSubmissionStatus" AS ENUM ('RECEIVED', 'APPLIED', 'REJECTED', 'SUPERSEDED');

-- AlterTable
ALTER TABLE "SalesOrder" ADD COLUMN     "source" "SalesOrderSource" NOT NULL DEFAULT 'DESK';

-- CreateTable
CREATE TABLE "OrderDraftSubmission" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "clientRequestId" TEXT NOT NULL,
    "submittedById" TEXT,
    "customerId" TEXT NOT NULL,
    "shipToId" TEXT NOT NULL,
    "payloadJson" JSONB NOT NULL,
    "status" "MobileSubmissionStatus" NOT NULL DEFAULT 'RECEIVED',
    "resultSoId" TEXT,
    "priceDeltaJson" JSONB,
    "rejectionReason" TEXT,
    "capturedAt" TIMESTAMP(3),
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrderDraftSubmission_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "OrderDraftSubmission_resultSoId_key" ON "OrderDraftSubmission"("resultSoId");

-- CreateIndex
CREATE INDEX "OrderDraftSubmission_companyId_idx" ON "OrderDraftSubmission"("companyId");

-- CreateIndex
CREATE INDEX "OrderDraftSubmission_companyId_status_idx" ON "OrderDraftSubmission"("companyId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "OrderDraftSubmission_companyId_clientRequestId_key" ON "OrderDraftSubmission"("companyId", "clientRequestId");

-- AddForeignKey
ALTER TABLE "OrderDraftSubmission" ADD CONSTRAINT "OrderDraftSubmission_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderDraftSubmission" ADD CONSTRAINT "OrderDraftSubmission_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderDraftSubmission" ADD CONSTRAINT "OrderDraftSubmission_resultSoId_fkey" FOREIGN KEY ("resultSoId") REFERENCES "SalesOrder"("id") ON DELETE SET NULL ON UPDATE CASCADE;

