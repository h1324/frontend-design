# Spec S3 — Stock Ledger (`lib/stock-ledger.ts`)

**Status:** Built. Resolved: **block negative for bulk RM**; **`ALLOCATED` reserves
specific rolls at picking**. Two build-forced refinements: (a) the reversal pointer lives
on the _reversing_ row (`reversesLedgerId → original`), because the ledger is append-only
and the original row can never be updated; (b) a **minimal `Item` stub** is introduced
here (the ledger must FK to it) and extended by S5 — mirroring how S0 seeded `Company`.

## Purpose

The append-only record of every stock movement, carrying **both kg and m²** on every
row, reconcilable at any point in time. This is the second-hardest module after UOM; if
it leaks, the whole system's inventory becomes untrustworthy.

## Scope

**In:** the ledger schema, the posting function, and balance queries. Two stock grains:
**serial (rolls)** and **bulk (raw materials/consumables)**.

**Out:** the movements that _cause_ postings (production, dispatch, GRN, converting) —
those live in their own specs and _call_ this module. S3 provides the primitive; it does
not know about invoices or batches.

## Dependencies

- S1 (UOM — every posting's kg/m² are computed via `lib/uom.ts`).
- S2 (company, audit log, enums, decimal scales).

## The two grains (decision B1)

Rolls are individually barcoded and serial-tracked; raw materials (LDPE, butane, talc)
are bulk and fungible. The ledger models both:

- **Serial:** a `Roll` has an identity, a `RollState`, and its own attributes. Movements
  reference a specific `rollId`.
- **Bulk:** an `Item` of type RAW_MATERIAL/CONSUMABLE/PACKING has a running quantity
  balance per location. Movements reference `itemId` + quantity, no serial identity.

## Data model

```
Roll        id, companyId, itemId → Item, lotId (nullable until Phase 1),
            state (RollState), locationId,
            length_m, width_m, layersJson,            // dimensional attributes
            qty_kg_theoretical, qty_kg_actual, qty_m2, // both units, both weights (B2)
            density_kg_m3, agingReadyDate (nullable),
            createdAt

StockLedger id, companyId, at, direction (IN|OUT),
            grain (SERIAL|BULK),
            rollId (nullable)  | itemId + locationId (for BULK),
            qty_kg, qty_m2, qty_base (for bulk RM, e.g. kg of LDPE),
            reason (enum: PRODUCTION|GRN|DISPATCH|CONVERT_IN|CONVERT_OUT|ADJUSTMENT|REVERSAL),
            refType, refId,          // what caused it (batch, GRN, dispatch…)
            reversedByLedgerId (nullable),
            actorUserId
```

## Rules & invariants

1. **Append-only.** No UPDATE, no DELETE on `StockLedger`. Corrections are **reversing
   entries** (`REVERSAL`) that point at the original via `reversedByLedgerId`
   (CLAUDE.md rule 6).
2. **Both units on every row.** `qty_kg` and `qty_m2` are always populated for foam
   movements; bulk RM rows also carry `qty_base` in the material's own unit.
3. **kg = actual, m² = from dimensions** (cross-cutting decision #2). The ledger's
   quantity of record for foam is **actual weighed kg**; `qty_m2` comes from measured
   dimensions via UOM, never back-derived from kg.
4. **Availability is time-gated.** Balance/availability queries must filter
   `state = AVAILABLE` **and** `agingReadyDate <= now` for sellable stock. Rolls in
   `CURING` are physical but not available (CLAUDE.md rule 5).
5. **Every posting writes an audit row** (S2) and runs inside a transaction with the
   movement that caused it.
6. **Overrides are logged.** Dispatching/converting against curing stock is permitted
   only via an explicit override carrying user + reason, recorded in the audit log.

## Public API (proposed)

```ts
export async function post(tx, entry: LedgerEntryInput): Promise<StockLedger>;
export async function reverse(tx, ledgerId, actorUserId, reason): Promise<StockLedger>;

export async function rollBalance(companyId, filter): Promise<Balance>; // serial
export async function itemBalance(companyId, itemId, locationId): Promise<Balance>;
export async function availableRolls(companyId, itemId, asOf: Date): Promise<Roll[]>;
```

## Acceptance criteria

1. Posting an IN then an OUT of equal magnitude nets the balance to zero in **both**
   kg and m².
2. A reversal restores the pre-posting balance and leaves both original and reversal rows
   in place (append-only proven).
3. `availableRolls` excludes rolls whose `agingReadyDate > asOf` and any not in
   `AVAILABLE`.
4. Bulk RM balance tracks `qty_base` correctly across multiple IN/OUT postings.
5. Concurrency: two simultaneous OUT postings can't drive a bulk balance negative below
   an enforced floor (or the floor rule is explicitly "allow negative + flag" — see open
   questions).
6. `npm run check` green.

## Open questions

- ⚠️ **Negative-balance policy.** Block a posting that would drive bulk stock negative,
  or allow it and flag? **Default: block for bulk RM; rolls can't go negative by
  construction (serial).** Confirm — shop-floor timing can create transient negatives.
- ⚠️ **Allocation grain (decision B5).** Is `ALLOCATED` set at sales-order time or at
  picking, and does it reserve specific `rollId`s? **Default: reserve specific rolls at
  picking, not at order.** This affects whether the ledger needs an ALLOCATION reason.
- **Valuation method** for bulk RM — weighted-average per lot (brief §6.4). Confirm this
  lives in the ledger or in a separate costing table. **Default: costing table (Phase
  3), ledger stores quantity only.**
- Location model depth — single warehouse vs bins. **Default: flat locations now**,
  bins later.
