# Spec S14 — Purchase Order

**Status:** Built — `PurchaseOrder` (+ `PurchaseOrderStatus` DRAFT/OPEN/CLOSED/CANCELLED) and
`PurchaseOrderLine` models; money in paise (BigInt), quantities `Decimal`, `currency`/`fxRate`
columns present (default INR) for later imports. `lib/purchasing.ts` — pure helpers
(`lineAmountPaise`, `poCommitmentPaise`, `lineBalance`, `isFullyReceived`) and STORES-write-
gated, audited services: `createPO` (gapless `PO/FY/seq`; line `uom`/`gstRatePct`/description
default from the item, terms from the supplier; created OPEN or DRAFT), `updatePO` (amend
header, replace lines while nothing received, DRAFT→OPEN release), `closePO` (clean full-
receipt close; short-close needs a reason), `cancelPO` (keeps the number; refused once goods
are received), `poBalance` (per-line ordered/received/outstanding + commitment). UI:
`/purchasing/orders` (list + multi-line create) and `/purchasing/orders/[id]` (line balance +
release/close/cancel); home nav link. `qtyReceived` is maintained by S15 (GRN). Locked
open-question defaults: single status flip (no maker/checker), INR-only now, block over-
receipt, freight as a note. Verified: 4 pure + 5 DB tests (gapless numbering, defaults,
commitment, amend/release + post-receipt line lock, short-close-needs-reason, cancel keeps
number + blocked after receipt, role gating), `npm run check` green (171 tests), build OK,
pages render with Indian ₹ grouping.

## Original plan

## Purpose

Raise a purchase order to a supplier for raw materials/consumables so goods receipt (S15)
has a document to receive against, and so committed-but-not-received quantity is visible.
The first module of the procurement side deferred out of Phase 0/1.

## Scope

**In:** PO header (supplier, dates, terms) + lines (item, qty, rate, expected date, tax),
gapless FY numbering, an amendment/close/cancel lifecycle, and a "PO balance" view (ordered
− received, fed by S15).

**Out:** requisitions/indents and approval hierarchies beyond a single status flip (Phase 3
if needed), GRN itself (S15), landed-cost valuation (S15/Phase 3), supplier price contracts.

## Dependencies

- S6 (`Supplier`), S5 (`Item` — HSN, `gstRatePct`, `uomBase`), S2 (`nextDocNumber`, audit,
  gapless FY). S15 reads the PO to receive against it.

## Data model

```
PurchaseOrder     id, companyId, docNo (PO/FY/seq), supplierId, status (DRAFT|OPEN|CLOSED|CANCELLED),
                  orderDate, expectedDate, paymentTerms, deliveryTerms, notes, createdBy
PurchaseOrderLine id, poId, itemId, description, qtyOrdered (Decimal), uom, ratePaise (BigInt),
                  gstRatePct (Decimal), expectedDate (nullable), qtyReceived (Decimal, maintained by S15)
```

Money in **paise (BigInt)**; quantities `Decimal` in the item's base UOM. `qtyReceived` is a
denormalised running total that S15 increments on each GRN line (source of truth remains the
GRN rows).

## Rules & invariants

1. **Document numbers gapless, FY-wise; cancel-not-delete** (S2). A cancelled PO keeps its
   number; amendments are versioned in the audit trail, not by renumbering.
2. **A line's `qtyReceived` never exceeds `qtyOrdered`** unless an over-receipt tolerance is
   allowed (see open questions) — enforced in S15, surfaced here.
3. **PO closes** when every line is fully received, or manually (short-close) with a reason.
4. **Rate is indicative** — the invoice/landed cost of record comes at GRN/invoice time; the
   PO rate drives commitment value only.
5. Every state change writes an audit row.

## Public surface

- `/purchasing/orders` — list, create, amend, close/cancel a PO. STORES + ADMIN write
  (procurement sits with stores in Phase 2; a dedicated PURCHASING role can come later).
- `/purchasing/orders/[id]` — detail with line-level received-vs-ordered balance.
- Server actions: `createPO`, `updatePO`, `closePO`, `cancelPO` — role-checked, audited.

## Acceptance criteria

1. A PO gets a gapless `PO/FY/seq`; lines persist qty/rate/tax in Decimal/paise.
2. PO balance = ordered − received per line, reconciling with S15 GRNs.
3. Cancelling keeps the number; short-close requires a reason; both audited.
4. `npm run check` green (numbering + balance tests).

## Open questions

- ⚠️ **Approval workflow.** Single-step (DRAFT → OPEN by a writer) or a maker/checker
  approval? **Default: single status flip** (DRAFT → OPEN), no separate approver in Phase 2;
  add maker/checker later if audit demands it. Confirm.
- ⚠️ **Multi-currency imports** (butane/masterbatch may be imported). **Default: INR-only**
  in Phase 2; store `currency`+`fxRate` columns now (nullable, default INR) to avoid a
  migration. Confirm whether imports are in scope soon.
- **Over-receipt tolerance** — reject, or allow N% over? **Default: block over-receipt**
  (mirrors the bulk negative-block decision); a per-PO tolerance can be added.
- **Freight/other charges on the PO** — **default: a notes field now**, structured
  landed-cost apportionment is Phase 3 costing.
