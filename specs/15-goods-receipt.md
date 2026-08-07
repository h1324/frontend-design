# Spec S15 — Goods Receipt (GRN) against a PO

**Status:** Draft — confirm relationship to the S9 lightweight receipt

## Purpose

Receive supplier goods against a purchase order (S14): record what physically arrived, post
it into stock **on QC hold**, and update the PO balance. This is the full receiving pipeline
that S9's lightweight `MaterialReceipt` was an interim stand-in for.

## Scope

**In:** GRN header (supplier, PO, docket/vehicle, received-at) + lines (PO line, item, qty
received, weighed qty, location), the **BULK IN posting into a QC-hold state**, PO-balance
update, and per-line accept/short/damage capture. Landed-cost _rate_ captured, valuation
deferred.

**Out:** the QC inspection & disposition itself (S16 — GRN posts to hold, QC releases),
weighted-average landed-cost valuation (Phase 3), the PO (S14), payments (Tally).

## Dependencies

- S14 (`PurchaseOrder` + lines, `qtyReceived`), S9 (`lib/rm-stores` receipt pattern, BULK
  IN), S3 (`post` BULK IN), S16 (QC hold/release), S2 (numbering, audit).

## Data model

```
GoodsReceipt      id, companyId, docNo (GRN/FY/seq), supplierId, poId (nullable for direct GRN),
                  receivedAt, docketNo, vehicleNo, status (POSTED|CANCELLED), createdBy
GoodsReceiptLine  id, grnId, poLineId (nullable), itemId, locationId,
                  qtyReceived (Decimal), qtyAccepted (Decimal, set by S16),
                  ratePaise (BigInt, nullable), qcStatus (PENDING|PASSED|FAILED|PARTIAL),
                  ledgerId (the BULK IN posting)
```

Each line posts a **BULK IN** (`reason = GRN`) into a QC-hold sub-state (a hold location or a
`qcStatus` flag on the balance — see open questions). QC (S16) then moves accepted qty to
free stock and rejected qty out.

## Rules & invariants

1. **Received stock is not issuable until QC passes it** (S16). The GRN makes it physically
   present but on hold — mirrors the curing-vs-available split for RM.
2. **GRN updates the PO line's `qtyReceived`**; over-receipt beyond tolerance is blocked (S14).
3. **Both the posting and the document commit in one transaction**; every posting audits (S3).
4. **Cancel-not-delete**: cancelling a GRN reverses its BULK IN via S3 (refused if the stock
   was already consumed/issued), keeping the number.
5. `ratePaise` captured for landed cost (Phase 3); quantities `Decimal`.

## Public surface

- `/purchasing/grn` — receive against an open PO (prefilled lines), or a direct GRN. STORES +
  ADMIN write.
- `/purchasing/grn/[id]` — detail, QC status per line, cancel path.
- Server actions: `createGRN`, `cancelGRN` — role-checked, audited, transactional with the
  ledger. `createGRN` optionally pulls open PO lines.

## Acceptance criteria

1. A GRN against a PO raises stock **on hold** and increments the PO line's received qty.
2. Received-but-unpassed stock does not appear as issuable RM until S16 passes it.
3. Cancelling reverses the BULK IN (S3) and restores the PO balance; number retained.
4. Over-receipt beyond tolerance is rejected.
5. `npm run check` green (balance + hold + PO-update + cancel-reversal tests).

## Open questions

- ⚠️ **QC-hold mechanism.** A dedicated **QC-hold location** (stock moves hold-loc → free-loc
  on pass) vs a `qcStatus` flag on the balance/roll. **Default: a QC-hold location per
  site** — clean with the existing location-scoped balances and audit; QC release is a
  stock transfer. Confirm.
- ⚠️ **Does S15 supersede S9?** S9's `MaterialReceipt` was the Phase-1 interim. **Default:
  keep S9 for supplier-less/ad-hoc receipts (regrind returns), route PO-based purchasing
  through S15**; do **not** migrate S9 rows. Confirm.
- **Weighbridge capture** — **default: manual gross/net** per S9's decision; scale hook later.
