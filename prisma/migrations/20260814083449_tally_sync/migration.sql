-- CreateEnum
CREATE TYPE "TallyEntityType" AS ENUM ('INVOICE', 'RECEIPT');

-- CreateEnum
CREATE TYPE "TallySyncDirection" AS ENUM ('OUT', 'IN');

-- CreateEnum
CREATE TYPE "TallySyncStatus" AS ENUM ('PENDING', 'SENT', 'ACK', 'ERROR', 'SKIPPED');

-- CreateTable
CREATE TABLE "TallySync" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "entityType" "TallyEntityType" NOT NULL,
    "entityId" TEXT,
    "direction" "TallySyncDirection" NOT NULL,
    "status" "TallySyncStatus" NOT NULL DEFAULT 'PENDING',
    "externalRef" TEXT,
    "payloadHash" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TallySync_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CustomerTallyMap" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "tallyLedgerName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CustomerTallyMap_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TallySync_companyId_idx" ON "TallySync"("companyId");

-- CreateIndex
CREATE INDEX "TallySync_companyId_entityType_status_idx" ON "TallySync"("companyId", "entityType", "status");

-- CreateIndex
CREATE INDEX "TallySync_companyId_externalRef_idx" ON "TallySync"("companyId", "externalRef");

-- CreateIndex
CREATE UNIQUE INDEX "CustomerTallyMap_customerId_key" ON "CustomerTallyMap"("customerId");

-- CreateIndex
CREATE INDEX "CustomerTallyMap_companyId_idx" ON "CustomerTallyMap"("companyId");

-- AddForeignKey
ALTER TABLE "TallySync" ADD CONSTRAINT "TallySync_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerTallyMap" ADD CONSTRAINT "CustomerTallyMap_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerTallyMap" ADD CONSTRAINT "CustomerTallyMap_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

