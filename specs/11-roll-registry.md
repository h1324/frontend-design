# Spec S11 — Roll Registry & Labels

**Status:** Draft — confirm the exact roll-number format

## Purpose

Give every roll a unique, human-readable identity and a printable label, and let staff pull
up a roll by typing its number. This is the data that is **gone permanently** if roll
tracking isn't live from the first production run (brief §8).

> **Decision (confirmed):** there is **no barcode / scanning system**. Roll identity is a
> simple **numeric or alphanumeric** number, keyed and read by hand. This supersedes the
> brief's mentions of barcodes/scanners for rolls.

## Scope

**In:** the roll-number scheme, roll creation from a lot (called by S10), a plain printed
label (human-readable text), reprint logging, and roll lookup by number.

**Out:** the aging transition (S12), converting/genealogy children (Phase 2), dispatch (S13).
The `Roll` model itself already exists (S3); this spec adds the number + label.

## Dependencies

- S3 (`Roll`, `receiveRoll`), S2 (`nextDocNumber`, audit), S5 (`resolveItemAging`), S10 (lot).

## Data model

Extend `Roll` (S3): add `rollNo` (unique per company), `labelPrintedAt`, `labelPrintCount`.

```
Roll (added)   rollNo (unique/co — plain human-readable number, e.g. "R2627-000123"),
               labelPrintedAt (nullable), labelPrintCount (default 0)
```

No barcode payload column — the number _is_ the identifier, typed in when needed. The label
carries: roll no, lot no, SKU + description, net (actual) weight, length, thickness, width,
density, production date, **aging-ready date**. All already on the roll (S3) — this spec
renders them.

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

- **Plain printed label — no barcode.** The roll number is printed large and human-readable.
- **Format:** a **PDF** label (works on any office/label printer); a thermal-text variant can
  follow if the plant standardises on a thermal printer. No ZPL barcode encoding.
- Rendered by a `lib/label.ts` (pure: roll → label model / PDF), so it's unit-testable without
  a printer.

## Public surface

- `/production/rolls` — registry list (filter by lot, SKU, state), roll detail, print/reprint
  label, and a **roll-number lookup** (type the number, open the roll).
- `/production/rolls/[id]` — full detail + genealogy chain (parents/children when converting
  lands).
- Server actions: `printLabel` (logs), plus read-only lookups.

## Acceptance criteria

1. Each roll gets a unique gapless `rollNo`; two rolls never collide (concurrent creation
   safe via the S2 generator).
2. `lib/label.ts` emits a label containing roll no, lot, SKU, net weight, dimensions, density,
   production + aging-ready dates — no barcode.
3. Reprinting increments the count and writes an audit row.
4. Looking up a roll by its number returns its detail.
5. `npm run check` green (numbering + label-content tests).

## Open questions

- **Exact roll-number format.** A plain sequence is confirmed; pick the shape: purely numeric
  (`000123`) or a short alphanumeric prefix + FY + sequence (**default: `R<FY>-<seq>`, e.g.
  `R2627-000123`** — readable, sortable, gapless per FY via the S2 generator). Confirm the
  prefix/width the plant wants. Not a blocker — schema is stable either way.
- **Label stock/size** — A4 sheet vs a dedicated label size. **Default: a simple PDF label**;
  revisit if a specific label printer/size is chosen.
- **Reprint authorization** — who may reprint (any PRODUCTION vs supervisor)? **Default:
  PRODUCTION**, logged.
