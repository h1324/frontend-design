# Spec S11 — Roll Registry & Barcode Labels

**Status:** Draft — confirm roll-ID scheme and label format

## Purpose

Give every roll a unique, barcoded identity and a printable label, and make a scanned roll
resolve to its full detail and genealogy. This is the data that is **gone permanently** if
roll tracking isn't live from the first production run (brief §8).

## Scope

**In:** roll numbering scheme, roll creation from a lot (called by S10), the label
(barcode + human-readable), reprint logging, and roll lookup/scan.

**Out:** the aging transition (S12), converting/genealogy children (Phase 2), dispatch (S13).
The `Roll` model itself already exists (S3); this spec adds numbering + labels.

## Dependencies

- S3 (`Roll`, `receiveRoll`), S2 (`nextDocNumber`, audit), S5 (`resolveItemAging`), S10 (lot).

## Data model

Extend `Roll` (S3): add `rollNo` (unique per company), `labelPrintedAt`, `labelPrintCount`.

```
Roll (added)   rollNo (RL/FY/seq  — or  <lotNo>-<seq>, see open questions), unique/co,
               labelPrintedAt (nullable), labelPrintCount (default 0)
```

The label carries: roll no (barcode), lot no, SKU + description, gross/net (actual) weight,
length, thickness, width, density, production date, **aging-ready date**. All already on the
roll (S3) — this spec renders them.

## Rules & invariants

1. **`rollNo` is gapless per financial year** (S2 generator) and immutable once assigned.
2. **Both weights and m² are already on the roll** (S3, CLAUDE.md 3/4) — the label shows
   actual (weighed) net weight; theoretical is retained for the variance KPI.
3. **Reprints are logged** (increment `labelPrintCount`, audit row) — a relabelled roll must
   be traceable.
4. **Aging-ready date is set at creation** = productionDate + item aging days (S5) and printed
   on the label so the floor knows when it's sellable.
5. Roll state at creation is `CURING`.

## Label output

- **Format:** ZPL for thermal printers (TSC/Zebra) **and** a PDF fallback (brief §4).
- **Barcode symbology:** the roll no encoded as **Code 128** (linear, universally scannable)
  — confirm vs QR/DataMatrix if 2-D scanning is wanted.
- Rendered by a `lib/label.ts` (pure: roll → ZPL string / PDF model), so it's unit-testable
  without a printer.

## Public surface

- `/production/rolls` — registry list (filter by lot, SKU, state), roll detail, print/reprint
  label, scan-to-open (barcode field focuses and resolves on Enter).
- `/production/rolls/[id]` — full detail + genealogy chain (parents/children when converting
  lands).
- Server actions: `printLabel` (logs), plus read-only lookups.

## Acceptance criteria

1. Each roll gets a unique gapless `rollNo`; two rolls never collide (concurrent creation
   safe via the S2 generator).
2. `lib/label.ts` emits a valid ZPL string and a PDF model containing roll no, lot, SKU,
   net weight, dimensions, density, production + aging-ready dates, and a scannable barcode.
3. Reprinting increments the count and writes an audit row.
4. Scanning/looking up a roll no returns its detail.
5. `npm run check` green (numbering + label-content tests).

## Open questions

- ⚠️ **Roll-ID scheme** (decision B7). Two options: **`RL/FY/000123`** (FY-wide, simple) or
  **`<lotNo>-<seq>`** (lot-scoped, encodes parentage in the number). **Default: `RL/FY/seq`**
  for a stable gapless series; lot linkage is a column, not the number.
- ⚠️ **Barcode symbology & label size** — Code 128 on what stock (e.g. 100×50 mm)? Confirm the
  printer model (TSC vs Zebra) and label dimensions.
- **Reprint authorization** — who may reprint (any PRODUCTION vs supervisor)? **Default:
  PRODUCTION**, logged.
