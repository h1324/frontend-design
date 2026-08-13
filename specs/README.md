# Specs

One markdown file per module. **Read the relevant spec before writing code for that
module. Do not infer a module's requirements from another module's spec or code.**

Specs are the versioned source of requirements — conversations are not. When a
requirement changes, change the spec in the same commit as the code.

## Conventions

- Each spec follows the same template: Status · Purpose · Scope · Dependencies · Data
  model · Rules & invariants · Public API · Acceptance criteria · Open questions.
- **Status** is one of `Draft` (needs decisions), `Ready` (buildable), `Built`,
  `Superseded`.
- Open questions marked ⚠️ block the build; the rest have a stated default and can be
  overridden without reworking the schema.

## Phase 0 build order — **complete ✅**

Each session ended in something committable (tests green + migration applied).

| #   | Spec                                                   | Module                                           | Status |
| --- | ------------------------------------------------------ | ------------------------------------------------ | ------ |
| S0  | [00-scaffold.md](00-scaffold.md)                       | Project scaffold & toolchain                     | Built  |
| S1  | [01-uom-engine.md](01-uom-engine.md)                   | UOM conversion engine (`lib/uom.ts`)             | Built  |
| S2  | [02-foundational-schema.md](02-foundational-schema.md) | Enums, audit log, doc numbering, conventions     | Built  |
| S3  | [03-stock-ledger.md](03-stock-ledger.md)               | Append-only stock ledger (`lib/stock-ledger.ts`) | Built  |
| S4  | [04-auth-rbac.md](04-auth-rbac.md)                     | Authentication & role-based access               | Built  |
| S5  | [05-item-master.md](05-item-master.md)                 | Item master                                      | Built  |
| S6  | [06-supplier-master.md](06-supplier-master.md)         | Supplier master                                  | Built  |
| S7  | [07-customer-master.md](07-customer-master.md)         | Customer master                                  | Built  |

## Phase 1 build order (commissioning day) — **complete ✅**

The hard deadline (brief §8): if roll tracking isn't live from the first production run,
that data is gone permanently. That deadline is met — the full physical flow runs end to
end (RM in → lot → numbered rolls cure → age into availability → pick, dispatch, GST
invoice), every movement on the append-only ledger with audit trail and gapless FY numbers.

| #   | Spec                                                 | Module                                | Status |
| --- | ---------------------------------------------------- | ------------------------------------- | ------ |
| S8  | [08-production-masters.md](08-production-masters.md) | Machine / shift / operator / downtime | Built  |
| S9  | [09-rm-stores.md](09-rm-stores.md)                   | RM receipt & issue                    | Built  |
| S10 | [10-production-batch.md](10-production-batch.md)     | Production batch (lot) entry          | Built  |
| S11 | [11-roll-registry.md](11-roll-registry.md)           | Roll registry & labels (no barcode)   | Built  |
| S12 | [12-aging-queue.md](12-aging-queue.md)               | Aging queue (curing → available)      | Built  |
| S13 | [13-dispatch-invoice.md](13-dispatch-invoice.md)     | Dispatch & tax invoice                | Built  |

## Phase 2 build order (+4 weeks) — **complete**

The "can run on paper for a few weeks" work: close the procurement side, add quality gates,
model converting/genealogy, and put the sales-order + credit + receivables layer over the
direct dispatch built in Phase 1. Built with spec defaults applied where open questions
remained (documented in each spec's Status line) — to be refined as requirements firm up.

| #   | Spec                                                 | Module                                     | Status |
| --- | ---------------------------------------------------- | ------------------------------------------ | ------ |
| S14 | [14-purchase-order.md](14-purchase-order.md)         | Purchase orders (to suppliers)             | Built  |
| S15 | [15-goods-receipt.md](15-goods-receipt.md)           | Goods receipt (GRN) against a PO           | Built  |
| S16 | [16-quality-control.md](16-quality-control.md)       | QC inspection & hold (incoming + finished) | Built  |
| S17 | [17-converting.md](17-converting.md)                 | Converting orders (lamination/slitting)    | Built  |
| S18 | [18-sales-order-credit.md](18-sales-order-credit.md) | Sales order, credit control, customer tier | Built  |
| S19 | [19-receivables.md](19-receivables.md)               | Receivables ageing (credit control)        | Built  |

## Phase 3 build order (+later) — **specs Draft**

Make the numbers real and cross the external boundaries: cost every batch, show the plant how
it is running, and connect statutory compliance (e-invoice/e-way-bill) and the book of record
(Tally). Dependency-ordered — costing first (it feeds margin and dashboards), then the two
integrations. Each spec carries open questions to lock before its session; a `Mock` provider/
connector is the default so nothing is blocked on external credentials.

| #   | Spec                                         | Module                                      | Status |
| --- | -------------------------------------------- | ------------------------------------------- | ------ |
| S20 | [20-landed-cost.md](20-landed-cost.md)       | Landed-cost valuation (GRN charges → cost)  | Draft  |
| S21 | [21-batch-costing.md](21-batch-costing.md)   | Batch/production costing & margin           | Draft  |
| S22 | [22-kpi-dashboards.md](22-kpi-dashboards.md) | KPI dashboards & analytics (OEE, yield, AR) | Draft  |
| S23 | [23-einvoice-eway.md](23-einvoice-eway.md)   | E-invoice (IRN) & e-way-bill APIs           | Draft  |
| S24 | [24-tally-sync.md](24-tally-sync.md)         | Tally sync (invoices out, receipts in)      | Draft  |

Phase 4 (portal, mobile, predictive reorder, cross-entity view) gets its specs later. Sales-side
pre-order work — quotations/enquiries and price contracts (deferred from S18) — is a Phase 3/4
candidate not yet scheduled. See `docs/brief.md` §8.

## Cross-cutting decisions (apply to every spec)

These are settled here so individual specs don't restate them:

1. **`Decimal` everywhere** for weights, dimensions, money — never `float`/`number`.
   Scales are documented per field. (Resolves the CLAUDE.md "Decimal OR integer" choice
   in favour of Decimal, project-wide.)
2. **m² is always derived from measured dimensions**, never back-calculated from actual
   weight. **kg is stored twice**: theoretical (from dimensions × density) and actual
   (weighed). Ledger, valuation, and invoices use **actual** kg.
3. **Every table carries `company_id`** (single entity at launch, but the column exists
   from day one to avoid a painful multi-entity retrofit).
4. **Financial year is April–March.** Document series reset on 1 April.
5. All UOM maths imports `lib/uom.ts`. No inline conversions anywhere.
