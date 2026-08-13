# Spec S20 — Landed-Cost Valuation

**Status:** Draft — confirm valuation method (moving weighted-average vs FIFO) and default apportionment basis

## Purpose

Turn a goods receipt (S15) into a true **landed cost** per raw-material unit: the supplier
rate plus its share of freight, duty, insurance and other charges. This is the cost of record
that inventory valuation and production costing (S21) consume — without it, batch cost is
understated by every rupee of inbound logistics. First module of Phase 3 (costing).

## Scope

**In:** capturing per-GRN charges (freight/duty/insurance/other), apportioning them across the
GRN's lines, computing a per-unit landed cost per received line, and maintaining a **moving
weighted-average cost** per RM item that the rest of the system reads. A stock-valuation view
(qty × moving-avg cost) per item/location.

**Out:** the general ledger and inventory GL postings (Tally), FIFO/LIFO lot-level valuation
(default is moving-average — see open questions), production cost roll-up (S21), customs/BOE
document management, multi-currency import settlement (S14 stores `currency`/`fxRate`; actual
FX gain/loss stays in Tally).

## Dependencies

- S15 (`GoodsReceipt` + `GoodsReceiptLine`, `ratePaise` captured for this purpose), S14 (PO
  rate), S9 (RM stock the valuation applies to), S2 (audit). S21 reads the moving-avg cost.

## Data model

```
GrnCharge     id, companyId, grnId, type (FREIGHT|DUTY|INSURANCE|CLEARING|OTHER),
              amountPaise (BigInt), apportionBasis (VALUE|QTY|WEIGHT), note
GoodsReceiptLine  += landedUnitCostPaise (BigInt, maintained)   // supplier rate + apportioned charges, per unit
Item          += movingAvgCostPaise (BigInt, maintained)         // weighted-average landed cost
ItemCostHistory  id, companyId, itemId, grnLineId, asOf, qtyIn (Decimal),
                 unitCostPaise (BigInt), newMovingAvgPaise (BigInt)   // append-only cost audit
```

All money in **paise (BigInt)**; quantities `Decimal`. `movingAvgCost` recomputes on each
receipt: `newAvg = (qtyOnHand·oldAvg + qtyIn·landedUnitCost) / (qtyOnHand + qtyIn)`, integer
paise with documented rounding. `ItemCostHistory` is append-only (mirrors the stock ledger).

## Rules & invariants

1. **Charges apportion to exactly their total** — the sum of a charge's per-line allocations
   equals the charge amount; the rounding remainder lands on the largest line (no lost paise).
2. **Apportionment basis** is per charge: VALUE (line taxable value), QTY (line quantity), or
   WEIGHT (line kg). Default VALUE.
3. **Moving-average is recomputed only on receipt** (goods in), never on issue; issues consume
   at the current average. Cancelling a GRN (S15) reverses its cost-history entry.
4. **Landed cost excludes recoverable GST** (input tax credit is not a cost) — only non-
   creditable duties/charges load onto cost.
5. All money in paise; every recompute writes an `ItemCostHistory` row (audit).

## Public surface

- `/purchasing/grn/[id]` (extend) — add charges to a received GRN and see each line's landed
  unit cost. STORES/ACCOUNTS + ADMIN write.
- `/costing/valuation` — per-item moving-average cost and on-hand stock value. COSTING read.
- `lib/landed-cost.ts` — pure `apportionCharges(lines, charge)` and
  `movingAverage(qtyOnHand, oldAvg, qtyIn, unitCost)`; services `addGrnCharges`,
  `recomputeItemCost`, `itemStockValue`.

## Acceptance criteria

1. Charges apportion across lines to the exact total (remainder placed deterministically);
   per-unit landed cost = supplier rate + apportioned share.
2. Moving-average cost updates correctly on receipt and is stable across many rows (integer
   paise, no drift); cancelling a GRN unwinds it.
3. Stock value = Σ (qty on hand × moving-avg cost) reconciles per item.
4. `npm run check` green (apportionment, moving-average round-trip, cancellation tests).

## Open questions

- ⚠️ **Valuation method.** Moving weighted-average or FIFO by receipt lot? **Default: moving
  weighted-average** (one cost per item, simplest, matches how the plant thinks). Confirm
  before FIFO lot-costing is assumed.
- ⚠️ **Default apportionment basis** — VALUE, QTY, or WEIGHT for a freight bill? **Default:
  VALUE**, overridable per charge. Confirm the plant's convention.
- **Retro-apportionment** when a freight invoice arrives after the GRN is consumed — **default:
  apply prospectively (adjust moving-average on the charge date)**; no back-dated restatement
  of already-issued stock.
