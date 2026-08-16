-- CreateEnum
CREATE TYPE "QuotationStatus" AS ENUM ('DRAFT', 'SENT', 'WON', 'LOST', 'EXPIRED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "PriceContractStatus" AS ENUM ('ACTIVE', 'EXPIRED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "PriceScope" AS ENUM ('CUSTOMER', 'TIER');

-- AlterTable
ALTER TABLE "Item" ADD COLUMN     "listPricePaise" BIGINT;

-- AlterTable
ALTER TABLE "SalesOrder" ADD COLUMN     "orderDiscountPct" DECIMAL(5,2) NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "Quotation" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "docNo" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "shipToId" TEXT,
    "enquiryDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "validUntil" TIMESTAMP(3) NOT NULL,
    "status" "QuotationStatus" NOT NULL DEFAULT 'DRAFT',
    "orderDiscountPct" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "lostReason" TEXT,
    "convertedSoId" TEXT,
    "marginOverrideById" TEXT,
    "marginOverrideReason" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Quotation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QuotationLine" (
    "id" TEXT NOT NULL,
    "quotationId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "qtyQuoted" DECIMAL(14,4) NOT NULL,
    "uom" TEXT NOT NULL,
    "ratePaise" BIGINT NOT NULL,
    "gstRatePct" DECIMAL(5,2) NOT NULL,
    "unitCostPaise" BIGINT NOT NULL DEFAULT 0,

    CONSTRAINT "QuotationLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PriceContract" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "docNo" TEXT NOT NULL,
    "scope" "PriceScope" NOT NULL,
    "customerId" TEXT,
    "tier" "CustomerTier",
    "validFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "validUntil" TIMESTAMP(3),
    "status" "PriceContractStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PriceContract_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PriceContractLine" (
    "id" TEXT NOT NULL,
    "priceContractId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "minQty" DECIMAL(14,4) NOT NULL DEFAULT 0,
    "ratePaise" BIGINT NOT NULL,
    "gstRatePct" DECIMAL(5,2) NOT NULL,

    CONSTRAINT "PriceContractLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ValueDiscountTier" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "scope" "PriceScope" NOT NULL,
    "customerId" TEXT,
    "tier" "CustomerTier",
    "minOrderValuePaise" BIGINT NOT NULL,
    "discountPct" DECIMAL(5,2) NOT NULL,
    "validFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "validUntil" TIMESTAMP(3),
    "status" "PriceContractStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ValueDiscountTier_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Quotation_convertedSoId_key" ON "Quotation"("convertedSoId");

-- CreateIndex
CREATE INDEX "Quotation_companyId_idx" ON "Quotation"("companyId");

-- CreateIndex
CREATE INDEX "Quotation_companyId_status_idx" ON "Quotation"("companyId", "status");

-- CreateIndex
CREATE INDEX "Quotation_customerId_idx" ON "Quotation"("customerId");

-- CreateIndex
CREATE UNIQUE INDEX "Quotation_companyId_docNo_key" ON "Quotation"("companyId", "docNo");

-- CreateIndex
CREATE INDEX "QuotationLine_quotationId_idx" ON "QuotationLine"("quotationId");

-- CreateIndex
CREATE INDEX "QuotationLine_itemId_idx" ON "QuotationLine"("itemId");

-- CreateIndex
CREATE INDEX "PriceContract_companyId_idx" ON "PriceContract"("companyId");

-- CreateIndex
CREATE INDEX "PriceContract_companyId_scope_status_idx" ON "PriceContract"("companyId", "scope", "status");

-- CreateIndex
CREATE INDEX "PriceContract_customerId_idx" ON "PriceContract"("customerId");

-- CreateIndex
CREATE UNIQUE INDEX "PriceContract_companyId_docNo_key" ON "PriceContract"("companyId", "docNo");

-- CreateIndex
CREATE INDEX "PriceContractLine_priceContractId_idx" ON "PriceContractLine"("priceContractId");

-- CreateIndex
CREATE INDEX "PriceContractLine_itemId_idx" ON "PriceContractLine"("itemId");

-- CreateIndex
CREATE INDEX "ValueDiscountTier_companyId_idx" ON "ValueDiscountTier"("companyId");

-- CreateIndex
CREATE INDEX "ValueDiscountTier_companyId_scope_status_idx" ON "ValueDiscountTier"("companyId", "scope", "status");

-- CreateIndex
CREATE INDEX "ValueDiscountTier_customerId_idx" ON "ValueDiscountTier"("customerId");

-- AddForeignKey
ALTER TABLE "Quotation" ADD CONSTRAINT "Quotation_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Quotation" ADD CONSTRAINT "Quotation_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Quotation" ADD CONSTRAINT "Quotation_shipToId_fkey" FOREIGN KEY ("shipToId") REFERENCES "ShipToAddress"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Quotation" ADD CONSTRAINT "Quotation_convertedSoId_fkey" FOREIGN KEY ("convertedSoId") REFERENCES "SalesOrder"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuotationLine" ADD CONSTRAINT "QuotationLine_quotationId_fkey" FOREIGN KEY ("quotationId") REFERENCES "Quotation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuotationLine" ADD CONSTRAINT "QuotationLine_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PriceContract" ADD CONSTRAINT "PriceContract_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PriceContract" ADD CONSTRAINT "PriceContract_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PriceContractLine" ADD CONSTRAINT "PriceContractLine_priceContractId_fkey" FOREIGN KEY ("priceContractId") REFERENCES "PriceContract"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PriceContractLine" ADD CONSTRAINT "PriceContractLine_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ValueDiscountTier" ADD CONSTRAINT "ValueDiscountTier_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ValueDiscountTier" ADD CONSTRAINT "ValueDiscountTier_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

