# Spec S17 — Converting Orders (lamination / slitting / bag-making)

**Status:** Draft — confirm which converting operations are live at launch

## Purpose

Model post-extrusion operations that **consume parent rolls and produce child rolls**, with
the parent→child genealogy that complaint tracing depends on (CLAUDE.md glossary). This is
the umbrella "converting" step: lamination (bond thin sheets into a thicker product),
slitting (cut a wide roll into narrower rolls), bag-making.

## Scope

**In:** a converting order (operation type, machine/shift/operator, inputs, outputs), the
**SERIAL-OUT of parent rolls (consumed) + SERIAL-IN of child rolls (produced)** in one
transaction, the genealogy link, input/output weight balance (a KPI, like the lot's), and
scrap/trim capture.

**Out:** detailed converting BOM/recipe planning, scheduling/finite-capacity, costing
roll-up (Phase 3), the roll numbering/label itself (reuses S11).

## Dependencies

- S3 (`post` SERIAL OUT/IN, `receiveRoll`), S11 (child roll creation + numbering + labels),
  S10 (lot/genealogy pattern), S8 (machine/shift/operator), S12 (children start CURING if the
  operation re-introduces butane/heat — see open questions), S2 (numbering, audit).

## Data model

```
ConvertingOrder   id, companyId, docNo (CV/FY/seq), operation (LAMINATION|SLITTING|BAG_MAKING),
                  machineId, shiftId, operatorId, targetItemId, status (OPEN|CLOSED|CANCELLED),
                  inputKg (Decimal), outputKg (Decimal), scrapKg (Decimal), trimKg (Decimal),
                  startedAt, endedAt, createdBy
ConvertingInput   id, orderId, rollId (parent → Roll)              // consumed parents
```

Children are ordinary `Roll` rows (S11) whose lineage is the converting order's inputs.
Genealogy chain: **child Roll → ConvertingOrder → parent Roll(s) → … → extrusion Lot (S10)**.
`RollState.CONSUMED` marks a fully-consumed parent.

## Rules & invariants

1. **Parents must be AVAILABLE (aged + QC-passed)** to convert; consuming a curing/held roll
   needs the logged override (S12/S16). Consumption posts **SERIAL OUT** and flips the parent
   `CONSUMED`.
2. **Children are created via S11** (`receiveRoll`) with their own gapless roll numbers and a
   SERIAL IN; each records its parent(s) for genealogy.
3. **Material balance surfaced, not reconciled**: Σ parent kg vs Σ child kg + scrap + trim —
   the variance is a KPI (mirrors the lot's balance, CLAUDE.md 4).
4. **Slitting conserves area/mass; lamination sums layers** — child dimensions/density derive
   via `lib/uom.ts` (multi-layer stack for laminates), never inline.
5. **A CLOSED order is immutable except by cancellation**, which reverses child SERIAL-INs
   (children → CANCELLED) and parent SERIAL-OUTs (parents → AVAILABLE). Nothing deleted.
6. Every movement audits; numbers gapless per FY.

## Public surface

- `/converting` — list, open an order, pick parent rolls, record child outputs, close/cancel.
  PRODUCTION + ADMIN write.
- `/converting/[id]` — detail + the genealogy tree (parents ↔ children).
- Server actions: `openConverting`, `pickParents`, `closeConverting`, `cancelConverting` —
  role-checked, audited, transactional.

## Acceptance criteria

1. Closing an order consumes parents (SERIAL OUT → CONSUMED) and creates children (SERIAL IN,
   numbered via S11), all in one transaction.
2. A child roll traces to its parent(s) and up to the originating extrusion lot.
3. Material-balance variance (parents vs children + scrap + trim) is computed and shown.
4. Cancelling reverses both sides (children CANCELLED, parents AVAILABLE); numbers retained.
5. Laminate child density/thickness derive correctly via `lib/uom.ts` (multi-layer).
6. `npm run check` green (genealogy + balance + UOM round-trip + cancel tests).

## Open questions

- ⚠️ **Operations live at launch.** All three (lamination/slitting/bag-making) or a subset?
  **Default: model all three with one order type keyed by `operation`**; only lamination and
  slitting exercised in seed/tests initially. Confirm which the plant runs first.
- ⚠️ **Do converted children re-age?** Lamination applies heat/adhesive — a fresh cure may be
  needed; slitting does not. **Default: `operation`-driven — laminates start CURING with an
  aging-ready date, slit/bag children start AVAILABLE** (inherit parent's aged status).
  Confirm the curing rule per operation with production.
- **Multiple parents per child (lamination) and multiple children per parent (slitting)** —
  both supported by the input/child model; confirm no 1:1 restriction is wanted.
