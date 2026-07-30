# Spec S9 — Raw-Material Stores (receipt & issue)

**Status:** Draft — confirm valuation timing and weighbridge input

## Purpose

Get raw materials into stock and issue them to production. Lightweight for commissioning:
enough to feed the batch, not the full purchase→GRN→QC→landed-cost pipeline (that's Phase 2).

## Scope

**In:** RM **receipt** (bulk stock IN), RM **issue** to a production batch (bulk stock OUT,
negative-blocked), and **regrind receipt** (trim ground and returned to stock). Both are
document-numbered.

**Out:** purchase orders, GRN against a PO, quality check/hold, weighted-average landed-cost
valuation — all **Phase 2/3**. Regrind _blending %_ is recorded on the batch (S10), not here.

## Dependencies

- S3 (`lib/stock-ledger.ts` — `post` BULK IN/OUT, negative block), S2 (`nextDocNumber`, audit),
  S5 (RM items), S6 (supplier, optional on a receipt), S8 (issue targets a batch).

## Data model

```
MaterialReceipt   id, companyId, docNo (RCPT/FY/seq), supplierId (nullable), receivedAt,
                  refNote, createdBy
MaterialReceiptLine id, receiptId, itemId, locationId, qtyBase (Decimal), ratePaise (nullable)
MaterialIssue     id, companyId, docNo (ISS/FY/seq), lotId (→ Lot, S10), issuedAt, createdBy
MaterialIssueLine id, issueId, itemId, locationId, qtyBase (Decimal), isRegrind (bool)
```

Each receipt line posts a **BULK IN** (`reason = GRN`); each issue line posts a **BULK OUT**
(`reason = PRODUCTION`, `refType = "MaterialIssue"`, `refId`). Regrind is just an RM `Item`
(e.g. `RM-REGRIND`) received from production trim; `isRegrind` on an issue line marks blend
composition for the batch's regrind-% calc.

## Rules & invariants

1. **Issue is negative-blocked** (S3): you cannot issue more than is in stock at the location.
2. **Both the ledger posting and the document commit in one transaction**; every posting
   writes an audit row (S3/S2).
3. **Document numbers are gapless, FY-wise** (S2). Cancellation only, never delete.
4. **`ratePaise` is captured but not yet used for valuation** — weighted-average landed cost
   is Phase 3. Storing it now avoids a migration.
5. Weights are `Decimal`; quantities in the item's base unit (kg for resin/butane/talc).

## Public surface

- `/stores/receipts` — create a receipt (supplier optional), list. STORES + ADMIN write.
- `/stores/issues` — issue RM to an open batch, list. STORES + PRODUCTION + ADMIN write.
- Server actions: `createReceipt`, `cancelReceipt`, `createIssue`, `cancelIssue` — role-checked
  and audited.

## Acceptance criteria

1. A receipt raises the item's bulk balance by the sum of its lines (both persisted).
2. An issue lowers it; an issue exceeding stock is rejected (negative block), leaving the
   balance unchanged.
3. Cancelling a receipt/issue posts a reversing entry (S3), not a delete.
4. Regrind received and later issued is tracked as an RM item and flagged on the issue line.
5. `npm run check` green (ledger-balance + negative-block tests).

## Open questions

- ⚠️ **Weighbridge vs manual entry** (Phase 0 decision #4). **Default: manual `qtyBase` entry**
  on the receipt/issue; a digital-scale hook can populate it later.
- **Landed-cost valuation** (weighted-average per lot, brief §6.4) — confirm it lands in Phase
  3 costing, ledger stores quantity + optional rate only. **Default: yes.**
- **Regrind item modelling** — one generic `RM-REGRIND`, or per-density regrind grades?
  **Default: one generic item**; split later if density tracking of regrind matters.
