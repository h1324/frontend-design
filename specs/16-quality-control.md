# Spec S16 — Quality Control (QC)

**Status:** Draft — confirm the finished-goods QC trigger and spec source

## Purpose

Gate stock on quality: inspect incoming RM (from a GRN, S15) and finished rolls (from a lot,
S10/S11), record the result against a spec, and hold/release/reject accordingly — so only
QC-passed material can be issued or dispatched. Density is the defining EPE quality spec
(CLAUDE.md), so finished-roll QC keys off measured density vs the SKU's target band.

## Scope

**In:** a QC inspection record with sampled readings, a pass/fail/partial disposition, the
**hold → release** stock transition (RM: QC-hold location → free; rolls: `QC_HOLD` → available
path), rejection routing, and the density-variance capture that feeds the quality KPI.

**Out:** full LIMS / instrument integration, CAPA workflow, supplier scorecards (Phase 3+),
the aging transition itself (S12 — QC and aging are independent gates a roll must clear).

## Dependencies

- S15 (incoming GRN lines on hold), S10/S11 (finished rolls), S12 (availability gating), S5
  (SKU target density/tolerance), S3 (stock transfer/transition), S2 (numbering, audit).

## Data model

```
QcInspection  id, companyId, docNo (QC/FY/seq), refType (GRN_LINE|ROLL), refId,
              itemId, inspectedAt, inspectedBy,
              result (PASS|FAIL|PARTIAL), qtyPassed (Decimal), qtyFailed (Decimal),
              remarks, createdBy
QcReading     id, inspectionId, metric (DENSITY|THICKNESS|DIMENSION|VISUAL|OTHER),
              value (Decimal, nullable), uom, withinSpec (bool)
```

For a **roll**, QC compares measured density to the SKU's target ± tolerance and records the
variance (theoretical-vs-actual density is a KPI, not an error — CLAUDE.md 4). For a **GRN
line**, `qtyPassed`/`qtyFailed` split the received quantity.

## Rules & invariants

1. **No availability without QC pass.** RM stays on QC-hold until passed; a roll cannot go
   `AVAILABLE` (S12) until QC-passed as well as aged. Both gates are independent.
2. **Disposition moves stock, doesn't delete it**: pass transfers hold→free (RM) or clears the
   roll's QC hold; fail routes to a reject location / `REJECTED` roll state; partial splits.
   Every move posts through S3 and audits.
3. **Readings are recorded, not silently averaged away** — each sampled value is stored with
   its in-spec flag; the density variance is retained as a KPI.
4. **Numbers gapless, FY-wise; cancel-not-delete** (S2).

## Public surface

- `/qc/queue` — items awaiting QC: GRN lines on hold + fresh rolls needing sign-off. QC role
  writes (add QC to the S4 matrix or map to STORES/PRODUCTION — see open questions); ADMIN write.
- `/qc/[id]` — inspection detail with readings and disposition.
- Server actions: `inspectGRNLine`, `inspectRoll`, `disposition` — role-checked, audited,
  transactional with the ledger transitions.

## Acceptance criteria

1. Passing a GRN line moves its accepted qty from hold to free stock; failing routes it to
   reject; partial splits both, all via S3 postings.
2. A roll cannot become AVAILABLE until it is both aged (S12) and QC-passed.
3. Density readings persist with in-spec flags; the density variance is computed.
4. Dispositions are gapless-numbered and audited; nothing is deleted.
5. `npm run check` green (gate + disposition + density-variance tests).

## Open questions

- ⚠️ **QC role.** There is no QC role in the S4 matrix. **Default: add a `QC` role** (write
  on a new QC area, read elsewhere); until then PRODUCTION+STORES may inspect. Confirm.
- ⚠️ **Finished-roll QC trigger** — every roll, or a sample per lot? **Default: per-lot QC
  sign-off** (one inspection covering the lot's rolls) with the option to fail individual
  rolls; 100%-inspection is configurable later. Confirm.
- **Spec source** — target density/tolerance from the `Item` master (S5) vs a per-customer
  spec. **Default: SKU target ± a tolerance field on the item**; customer-specific specs later.
