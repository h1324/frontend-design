-- CreateEnum
CREATE TYPE "StockGrain" AS ENUM ('SERIAL', 'BULK');

-- CreateEnum
CREATE TYPE "StockReason" AS ENUM ('PRODUCTION', 'GRN', 'DISPATCH', 'CONVERT_IN', 'CONVERT_OUT', 'ADJUSTMENT', 'REVERSAL');

-- CreateTable
CREATE TABLE "Location" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Location_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Item" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "ItemType" NOT NULL,
    "uomBase" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Item_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Roll" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "lotId" TEXT,
    "locationId" TEXT NOT NULL,
    "state" "RollState" NOT NULL DEFAULT 'CURING',
    "length_m" DECIMAL(12,3) NOT NULL,
    "width_m" DECIMAL(12,3) NOT NULL,
    "layersJson" JSONB NOT NULL,
    "qtyKgTheoretical" DECIMAL(14,3) NOT NULL,
    "qtyKgActual" DECIMAL(14,3) NOT NULL,
    "qtyM2" DECIMAL(14,4) NOT NULL,
    "densityKgM3" DECIMAL(9,3) NOT NULL,
    "agingReadyDate" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Roll_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockBalance" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "qtyBase" DECIMAL(16,3) NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StockBalance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockLedger" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "grain" "StockGrain" NOT NULL,
    "direction" "StockDirection" NOT NULL,
    "reason" "StockReason" NOT NULL,
    "itemId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "rollId" TEXT,
    "qtyBase" DECIMAL(16,3) NOT NULL,
    "qtyKg" DECIMAL(14,3),
    "qtyM2" DECIMAL(14,4),
    "refType" TEXT,
    "refId" TEXT,
    "reversesLedgerId" TEXT,
    "actorUserId" TEXT,

    CONSTRAINT "StockLedger_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Location_companyId_idx" ON "Location"("companyId");

-- CreateIndex
CREATE UNIQUE INDEX "Location_companyId_code_key" ON "Location"("companyId", "code");

-- CreateIndex
CREATE INDEX "Item_companyId_idx" ON "Item"("companyId");

-- CreateIndex
CREATE UNIQUE INDEX "Item_companyId_code_key" ON "Item"("companyId", "code");

-- CreateIndex
CREATE INDEX "Roll_companyId_idx" ON "Roll"("companyId");

-- CreateIndex
CREATE INDEX "Roll_companyId_itemId_state_idx" ON "Roll"("companyId", "itemId", "state");

-- CreateIndex
CREATE INDEX "StockBalance_companyId_idx" ON "StockBalance"("companyId");

-- CreateIndex
CREATE UNIQUE INDEX "StockBalance_companyId_itemId_locationId_key" ON "StockBalance"("companyId", "itemId", "locationId");

-- CreateIndex
CREATE UNIQUE INDEX "StockLedger_reversesLedgerId_key" ON "StockLedger"("reversesLedgerId");

-- CreateIndex
CREATE INDEX "StockLedger_companyId_idx" ON "StockLedger"("companyId");

-- CreateIndex
CREATE INDEX "StockLedger_companyId_itemId_locationId_idx" ON "StockLedger"("companyId", "itemId", "locationId");

-- CreateIndex
CREATE INDEX "StockLedger_rollId_idx" ON "StockLedger"("rollId");

-- AddForeignKey
ALTER TABLE "Location" ADD CONSTRAINT "Location_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Item" ADD CONSTRAINT "Item_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Roll" ADD CONSTRAINT "Roll_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Roll" ADD CONSTRAINT "Roll_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Roll" ADD CONSTRAINT "Roll_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockBalance" ADD CONSTRAINT "StockBalance_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockBalance" ADD CONSTRAINT "StockBalance_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockBalance" ADD CONSTRAINT "StockBalance_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockLedger" ADD CONSTRAINT "StockLedger_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockLedger" ADD CONSTRAINT "StockLedger_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockLedger" ADD CONSTRAINT "StockLedger_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockLedger" ADD CONSTRAINT "StockLedger_rollId_fkey" FOREIGN KEY ("rollId") REFERENCES "Roll"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockLedger" ADD CONSTRAINT "StockLedger_reversesLedgerId_fkey" FOREIGN KEY ("reversesLedgerId") REFERENCES "StockLedger"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockLedger" ADD CONSTRAINT "StockLedger_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Append-only enforcement: reject UPDATE and DELETE on StockLedger at the database level,
-- so the stock journal cannot be altered even by direct SQL (CLAUDE.md rule 6). Inserts
-- (including REVERSAL rows) remain allowed. Corrections are reversing entries, never edits.
CREATE OR REPLACE FUNCTION stock_ledger_append_only() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'StockLedger is append-only: % is not permitted', TG_OP;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER stock_ledger_append_only
  BEFORE UPDATE OR DELETE ON "StockLedger"
  FOR EACH ROW EXECUTE FUNCTION stock_ledger_append_only();
