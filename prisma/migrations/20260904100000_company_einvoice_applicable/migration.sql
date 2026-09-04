-- E-invoicing (IRN) applicability is keyed on the company's turnover crossing the GST AATO
-- threshold (₹5 cr) — a company-level flag — combined at issue time with a B2B buyer (buyerGstin
-- present). It is NOT a per-invoice value test. Off by default: a new / sub-threshold plant does
-- not generate IRNs until this is turned on (spec S23).
ALTER TABLE "Company" ADD COLUMN "einvoiceApplicable" BOOLEAN NOT NULL DEFAULT false;
