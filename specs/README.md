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

## Phase 0 build order

Each session ends in something committable (tests green + migration applied).

| # | Spec | Module |
|---|---|---|
| S0 | [00-scaffold.md](00-scaffold.md) | Project scaffold & toolchain |
| S1 | [01-uom-engine.md](01-uom-engine.md) | UOM conversion engine (`lib/uom.ts`) |
| S2 | [02-foundational-schema.md](02-foundational-schema.md) | Enums, audit log, doc numbering, conventions |
| S3 | [03-stock-ledger.md](03-stock-ledger.md) | Append-only stock ledger (`lib/stock-ledger.ts`) |
| S4 | [04-auth-rbac.md](04-auth-rbac.md) | Authentication & role-based access |
| S5 | [05-item-master.md](05-item-master.md) | Item master |
| S6 | [06-supplier-master.md](06-supplier-master.md) | Supplier master |
| S7 | [07-customer-master.md](07-customer-master.md) | Customer master |

Later phases (production, converting, stores, dispatch, quality, costing) get their own
specs when Phase 0 is complete. See `docs/brief.md` §8 for the full phasing.

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
