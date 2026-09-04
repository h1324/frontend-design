-- Regrind is a valued INPUT (recovered RM), not a credit/write-off — rename the column to match
-- so the sign is never misread. Data-preserving rename (no production data yet, but safe anyway).
ALTER TABLE "LotCost" RENAME COLUMN "regrindCreditPaise" TO "regrindCostPaise";
