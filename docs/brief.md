# EPE Foam Unit — ERP Project Brief

**Prepared for:** Build with Claude Code
**Status:** Draft v1 — assumptions marked ⚠️ need confirmation before build starts

---

## 1. Purpose & scope decision

Build a **manufacturing operations system** for the EPE foam sheet unit that covers production, inventory, dispatch and costing — and **integrate with TallyPrime rather than replace it**.

**Why this split matters.** Tally stays the statutory book of record: ledgers, GST returns, balance sheet, CA sign-off. The new system owns everything Tally is bad at — roll-level traceability, kg↔m² conversion, aging/curing inventory, batch costing, shop-floor entry. Invoices and payments sync into Tally; nothing accounting-critical is re-invented.

Trying to build a full accounting stack would triple the scope, create audit risk, and force your CA to learn a system nobody else uses. Don't.

**In scope:** item & customer masters, production batch capture, roll/lot tracking, aging warehouse, converting (lamination/slitting/bag-making), stores & raw material, dispatch + invoice + e-way bill, costing, dashboards.

**Out of scope (v1):** payroll, general ledger, fixed assets, statutory returns, HR. All stay in Tally / existing processes.

---

## 2. Assumptions to confirm ⚠️

Lock these before the first line of code — several change the data model materially.

| # | Assumption | Impact if wrong |
|---|---|---|
| 1 | Single plant, single extrusion line (FLY-250) at commissioning, with a converting section (lamination/slitting) | Multi-line needs machine dimension on every batch |
| 2 | Primary customers = mattress manufacturers buying wide rolls for wrap/protection packaging; secondary = general packaging | Changes SKU cardinality — few high-volume SKUs vs. hundreds |
| 3 | Sales are wholesale/B2B on credit, similar dealer dynamics to Diamond | Drives credit-limit and receivables design |
| 4 | Output sold **by weight (kg)**, specified **by dimensions** (thickness × width × length × density) | This is the core UOM problem — see §5 |
| 5 | Scrap/trim is ground and re-pelletised in-house and blended back as regrind | Needs a closed-loop material flow, not just a scrap write-off |
| 6 | Aging/curing period required before dispatch or lamination (butane diffusion) — ⚠️ confirm days from machine supplier | Determines whether "available stock" ≠ "physical stock" |
| 7 | 15–25 users max, mix of office desktops and shop-floor tablets | Under 50 users means no need for heavy infra |
| 8 | Turnover will cross the e-invoicing threshold — build for IRN from day one | Retrofitting e-invoice later is painful |

---

## 3. Why a foam ERP is different (the three hard problems)

Generic ERP templates fail here for three specific reasons. Solve these well and the rest is standard CRUD.

**a) Dual unit of measure.** Production is measured in kg. Customers order in metres or square metres, and quality is judged by density. Every single transaction — production, stock, sale, invoice — must carry both weight and area, reconciled by a single conversion formula. If this leaks (one screen storing only kg, another only metres) the stock ledger becomes unreconcilable within a month.

**b) Time-gated inventory.** Freshly extruded foam is physically in the warehouse but not sellable until cured. Stock therefore has three states — *curing*, *available*, *allocated* — and availability is a function of the clock, not just quantity. Standard inventory modules have no concept of this.

**c) Closed-loop scrap.** Edge trim and startup waste return to the process as regrind. Regrind percentage in the blend affects density consistency and customer-visible quality, so it must be tracked as an input attribute of each batch, not written off as loss.

---

## 4. Recommended stack

Chosen for Claude Code fluency (dense training data = far fewer iterations) and for a factory environment with unreliable internet.

| Layer | Choice | Rationale |
|---|---|---|
| Framework | **Next.js (App Router) + TypeScript** | One codebase for UI and API; Claude Code is strongest here |
| Database | **PostgreSQL** | Transactional integrity for stock ledgers; free |
| ORM | **Prisma** | Schema-as-code, versioned migrations, readable diffs |
| UI | **Tailwind + shadcn/ui** | Dense data tables, fast to build, accessible defaults |
| Auth | **Auth.js**, role-based | Roles: Admin, Production, Stores, Sales, Dispatch, Accounts, Viewer |
| Hosting | **Mini-PC / NUC at the plant, Docker Compose** | Works when the internet drops; the plant floor cannot stop because a link is down |
| Remote access | **Cloudflare Tunnel** | Office and your phone reach the plant server without a static IP |
| Backup | Nightly `pg_dump` → cloud object storage + weekly offsite copy | Non-negotiable |
| Labels | Thermal printer (TSC/Zebra), ZPL or PDF | Roll barcode labels |
| Scanning | PWA on Android tablets using the camera | Avoids buying dedicated scanners initially |

Deliberately avoided: microservices, Kubernetes, GraphQL, a separate mobile app. All add ceremony without benefit at this size.

---

## 5. The UOM conversion engine — build this first

This is the foundation. Everything else depends on it, so it gets built first, tested hardest, and never bypassed.

**Governing relationship:**

```
weight_kg = length_m × width_m × (thickness_mm / 1000) × density_kg_per_m3
area_m2   = length_m × width_m
```

**Non-negotiable rules for the implementation:**

1. One module, e.g. `lib/uom.ts`, is the *only* place this maths exists. No inline calculation anywhere else in the codebase.
2. Every stock and transaction row stores **both** `qty_kg` and `qty_m2`, plus the dimensional attributes used to derive them.
3. Store weights and dimensions as integers in base units (grams, millimetres) or as `Decimal`. **Never `float`** — floating-point drift across thousands of rows will silently corrupt the stock ledger.
4. **Theoretical vs. actual weight**: the calculated weight will differ from the weighbridge/scale reading because of density variance. Store both. The variance percentage is one of your most useful quality KPIs — persistent drift means the line is running off-spec.
5. Ship a comprehensive unit test suite for this module before anything else is built. Round-trip conversions, boundary values, laminated multi-layer products, unrealistic inputs.

---

## 6. Module map

Grouped roughly in dependency order.

### 6.1 Masters
- **Item master.** Distinct types: raw material, WIP roll, finished good, consumable, packing material. Foam attributes: grade, thickness (mm), width (mm), density (kg/m³), colour, layer count, surface treatment (plain / anti-static / laminated / perforated), HSN code.
- **Customer master.** GSTIN, billing & multiple ship-to addresses, credit limit, credit days, payment terms, transporter preference, tier. *Port the tiering logic from the Diamond framework — same scoring dimensions, different weights.*
- **Supplier master.** LDPE suppliers, butane, talc, GMS, masterbatch, packing.
- **Machine, shift, operator, warehouse/location masters.**

### 6.2 Production
- **Batch / lot.** Machine, shift, date, operator, start/end time, target SKU, RM issued (with regrind %), output, scrap, downtime reason codes.
- **Roll registry.** Every roll gets a unique ID and printed barcode label carrying: roll no, lot, SKU, gross/net weight, length, thickness, width, density, production date, **aging-ready date**.
- **Downtime log.** Reason-coded — die change, RM changeover, breakdown, power cut, no orders. Feeds OEE.
- **Aging queue.** Auto-transitions rolls from *curing* to *available* on the ready date. Dispatch and lamination both block against curing stock, with a supervisor override that is logged.

### 6.3 Converting
- **Lamination / slitting / bag-making orders.** Consume parent rolls, produce child rolls or finished goods, with full parent→child genealogy so any complaint traces back to an extrusion batch. Track yield and conversion loss per job.

### 6.4 Stores & purchase
- Purchase order → GRN → quality check → stock. Landed cost per lot (LDPE price moves with polymer/crude cycles, so weighted-average valuation matters more than usual). Reorder-level alerts, especially for butane and masterbatch.

### 6.5 Sales & dispatch
- Sales order → production allocation → picking → dispatch note → invoice → e-way bill → LR/transporter → delivery confirmation.
- Credit-limit block at order entry, with a logged override path.
- Receivables ageing — reuse the Diamond tracker logic rather than rebuilding it.

### 6.6 Quality
- Per-lot QC record: density check, thickness, appearance, tensile if tested. Hold/release workflow. Customer complaint log linked back through roll genealogy to the originating batch.

### 6.7 Costing & analytics
Per-batch cost roll-up: RM (dominant, typically the large majority of cost) + power + labour + consumables + overhead absorption.

Dashboard KPIs worth having from day one:

- kg/hour output vs. rated capacity
- **kWh per kg** — EPE extrusion is power-hungry and this is your single best efficiency signal
- Scrap % and regrind % in blend
- Material yield (kg out ÷ kg in)
- Density variance vs. spec
- OEE (availability × performance × quality)
- Contribution margin per SKU and per customer
- On-time dispatch %
- Receivables ageing and overdue exposure

---

## 7. Compliance requirements

Design in, don't bolt on.

- **GST**: correct HSN on every item (cellular plastic sheets fall under Chapter 39 — ⚠️ confirm exact code with your CA), CGST/SGST vs. IGST logic by ship-to state, tax-inclusive/exclusive handling.
- **E-invoicing**: IRN generation via an IRP or a GSP API. Build the invoice model to accommodate IRN and signed QR from the start.
- **E-way bill**: auto-generate above the threshold; store the EWB number and validity against the dispatch.
- **Document numbering**: statutory financial-year-wise series, gapless, no deletion — only cancellation with an audit trail.
- **Audit trail**: append-only log on every stock and financial movement. Who, what, when, previous value.

---

## 8. Phasing against your commissioning timeline

Containers land at Mundra early-to-mid August; realistically commissioning falls somewhere in the following weeks. That gives roughly 8–12 weeks of build runway.

**Do not attempt everything before day one.** Getting masters and dispatch right matters far more than having a costing dashboard on the first day of production.

| Phase | Target | Deliverable |
|---|---|---|
| **0** | Pre-commissioning | UOM engine + test suite, DB schema, auth, item/customer/supplier masters, basic stock ledger |
| **1** | Commissioning day | Production batch entry, roll registry + barcode labels, aging queue, dispatch + invoice, RM issue/receipt |
| **2** | +4 weeks | Purchase & GRN, QC module, converting orders, receivables |
| **3** | +8 weeks | Batch costing, KPI dashboards, Tally sync, e-invoice/e-way bill APIs |
| **4** | Later | Customer portal, mobile order-taking, predictive reorder, cross-entity view with Diamond |

Phase 1 is the hard deadline. Everything else can run on paper or in Excel for a few weeks without lasting damage — but if roll tracking isn't live from the first production run, that data is gone permanently.

---

## 9. Working with Claude Code

The build's success depends more on how you set up the repo than on the code itself.

**a) Write `CLAUDE.md` at the repo root first.** This is the highest-leverage file in the project. It must contain a domain glossary — *aging, curing, regrind, lamination, density, GSM, slitting, lot, roll, trim* — because these words mean something specific here and Claude Code will otherwise reach for generic manufacturing semantics. Also state the non-negotiables: never use float for weights, always write both kg and m², never bypass the UOM module.

**b) Keep a `/specs` folder**, one markdown file per module. Point Claude Code at a single spec per session rather than describing requirements conversationally. Specs are versioned, conversations aren't.

**c) One module per session.** Long sessions drift. Finish, commit, start fresh.

**d) Seed with real data early.** Your actual SKUs, real customer names, real LDPE grades. Synthetic data hides exactly the edge cases that break foam ERPs — the 0.5mm ultra-thin, the 8-layer laminate, the odd-width customer special.

**e) Tests where it hurts.** UOM conversion, stock ledger balance, credit-limit enforcement, aging transitions. Skip UI tests for now.

**f) Migrations from commit one.** Prisma migrations, never manual schema edits. You will need to change the schema after production starts and real data is in it.

**Suggested repo layout:**

```
/app          Next.js routes (UI + API)
/lib          uom.ts, stock-ledger.ts, costing.ts, tally-sync.ts
/prisma       schema.prisma, migrations, seed.ts
/specs        one .md per module
/tests        uom.test.ts, ledger.test.ts, ...
CLAUDE.md     domain glossary + rules + conventions
```

---

## 10. Build vs. buy — worth ten minutes of thought

Custom is a defensible choice here, but you should reject the alternatives knowingly rather than by default.

**ERPNext** (open source, free, Frappe framework) ships with manufacturing BOMs, work orders, stock, and Indian GST built in. It would cover perhaps 70% of this out of the box. The gap is exactly the foam-specific 30% — dual UOM, aging, regrind loops — and closing that means learning Frappe's customisation model, which is its own real skill.

**Marg / Busy / Zoho / Tally add-ons** are cheaper and faster to deploy, but none handle roll-level traceability or time-gated inventory. You'd end up running Excel alongside, which is where you started.

**The honest case for custom:** the foam-specific logic is the entire value, it's genuinely hard to buy, and Claude Code makes a small custom build tractable in a way it wasn't three years ago.

**The honest case against:** an ERP is a long-lived system that needs maintenance for years. When you eventually move on from day-to-day plant operations, someone has to own this codebase. A commercial product has vendor support; your custom build has you. Factor that in — and it's an argument for keeping the system small and boring, not for abandoning the idea.

---

## 11. Open decisions to lock before starting

1. **Aging period in days** — from the machine supplier or a trial run. Drives the whole availability model.
2. **SKU cardinality** — roughly how many finished-good variants at launch? Ten or two hundred changes the UI approach entirely.
3. **Tally sync direction** — one-way push (ERP → Tally) is far simpler and almost certainly sufficient. Confirm with your CA.
4. **Weighbridge / platform scale** — will it have a digital output the system can read, or is weight keyed in manually? Affects the production entry screen.
5. **Shop-floor input reality** — will operators actually enter data on a tablet, or does a supervisor batch-enter from paper slips at shift end? Design for what will really happen, not the ideal.
