# Spec S10 — Production Batch (Lot) Entry

**Status:** Draft — confirm shop-floor entry reality and weight capture

## Purpose

Capture one extrusion run: machine/shift/operator, the RM consumed (with regrind %), the
rolls produced, scrap/trim, and reason-coded downtime. The lot is the root of genealogy and
the source of every KPI (yield, kWh/kg, scrap %, OEE).

## Scope

**In:** `Lot` capture + closing, RM-consumption link, output roll link, scrap/trim capture,
downtime log, and the derived per-lot metrics.

**Out:** creating the rolls themselves and their labels (S11 — S10 calls it), aging transition
(S12), costing roll-up (Phase 3). RM must already be in stock (S9).

## Dependencies

- S8 (machine/shift/operator/downtime), S9 (RM issue), S11 (roll creation), S3 (ledger),
  S5 (target item + `resolveItemAging`), S2 (`nextDocNumber` for `lotNo`, audit).

## Data model

```
Lot          id, companyId, lotNo (LOT/FY/seq), machineId, shiftId, operatorId,
             targetItemId, productionDate, startAt, endAt,
             regrindPct (Decimal, derived from issue lines),
             outputKg (Decimal), scrapKg (Decimal), trimKg (Decimal),
             status (OPEN | CLOSED | CANCELLED), createdBy, createdAt
DowntimeLog  id, lotId, reasonId (→ DowntimeReason), minutes (int), note
```

RM consumption is the `MaterialIssue` rows (S9) whose `lotId` = this lot. Output rolls are
`Roll` rows (S3/S11) whose `lotId` = this lot. `regrindPct` = regrind issue qty ÷ total issue
qty. One continuous run = one machine, one shift, one SKU (CLAUDE.md glossary).

## Rules & invariants

1. **Regrind % is an input attribute**, computed from issue lines flagged `isRegrind`
   (CLAUDE.md) — never a write-off.
2. **kg is the production unit**; every quantity is `Decimal`. Output/scrap/trim in kg.
3. **Closing a lot** finalizes it: rolls are created (S11) in `CURING` with an aging-ready
   date = `productionDate + resolveItemAging(item)`, and each posts a **SERIAL IN** (S3).
   A CLOSED lot is immutable except by cancellation.
4. **Material balance is surfaced, not silently reconciled:** input kg vs (output + scrap +
   trim) kg. The variance is a KPI, not an error (mirrors theoretical-vs-actual weight, CLAUDE.md 4).
5. Every state change writes an audit row.

## Derived metrics (exposed, computed in `lib/`)

- Material yield = outputKg ÷ input kg; scrap % ; regrind % in blend.
- kg/hour = outputKg ÷ run hours (vs machine rated capacity).
- **kWh per kg** — needs a power reading per lot (add `energyKwh` on `Lot`, nullable until a
  meter feeds it) — the brief's single best efficiency signal.
- OEE inputs: downtime minutes (availability), output vs rated (performance), density variance
  / QC (quality) — rolled up in Phase 3.

## Public surface

- `/production/lots` — list, open a lot, add downtime, record output rolls, close/cancel.
  PRODUCTION + ADMIN write.
- Server actions: `openLot`, `addDowntime`, `recordOutput`, `closeLot`, `cancelLot`.

## Acceptance criteria

1. Opening a lot allocates a gapless `lotNo`; closing creates the output rolls in CURING with
   correct aging-ready dates and posts SERIAL INs.
2. `regrindPct` reflects the regrind share of issued RM.
3. Material-balance variance (input vs output+scrap+trim) is computed and shown.
4. A cancelled lot reverses its stock effects (roll cancellations + issue reversals); nothing
   is deleted.
5. `npm run check` green (regrind %, yield, aging-ready-date tests).

## Open questions

- ⚠️ **Shop-floor entry reality** (Phase 0 decision #5). **Default: design for supervisor
  batch-entry at shift end** from paper slips — tablet-friendly, not tablet-dependent.
- ⚠️ **Weight capture**: weighbridge digital output vs manual (decision #4). **Default: manual**
  gross/net entry per roll; scale hook later.
- **Energy reading source** for kWh/kg — manual meter read per lot vs automated. **Default:
  manual `energyKwh` field**, nullable.
- Does a lot map 1:1 to a machine run, or can one run yield multiple SKUs? **Default: 1 lot =
  1 SKU** (glossary); a changeover starts a new lot.
