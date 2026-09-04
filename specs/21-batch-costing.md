# Spec S21 — Batch / Production Costing

**Status:** Built — actual costing, per-kg overhead default (open questions defaulted)

## Purpose

Roll cost up from an extrusion lot (and converting order) to a **cost per kg and per m²** of
output: raw material consumed at landed cost (S20) — **including recovered regrind valued as an
input, not a write-off** — plus energy, labour and overhead. Then compare against the sale price to surface **margin**. This is what makes
density variance and yield financially legible, and it is the reason the COSTING role exists.

## Scope

**In:** costing rates (labour/overhead/energy), a per-lot cost roll-up (RM + energy + labour +
overhead → cost/kg, cost/m²), inheritance of cost through converting (child = parent cost +
conversion cost, genealogy-aware, S17), a per-roll cost snapshot, and a margin view (invoice
sale value − cost of goods on the dispatched rolls).

**Out:** the general ledger / cost-accounting postings (Tally), activity-based costing beyond a
single overhead pool per cost centre, variance accounting against a standard (default is actual
costing — see open questions), budgeting, cash-flow forecasting (Phase 4).

## Dependencies

- S20 (landed cost of RM consumed), S9 (`MaterialIssue` — what RM/regrind a lot consumed),
  S10 (`Lot` — output kg, energy kWh, downtime), S17 (converting parent→child genealogy),
  S13 (invoice sale value for margin), S2 (audit). COSTING area (RBAC, exists).

## Data model

```
CostRate   id, companyId, kind (LABOUR|OVERHEAD|ENERGY), ratePaise (BigInt),
           basis (PER_KG|PER_HOUR|PER_KWH|PER_ROLL), effectiveFrom, effectiveTo (nullable)
LotCost    id, companyId, lotId (unique), rmCostPaise, regrindCostPaise, energyCostPaise,
           labourCostPaise, overheadCostPaise, outputKg (Decimal), outputM2 (Decimal),
           costPerKgPaise, costPerM2Paise, computedAt
Roll       += unitCostPaise (BigInt, snapshot at lot/converting close)
ConvertingOrderCost  id, orderId (unique), inputCostPaise, conversionCostPaise,
           outputKg, costPerKgPaise, computedAt
```

Money in **paise (BigInt)**, quantities `Decimal`. `CostRate` is effective-dated so historical
lots cost at the rate in force then. `LotCost` is recomputed on demand and on lot close; the
per-roll `unitCostPaise` is the allocation of lot cost across its output rolls by weight.

## Rules & invariants

1. **RM cost = Σ (issued qty × item moving-avg cost at issue)** (S20); regrind is an input
   attribute, **valued at its blended landed cost and added like any other RM** — never a
   write-off or a by-product credit (CLAUDE.md glossary). Stored split out as `regrindCostPaise`
   for visibility, but part of the lot total.
2. **Conversion cost = energy (kWh × rate) + labour + overhead**, each from the effective-dated
   `CostRate`; overhead absorbed on the default basis (see open questions).
3. **Cost is allocated to output by actual weight** — `roll.unitCost = lotCost × (rollKg / Σ
outputKg)`. Converting children inherit consumed parents' cost + the order's conversion cost.
4. **Cost per m² = cost per kg × (kg / m²)** using the roll's own dimensions — the three UOMs
   reconcile (CLAUDE.md formulas), all via `lib/uom.ts`.
5. Costing is a **read model over actuals** — it never mutates the stock ledger; recomputes are
   idempotent and audited.

## Public surface

- `/costing/rates` — maintain effective-dated labour/overhead/energy rates. COSTING write.
- `/costing/lots/[id]` — a lot's cost breakdown, cost/kg, cost/m², yield-adjusted.
- `/costing/margin` — dispatched-roll margin (sale value − cost) by customer/SKU/period.
- `lib/costing.ts` — pure `lotCostRollup(...)`, `allocateToRolls(...)`, `costPerM2(...)`;
  services `upsertCostRate`, `computeLotCost`, `computeConvertingCost`, `marginReport`.

## Acceptance criteria

1. A closed lot costs to cost/kg and cost/m² from RM (landed) + energy + labour + overhead,
   using the rate effective on the production date.
2. Per-roll cost allocates by weight and sums back to the lot cost (no lost paise).
3. A converting child's cost = allocated parent cost + conversion cost (genealogy-aware).
4. Margin = invoice sale value − Σ dispatched-roll cost, by customer/SKU.
5. `npm run check` green (roll-up, weight allocation round-trip, effective-dated rate, margin).

## Open questions

- ⚠️ **Actual vs standard costing.** Cost at actual consumed/rates, or against a standard with
  variances? **Default: actual costing** (no standards to maintain yet). Confirm.
- ⚠️ **Overhead absorption basis** — per output kg, per machine-hour, or per kWh? **Default:
  per output kg** via a single overhead `CostRate`. Confirm the plant's basis.
- **Scrap/trim treatment** — cost stays on good output (implicit yield loss) or a separate scrap
  value? **Default: absorbed into good output** (scrap valued at zero); reusable trim re-enters
  cost later as **regrind input** to a subsequent lot, not as a credit on the producing lot.
  Confirm.
- **Energy source** — metered kWh per lot (S10 `energyKwh`) or an allocation when unmetered?
  **Default: use `energyKwh` when present, else a per-kg energy rate.**
