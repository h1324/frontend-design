# EPE Foam ERP — Project Context

Manufacturing operations system for an EPE (expanded polyethylene) foam sheet plant.
Full requirements: `docs/brief.md`. Per-module specs: `specs/`.

**Read the relevant spec in `specs/` before writing code for a module. Do not infer requirements from other modules.**

---

## What this system is and isn't

It handles production, inventory, dispatch and costing. It is **not** an accounting system — TallyPrime remains the statutory book of record. Never build ledgers, trial balance, P&L, or GST return filing here. Invoices sync out to Tally; that's the boundary.

---

## Domain glossary

These terms have specific meanings in this business. Do not substitute generic manufacturing semantics.

| Term               | Meaning                                                                                                                                                       |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **EPE**            | Expanded polyethylene — closed-cell foam extruded from LDPE resin with butane as blowing agent                                                                |
| **Density**        | kg/m³. The defining quality spec of foam, typically 15–45. Two rolls of identical dimensions can differ in weight — that difference _is_ the density variance |
| **Aging / curing** | Mandatory rest period after extrusion while butane diffuses out and air replaces it. Foam is physically present but **not sellable** during this window       |
| **Lot / batch**    | One continuous extrusion run on one machine, one shift, one SKU                                                                                               |
| **Roll**           | A single physical unit of output, individually barcoded and tracked. The atomic inventory unit                                                                |
| **Trim**           | Edge waste from the extrusion line                                                                                                                            |
| **Regrind**        | Trim and scrap that has been ground and re-pelletised, blended back into the input mix. An **input attribute** of a batch, not a write-off                    |
| **Lamination**     | Heat-bonding multiple thin sheets into a thicker product. Consumes parent rolls, produces child rolls                                                         |
| **Slitting**       | Cutting a wide roll into narrower rolls                                                                                                                       |
| **Converting**     | Umbrella term for lamination, slitting, bag-making — any post-extrusion operation                                                                             |
| **Genealogy**      | The parent→child chain from extrusion lot through converting to the dispatched roll. Required for complaint tracing                                           |
| **GSM**            | Grams per square metre — derived, sometimes how customers specify                                                                                             |

---

## Non-negotiable engineering rules

1. **All UOM maths lives in `lib/uom.ts`.** Never calculate weight, area, or density conversions inline anywhere else. Import the module.

2. **Never use `float` or JS `number` for weights, dimensions, or money.** Use `Decimal` (Prisma) or integers in base units — grams, millimetres, paise. Floating-point drift across thousands of stock rows silently corrupts the ledger.

3. **Every stock and transaction row stores both `qty_kg` and `qty_m2`**, plus the dimensional attributes used to derive them. Never one without the other.

4. **Theoretical and actual weight are different columns.** Calculated weight (from dimensions × density) will not match the scale reading. Store both. The variance is a quality KPI, not an error to reconcile away.

5. **Stock availability is time-dependent.** Rolls in `curing` state are not available for dispatch or converting. Availability queries must filter on state and `aging_ready_date`. Overrides are permitted but must be logged with user and reason.

6. **The stock ledger is append-only.** No updates, no deletes. Corrections are reversing entries.

7. **Document numbers are financial-year-wise, gapless, and never deleted.** Cancellation only, with audit trail.

8. **Every stock and financial movement writes an audit row**: who, what, when, previous value.

---

## Core conversion formulas

```
weight_kg = length_m × width_m × (thickness_mm / 1000) × density_kg_per_m3
area_m2   = length_m × width_m
gsm       = thickness_mm × density_kg_per_m3
```

Production is measured in **kg**. Customers order in **metres or m²**. Quality is judged by **density**. All three must reconcile at every point in the system.

---

## Stack

- Next.js (App Router) + TypeScript
- PostgreSQL + Prisma (migrations only — never hand-edit schema)
- Tailwind + shadcn/ui
- Auth.js, role-based: Admin, Production, Stores, Sales, Dispatch, Accounts, Viewer
- Deployed via Docker Compose on an on-premise machine at the plant

Deliberately **not** used: microservices, GraphQL, Kubernetes, ORM-bypassing raw SQL for writes.

---

## Testing

Write tests for: UOM conversions, stock ledger balance invariants, credit-limit enforcement, aging state transitions. Skip UI tests.

Every UOM change requires a passing round-trip test before commit.

---

## Working conventions

- Small commits, conventional commit messages
- One module per session — finish and commit rather than sprawling
- Seed data (`prisma/seed.ts`) uses **real SKUs and real customer names**, not synthetic placeholders. Edge cases like 0.5 mm ultra-thin and multi-layer laminates must appear in seed data
- Ask before introducing a new dependency
- Indian context throughout: GST, GSTIN, HSN, e-way bill, IRN, ₹, DD/MM/YYYY dates, Indian number formatting (lakh/crore) in reports
