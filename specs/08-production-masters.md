# Spec S8 — Production Masters (machine, shift, operator, downtime codes)

**Status:** Built — `Machine`, `Shift`, `Operator`, `DowntimeReason` + `DowntimeCategory`
enum; `lib/production-masters.ts` (pure validation + audited create/update/deactivate,
`code` immutable, MASTERS-write gated); `/masters/production` (one page, four editable
sections). Seed: FLY-250 line, shifts A/B/C, 2 operators, 6 downtime reasons (placeholders).
Verified: 10 tests, seed loads, page renders. **RBAC decision:** kept ADMIN-only (MASTERS
write), matching S5–S7 — widening PRODUCTION deferred.

## Purpose

The small reference masters a production batch references: which machine ran it, on which
shift, by which operator, and the reason-coded downtime taxonomy that feeds OEE. Foundational
for S10 (batch entry).

## Scope

**In:** `Machine`, `Shift`, `Operator`, `DowntimeReason` schema + CRUD + seed. Warehouse /
location already exists (`Location`, S3).

**Out:** the batch itself (S10), OEE calculation (Phase 3 costing/analytics — this spec only
defines the reason codes it will roll up).

## Dependencies

- S2 (`companyId`, audit log), S4 (MASTERS-write gating).

## Data model

```
Machine       id, companyId, code (unique/co), name, ratedCapacityKgHr (Decimal?),
              isActive, createdAt
Shift         id, companyId, code (unique/co, e.g. A/B/C), name, startTime, endTime
Operator      id, companyId, code (unique/co), name, isActive, createdAt
DowntimeReason id, companyId, code (unique/co), description,
              category (DowntimeCategory), isActive
```

New enum `DowntimeCategory`: `DIE_CHANGE | RM_CHANGEOVER | BREAKDOWN | POWER_CUT | NO_ORDERS
| MAINTENANCE | OTHER`. The category is what OEE availability-loss analysis groups on; the
free `code`/`description` let the plant name specifics.

## Rules & invariants

1. `code` immutable once referenced by a batch/downtime log; other fields editable with audit.
2. Deactivate, don't delete (referential integrity with historical batches).
3. Every create/edit writes an audit row (S2). MASTERS-write gated (ADMIN + PRODUCTION may
   write these; per S4 matrix PRODUCTION currently has MASTERS read — **widen PRODUCTION to
   write on production masters**, see open questions).
4. Shift times are stored; overnight shifts (end < start) are allowed and mean "crosses
   midnight".

## Public surface

- `/masters/machines`, `/masters/shifts`, `/masters/operators`, `/masters/downtime-reasons`
  — list, create, edit, deactivate. Server actions role-checked and audited.

## Seed data

- One machine: **FLY-250** (the commissioning line), rated capacity placeholder.
- Shifts **A / B / C** (08:00–16:00, 16:00–00:00, 00:00–08:00 — confirm actual timings).
- A couple of placeholder operators.
- Standard downtime reasons across all categories.

All placeholders — replace via the UI.

## Acceptance criteria

1. Each master supports create/edit/deactivate, gated and audited.
2. A `DowntimeReason` carries a category from the enum.
3. Seed loads FLY-250, three shifts, and the downtime taxonomy.
4. `npm run check` green.

## Open questions

- **RBAC widening:** should PRODUCTION (not just ADMIN) write production masters? The S4
  matrix has PRODUCTION at MASTERS=read. **Default: keep ADMIN-only for now** to match S5–S7;
  widen later if the plant wants supervisors maintaining these. Decide before build.
- **Operator ↔ User link:** are operators system users or just names on a batch? **Default:
  separate `Operator` rows** (shop-floor operators rarely log in). Revisit if operators need
  app access.
- Real machine capacity and shift timings (placeholders until supplied).
