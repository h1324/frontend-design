# Spec S28 — Predictive Reorder

**Status:** Draft — forecast method is the open decision; a transparent consumption model is the default

## Purpose

Stop stockouts of the inputs that halt the line — **butane and masterbatch** get an explicit call-out
in the brief — by turning consumption history into a reorder point and a concrete purchase suggestion.
The brief asks for "reorder-level alerts, especially for butane and masterbatch" and, later,
"predictive reorder." This module does both: a defensible reorder point per item, and a suggested PO
quantity, driven by real consumption, with the human staying in the loop.

## Scope

**In:** per-item **consumption rate** from history (RM issues S9 + batch consumption S10 for inputs;
dispatch S13 for finished-good pull), a **reorder point** = lead-time demand + safety stock, and a
**reorder suggestion** (suggested qty + preferred supplier from S6/S14 history) surfaced as an alert
list and a one-click **draft PO** (S14). Covers RM/consumables (the priority) and optionally FG
replenishment against a target cover.

**Out:** auto-placing POs (suggestions are always human-confirmed — never an automatic buy); demand
planning by customer forecast or seasonality models beyond a moving average (a later refinement, gated
behind the same interface); MRP/BOM explosion; the reorder math living anywhere but its own pure module.

## Dependencies

- S9 (RM issues — input consumption), S10 (batch RM consumption incl. regrind blend), S13 (FG dispatch
  — the pull signal), S6/S14 (supplier + PO history for preferred-supplier and lead-time), S5 (item
  master — `reorderPoint`, `safetyStock`, `leadTimeDays` live here), S22 (`lib/kpi.ts` consumption
  aggregates can be reused), S2 (audit on threshold changes). Money in paise, quantities `Decimal`.

## Data model

```
Item (extend)   reorderPoint (Decimal?), safetyStock (Decimal?), leadTimeDays (Int?),
                reorderPolicy (MANUAL|AUTO_SUGGEST, default AUTO_SUGGEST)
ReorderSuggestion id, companyId, itemId, asOf, onHandQty (Decimal), reorderPoint (Decimal),
                avgDailyConsumption (Decimal), suggestedQty (Decimal),
                preferredSupplierId?, status (OPEN|PO_DRAFTED|DISMISSED|EXPIRED),
                resultPoId?, dismissedReason?, generatedBy
```

`ReorderSuggestion` is a **materialised snapshot** of one run of the calculator, so the number a buyer
acted on is preserved even as consumption keeps moving — the same "snapshot what was decided on"
discipline used for quote cost (S25) and moving-average valuation (S20).

## Rules & invariants

1. **Suggestions are advisory; a human buys.** The module computes reorder points and suggested
   quantities and can pre-fill a **DRAFT** PO (S14), but never confirms or sends one. `AUTO_SUGGEST`
   means "raise an alert," not "auto-purchase."
2. **The reorder math is pure and transparent** (`lib/reorder.ts`): `reorderPoint = avgDailyConsumption
× leadTimeDays + safetyStock`; `suggestedQty` covers a target horizon (default: back up to reorder
   point + one lead-time of cover), floored at a supplier MOQ if known. Every input to a suggestion is
   stored on the row so a buyer can see _why_. No opaque model.
3. **On-hand respects stock states (S3/S12).** Consumption and on-hand exclude what is not really
   available (e.g. QC-hold, curing) so a reorder point is not tripped or masked by unusable stock.
4. **Consumption windows are explicit and bounded.** `avgDailyConsumption` is a trailing moving average
   over a configured window (default 90 days), robust to zero-consumption gaps; the window is a
   parameter, not a magic constant, so the method can be tuned without touching the formula.
5. **Threshold changes audit** (who/what/when/previous on `reorderPoint`/`safetyStock`/`leadTimeDays`),
   and generating a PO from a suggestion links `resultPoId` and marks the suggestion `PO_DRAFTED`.

## Public surface

- `/purchasing/reorder` — the alert board: items at/below reorder point, with on-hand, avg daily
  consumption, days-of-cover, suggested qty and preferred supplier; "draft PO" and "dismiss (reason)".
  STORES/ADMIN write; PURCHASE role if present.
- `/items/[id]` (extend) — reorder-policy fields (point/safety/lead-time) editable by STORES/ADMIN.
- `lib/reorder.ts` — pure `reorderPoint(avgDaily, leadTimeDays, safetyStock)`,
  `avgDailyConsumption(movements, window)`, `suggestedQty(...)`; services `runReorderScan(companyId)`
  (materialises suggestions), `draftPoFromSuggestion` (→ S14), `dismissSuggestion`. A routine can call
  `runReorderScan` on a schedule once confirmed.

## Acceptance criteria

1. `reorderPoint` and `avgDailyConsumption` compute deterministically from movement history over the
   configured window, tolerate zero-consumption gaps, and are unit-tested at boundaries — pure.
2. An item whose available on-hand falls at/below its reorder point produces an `OPEN`
   `ReorderSuggestion` with a suggested qty and preferred supplier; on-hand excludes QC-hold/curing stock.
3. "Draft PO" creates a `DRAFT` S14 PO pre-filled from the suggestion, links `resultPoId`, and marks the
   suggestion `PO_DRAFTED`; nothing is ever auto-confirmed.
4. Threshold edits audit previous values; suggestion snapshots preserve the inputs they were computed
   from.
5. `npm run check` green (reorder-point math, moving-average with gaps, available-on-hand exclusion,
   suggestion→draft-PO).

## Open questions

- ⚠️ **Forecast method.** Trailing moving average (proposed, transparent) or something with trend/
  seasonality (Holt-Winters, etc.)? A model changes explainability and testing materially. **Default:
  trailing moving average over a configurable window, behind a `forecast()` seam** so a richer model can
  drop in later without moving the reorder-point formula. Confirm.
- ⚠️ **Consumption window & safety stock.** What trailing window and what safety-stock basis (fixed qty,
  days-of-cover, or service-level σ)? **Default: 90-day window; safety stock = a fixed per-item Decimal
  (days-of-cover helper offered).** Confirm per item class — butane vs. LDPE behave differently.
- **FG replenishment in or out of v1?** **Default: RM/consumables first (the brief's priority); FG
  make-to-stock suggestions behind the same interface, off by default.** Confirm.
- **Scan cadence.** On-demand only, or a scheduled routine? **Default: on-demand button now; a daily
  routine once the window/safety-stock defaults are confirmed.** Confirm.
