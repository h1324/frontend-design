-- AlterTable
ALTER TABLE "Company" ADD COLUMN     "defaultAgingDays" INTEGER NOT NULL DEFAULT 7;

-- AlterTable
ALTER TABLE "Item" ADD COLUMN     "agingDays" INTEGER,
ADD COLUMN     "colour" TEXT,
ADD COLUMN     "density_kg_m3" DECIMAL(9,3),
ADD COLUMN     "grade" TEXT,
ADD COLUMN     "hsnCode" TEXT,
ADD COLUMN     "layerCount" INTEGER,
ADD COLUMN     "reorderLevel" DECIMAL(16,3),
ADD COLUMN     "surfaceTreatment" "SurfaceTreatment",
ADD COLUMN     "thickness_mm" DECIMAL(9,3),
ADD COLUMN     "width_mm" DECIMAL(9,2);

-- CreateIndex
CREATE INDEX "Item_companyId_type_idx" ON "Item"("companyId", "type");
