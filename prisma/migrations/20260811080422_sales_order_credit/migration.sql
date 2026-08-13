-- CreateEnum
CREATE TYPE "SalesOrderStatus" AS ENUM ('DRAFT', 'CONFIRMED', 'PARTIALLY_FULFILLED', 'FULFILLED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "CreditStatus" AS ENUM ('OK', 'BLOCKED', 'OVERRIDDEN');

-- AlterTable
ALTER TABLE "DispatchNote" ADD COLUMN     "salesOrderId" TEXT;

-- CreateTable
CREATE TABLE "SalesOrder" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "docNo" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "shipToId" TEXT NOT NULL,
    "orderDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" "SalesOrderStatus" NOT NULL DEFAULT 'DRAFT',
    "creditStatus" "CreditStatus" NOT NULL DEFAULT 'OK',
    "creditOverrideById" TEXT,
    "creditOverrideReason" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SalesOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SalesOrderLine" (
    "id" TEXT NOT NULL,
    "soId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "qtyOrdered" DECIMAL(14,4) NOT NULL,
    "uom" TEXT NOT NULL,
    "ratePaise" BIGINT NOT NULL,
    "gstRatePct" DECIMAL(5,2) NOT NULL,
    "qtyFulfilled" DECIMAL(14,4) NOT NULL DEFAULT 0,

    CONSTRAINT "SalesOrderLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SalesOrderRoll" (
    "id" TEXT NOT NULL,
    "soId" TEXT NOT NULL,
    "rollId" TEXT NOT NULL,

    CONSTRAINT "SalesOrderRoll_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SalesOrder_companyId_idx" ON "SalesOrder"("companyId");

-- CreateIndex
CREATE INDEX "SalesOrder_companyId_status_idx" ON "SalesOrder"("companyId", "status");

-- CreateIndex
CREATE INDEX "SalesOrder_customerId_idx" ON "SalesOrder"("customerId");

-- CreateIndex
CREATE UNIQUE INDEX "SalesOrder_companyId_docNo_key" ON "SalesOrder"("companyId", "docNo");

-- CreateIndex
CREATE INDEX "SalesOrderLine_soId_idx" ON "SalesOrderLine"("soId");

-- CreateIndex
CREATE INDEX "SalesOrderLine_itemId_idx" ON "SalesOrderLine"("itemId");

-- CreateIndex
CREATE INDEX "SalesOrderRoll_soId_idx" ON "SalesOrderRoll"("soId");

-- CreateIndex
CREATE INDEX "SalesOrderRoll_rollId_idx" ON "SalesOrderRoll"("rollId");

-- CreateIndex
CREATE UNIQUE INDEX "SalesOrderRoll_soId_rollId_key" ON "SalesOrderRoll"("soId", "rollId");

-- AddForeignKey
ALTER TABLE "DispatchNote" ADD CONSTRAINT "DispatchNote_salesOrderId_fkey" FOREIGN KEY ("salesOrderId") REFERENCES "SalesOrder"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesOrder" ADD CONSTRAINT "SalesOrder_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesOrder" ADD CONSTRAINT "SalesOrder_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesOrder" ADD CONSTRAINT "SalesOrder_shipToId_fkey" FOREIGN KEY ("shipToId") REFERENCES "ShipToAddress"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesOrderLine" ADD CONSTRAINT "SalesOrderLine_soId_fkey" FOREIGN KEY ("soId") REFERENCES "SalesOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesOrderLine" ADD CONSTRAINT "SalesOrderLine_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesOrderRoll" ADD CONSTRAINT "SalesOrderRoll_soId_fkey" FOREIGN KEY ("soId") REFERENCES "SalesOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesOrderRoll" ADD CONSTRAINT "SalesOrderRoll_rollId_fkey" FOREIGN KEY ("rollId") REFERENCES "Roll"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

