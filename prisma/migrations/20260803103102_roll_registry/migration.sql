-- Roll registry & labels (spec S11): give every roll a human-readable, gapless number and
-- track label prints. There is no barcode/scanning system — the number IS the identifier.

-- AlterTable: add label-print tracking, and rollNo (added nullable first so the backfill
-- below can populate any pre-existing rolls before the NOT NULL + UNIQUE constraints apply).
ALTER TABLE "Roll"
  ADD COLUMN "labelPrintCount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "labelPrintedAt" TIMESTAMP(3),
  ADD COLUMN "rollNo" TEXT;

-- Backfill: before S11 rolls had no number. Give legacy rows a deterministic, unique
-- placeholder derived from their (globally-unique) id, so the constraints below hold.
-- New rolls receive a real R<FY>-<seq> number from the application. On a fresh database
-- this updates zero rows.
UPDATE "Roll" SET "rollNo" = 'R-LEGACY-' || "id" WHERE "rollNo" IS NULL;

ALTER TABLE "Roll" ALTER COLUMN "rollNo" SET NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "Roll_companyId_rollNo_key" ON "Roll"("companyId", "rollNo");
