# Specs

One markdown file per module. **Read the relevant spec before writing code for that
module. Do not infer a module's requirements from another module's spec or code.**

Specs are the versioned source of requirements — conversations are not. When a
requirement changes, change the spec in the same commit as the code.

## Conventions

- Each spec follows the same template: Status · Purpose · Scope · Dependencies · Data
  model · Rules & invariants · Public API · Acceptance criteria · Open questions.
- **Status** is one of `Draft` (needs decisions), `Ready` (buildable), `Built`,
  `Shelved` (deliberately not built yet — a decision, not a gap), `Superseded`.
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

## Phase 3 build order (+later) — **complete**

Make the numbers real and cross the external boundaries: cost every batch, show the plant how
it is running, and connect statutory compliance (e-invoice/e-way-bill) and the book of record
(Tally). Dependency-ordered — costing first (it feeds margin and dashboards), then the two
integrations. Built with spec defaults where open questions remained (documented in each spec's
Status line); a `Mock` provider/connector is the default so nothing is blocked on external
credentials — the real GSP/Tally adapters drop in behind the same interfaces.

| #   | Spec                                         | Module                                      | Status |
| --- | -------------------------------------------- | ------------------------------------------- | ------ |
| S20 | [20-landed-cost.md](20-landed-cost.md)       | Landed-cost valuation (GRN charges → cost)  | Built  |
| S21 | [21-batch-costing.md](21-batch-costing.md)   | Batch/production costing & margin           | Built  |
| S22 | [22-kpi-dashboards.md](22-kpi-dashboards.md) | KPI dashboards & analytics (OEE, yield, AR) | Built  |
| S23 | [23-einvoice-eway.md](23-einvoice-eway.md)   | E-invoice (IRN) & e-way-bill APIs           | Built  |
| S24 | [24-tally-sync.md](24-tally-sync.md)         | Tally sync (invoices out, receipts in)      | Built  |

## Phase 4 build order (later) — **S25/S27 built; S28 draft; S26/S29 shelved**

Beyond the plant floor: the sales-side pre-order layer (quotations/price contracts, deferred from
S18), the field-sales mobile capture surface, and predictive reorder. The two outward/consolidation
specs are shelved — the plant is served fine without them for now.

The decisions are settled (2026-08): **S25** adds order-value discounts on top of qty slabs; **S27**
is internal SALES reps only (rides Auth.js). **S26** (customer portal) is **shelved** — no
customer-facing surface is wanted; customers are handled directly by Sales/Accounts. **S29**
(cross-entity view) is **shelved** — no second entity is planned; `company_id` keeps it a cheap
revival if that changes. **S28** stays Draft: its open questions (forecast method, consumption
window, safety-stock basis) are tuning defaults, not schema-shaping, and can be confirmed at build
time — the one Phase 4 module still open to build.

| #   | Spec                                                   | Module                                      | Status  |
| --- | ------------------------------------------------------ | ------------------------------------------- | ------- |
| S25 | [25-quotations.md](25-quotations.md)                   | Quotations & price contracts                | Built   |
| S26 | [26-customer-portal.md](26-customer-portal.md)         | Customer portal (self-service, read-mostly) | Shelved |
| S27 | [27-mobile-order-taking.md](27-mobile-order-taking.md) | Mobile order-taking (offline-first PWA)     | Built   |
| S28 | [28-predictive-reorder.md](28-predictive-reorder.md)   | Predictive reorder (RM/FG suggestions)      | Draft   |
| S29 | [29-cross-entity-view.md](29-cross-entity-view.md)     | Cross-entity consolidated view (read-only)  | Shelved |

See `docs/brief.md` §8 (Phase 4 line) for the original framing.

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
