# Spec S2 — Foundational Schema (enums, audit log, document numbering)

**Status:** Built — Plant, AuditLog, DocSeries + shared enums migrated;
`lib/financial-year.ts`, `lib/doc-number.ts` (atomic ORM increment under a row lock),
`lib/audit.ts`. AuditLog is append-only via a DB trigger. Verified: gapless + concurrent
+ FY-reset numbering, audit capture, and UPDATE/DELETE rejection (9 tests, run against
Postgres). Resolved the open questions to the `PREFIX/FY/000123` format and a row lock on
DocSeries (not a Postgres sequence).

## Purpose

The cross-cutting primitives every other module builds on: shared enums, the append-only
audit log, the financial-year document-number generator, money/decimal conventions, and
the company/plant skeleton. Get these right once so no module reinvents them.

## Scope

**In:** Prisma models and helpers for `Company`, `Plant`, `AuditLog`, `DocSeries` +
`lib/doc-number.ts`, and the shared enums. Decimal scale conventions.

**Out:** the stock ledger (S3) and any master (S5–S7) — they depend on this but are
separate sessions.

## Dependencies

- S0 (Prisma, DB, Decimal constants).

## Data model

### Company / Plant

```
Company  id, name, gstin, legalName, createdAt
Plant    id, companyId → Company, name, code, addressJson
```

Single company + single plant at launch, but the tables and the `companyId` FK exist
from day one (cross-cutting decision #3). Every downstream table carries `companyId`.

### Shared enums

```
Role            ADMIN | PRODUCTION | STORES | SALES | DISPATCH | ACCOUNTS | VIEWER
ItemType        RAW_MATERIAL | WIP_ROLL | FINISHED_GOOD | CONSUMABLE | PACKING
RollState       CURING | AVAILABLE | ALLOCATED | DISPATCHED | CONSUMED | CANCELLED
SurfaceTreatment PLAIN | ANTI_STATIC | LAMINATED | PERFORATED
StockDirection  IN | OUT            // for ledger postings (S3)
```

`RollState` is the roll lifecycle the ledger (S3), aging queue (Phase 1) and dispatch
(Phase 2) all key off. Transitions and who may make them are defined in their own specs;
this spec only owns the enum.

### Audit log (append-only)

```
AuditLog  id, companyId, entity (string), entityId, action, actorUserId,
          beforeJson, afterJson, at (timestamp)
```

- **Append-only**: rows are inserted, never updated or deleted.
- Written for every stock and financial movement (enforced by the modules that make
  those movements, not by this table).
- `before/after` capture the changed values so "previous value" is always recoverable.

### Document numbering

```
DocSeries  id, companyId, docType, financialYear (e.g. "2026-27"),
           prefix, nextSeq, unique(companyId, docType, financialYear)
```

`lib/doc-number.ts`:

```ts
// Atomically allocates the next gapless number for a doc type in the current FY.
export async function nextDocNumber(tx, companyId, docType): Promise<string>;
```

## Rules & invariants

1. **Gapless, FY-wise, cancel-not-delete.** Numbers increment with no gaps within a
   financial year; a cancelled document keeps its number and is marked cancelled — never
   deleted, never reissued.
2. **Financial year = April–March.** The series for a docType rolls over on 1 April to a
   new `financialYear` row starting at seq 1.
3. **Allocation is atomic.** `nextDocNumber` must run inside the same transaction as the
   document insert and use a row lock (or an atomic increment) so two concurrent callers
   can't get the same number.
4. **Decimal scales are defined here** and imported everywhere: e.g. weight kg (3 dp),
   dimensions mm (2 dp), area m² (4 dp), money (2 dp / paise). Documented in
   `lib/decimal.ts`, referenced by this spec.
5. Audit log is insert-only at the DB permission level where feasible.

## Acceptance criteria

1. Migration applies: `Company`, `Plant`, `AuditLog`, `DocSeries` + enums exist.
2. `nextDocNumber` test: sequential calls return gapless numbers; concurrent calls (two
   transactions) never collide; a new FY resets to 1.
3. Audit-log helper test: writing an audit row captures actor, before, after, timestamp.
4. `npm run check` green.

## Open questions

- ⚠️ **Doc-number format.** Proposed `PREFIX/FY/SEQ` e.g. `INV/2026-27/000123`. Confirm
  the exact prefixes accounts/CA expect per document type.
- Whether concurrency uses `SELECT … FOR UPDATE` on `DocSeries` or a Postgres sequence
  per (docType, FY). **Default: row lock on `DocSeries`** — keeps gapless guarantee that
  raw sequences can't (sequences leak numbers on rollback).
- Roll-ID scheme (decision B7 from analysis) — belongs to the roll registry spec
  (Phase 1) but its FY/lot/seq shape should reuse this generator. Flagged for continuity.
