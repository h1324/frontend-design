# Spec S22 — KPI Dashboards & Analytics

**Status:** Draft — confirm the KPI set and whether on-read aggregation is acceptable at plant scale

## Purpose

Give the plant a read-only view of how it is actually running: OEE and downtime, yield and
density variance, production throughput, dispatch/sales, and receivables health — one screen
per audience, in Indian number formatting (lakh/crore, ₹, DD/MM/YYYY). Turns the data the
earlier modules capture into decisions.

## Scope

**In:** aggregation helpers and dashboard pages for **production** (OEE = availability ×
performance × quality, output kg, yield %, regrind %, density variance vs spec), **quality**
(QC pass/fail, reject value), **sales/dispatch** (dispatched kg/m²/₹, top SKUs/customers), and
**receivables** (outstanding + ageing, tier mix). Date-range and machine/customer filters.

**Out:** writing any data (this is purely a read model), predictive/forecasting analytics
(Phase 4), a configurable report builder, exports to external BI tools (a CSV export is the
only egress), and scheduled email reports.

## Dependencies

- S8 (downtime reasons/logs → availability), S10 (`Lot` output, energy, yield inputs), S16 (QC
  results), S13 (invoices → sales), S19 (`customerAgeing`, outstanding), S21 (cost/margin, when
  built). Read-only across all; no new write paths.

## Data model

No new persisted entities in the default (on-read aggregation). Optional, behind an open
question:

```
KpiSnapshot   id, companyId, metric, dimensionJson, periodStart, periodEnd,
              valueNumeric (Decimal), computedAt        // only if nightly pre-aggregation is needed
```

The default is **query-time aggregation** with Prisma `groupBy`/aggregates over existing
tables; `KpiSnapshot` is added only if plant-scale query latency demands pre-computation.

## Rules & invariants

1. **Read-only** — dashboards never mutate; RBAC read on the relevant area gates each panel
   (e.g. receivables panel needs `RECEIVABLES` read).
2. **OEE** = availability (uptime / planned time, from S8 downtime) × performance (actual /
   rated output) × quality (good / total output). Each factor surfaced, not just the product.
3. **Density variance** is a first-class KPI (theoretical vs actual kg, CLAUDE.md rule 4) — the
   spread, never reconciled away.
4. **Money in paise** internally, formatted with Indian grouping (`formatPaise`) at the edge;
   all UOM maths via `lib/uom.ts`.
5. Every KPI is **deterministic and unit-tested** as a pure function over sample rows.

## Public surface

- `/dashboards` — index; `/dashboards/production`, `/dashboards/sales`,
  `/dashboards/receivables` (and `/dashboards/quality`). Each respects the viewer's RBAC.
- `lib/kpi.ts` — pure calculators (`oee`, `yieldPct`, `densityVarianceStats`, `agingMix`, …)
  plus thin async gatherers that feed them from Prisma aggregates. CSV export helper.

## Acceptance criteria

1. OEE and its three factors compute correctly from downtime + output sample data (pure test).
2. Yield %, regrind %, and density-variance stats match hand-worked examples.
3. Sales and receivables panels reconcile with S13 invoices and S19 outstanding respectively.
4. Panels are RBAC-gated; a role without an area's read access does not see that panel.
5. `npm run check` green (KPI pure calculators); dashboards build and render.

## Open questions

- ⚠️ **On-read vs pre-aggregated.** Query-time aggregation, or a nightly `KpiSnapshot`?
  **Default: on-read** at current plant volume; add snapshots only if latency requires. Confirm
  expected data volume.
- ⚠️ **KPI set & targets.** Which KPIs are "top of screen", and do they have targets/RAG
  thresholds? **Default: the set above, no targets** until the plant sets them. Confirm.
- **Rated output for performance** — where does the machine's rated kg/hr come from? **Default:
  a `ratedOutputKgPerHr` field on the machine master (S8), null-tolerant** (performance omitted
  when unknown). Confirm.
