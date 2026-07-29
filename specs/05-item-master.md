# Spec S5 — Item Master

**Status:** Built — `Item` extended (HSN, foam attrs, aging, reorder) + `Company.default
AgingDays`; `lib/items.ts` (pure validation + `resolveAgingDays` + audited create/update/
deactivate, `code`/`type` immutable); `lib/catalogue.ts` representative launch catalogue
(16 items, incl. 0.5 mm ultra-thin, 8-layer laminate, odd-width special, LDPE/butane/talc/
GMS/masterbatch); `/masters/items` list+create+edit, gated (ADMIN writes, all read).
Verified: 17 tests, seed loads all 16, and the page renders the catalogue at runtime.
Seed values are **representative placeholders** for a greenfield line — replace via the UI
before go-live. Aging default = 7 days (placeholder); HSN kept free-text.

## Purpose

The catalogue of everything the system tracks: raw materials, WIP rolls, finished goods,
consumables, packing. Foam finished goods carry the dimensional attributes the UOM engine
and stock ledger depend on.

## Scope

**In:** item schema, CRUD, validation, aging configuration, and seed data with real SKUs
including edge cases.

**Out:** stock quantities (that's the ledger, S3) — the item master defines _what a thing
is_, not _how much is on hand_.

## Dependencies

- S2 (`ItemType`, `SurfaceTreatment` enums, `companyId`).
- S1 (dimensional attributes are validated against UOM expectations).

## Data model

```
Item  id, companyId, code (unique per company), name, type (ItemType),
      hsnCode,                         // free text — NOT hardcoded (see rules)
      uomBase,                         // KG | M2 | NOS | LITRE — the item's native unit
      // foam attributes (nullable for non-foam types):
      grade, thickness_mm, width_mm, density_kg_m3, colour,
      layerCount, surfaceTreatment (SurfaceTreatment),
      // aging (decision B4):
      agingDays,                       // nullable → falls back to plant default
      // lifecycle:
      isActive, reorderLevel (nullable), createdAt
```

## Rules & invariants

1. **HSN is a free field, never hardcoded.** The brief flags Chapter 39 as
   CA-to-confirm; the code accepts whatever the user enters and validates only format
   (2/4/6/8 digit), not a specific value.
2. **Foam attributes required for FINISHED_GOOD / WIP_ROLL**, optional/null for
   RAW_MATERIAL / CONSUMABLE / PACKING. Validation enforces this by `type`.
3. **Dimensions/density are `Decimal`**, validated > 0 when present; density soft-warns
   outside 15–45 kg/m³ (consistent with UOM spec) but does not block.
4. **Aging period resolution:** `Item.agingDays` if set, else the plant-wide default from
   config. Stored on the item so a per-grade cure time is possible without a schema
   change (decision B4).
5. **Code is immutable** once transactions reference the item; name and non-key
   attributes are editable (with audit).
6. Edits write audit rows (S2).

## Seed data (CLAUDE.md §d — real, not synthetic)

Seed must include, using **real SKUs and grades**, at minimum these edge cases:

- a 0.5 mm ultra-thin foam,
- a multi-layer (e.g. 8-layer) laminate,
- an odd-width customer special,
- raw materials: LDPE grade(s), butane, talc, GMS, masterbatch,
- consumables/packing.

⚠️ Real SKU list, grades, and LDPE grade names to be supplied — placeholders flagged in
seed until then.

## Public surface

- `/masters/items` — list (dense shadcn table, filter by type/grade), create, edit,
  deactivate. Admin write; others read (per S4 matrix).
- Server actions: `createItem`, `updateItem`, `deactivateItem` — all role-checked and
  audited.

## Acceptance criteria

1. Creating a FINISHED_GOOD without foam attributes is rejected with field-level errors;
   creating a RAW_MATERIAL without them succeeds.
2. HSN accepts a valid-format code and rejects a malformed one; no HSN value is
   hardcoded.
3. Aging resolution returns the item's `agingDays` when set, else the plant default.
4. Seed loads all listed edge-case items without error.
5. Editing an item writes an audit row; code is immutable once referenced.
6. `npm run check` green.

## Open questions

- ⚠️ **Real SKU/grade/LDPE list** (blocks meaningful seed — placeholders until supplied).
- ⚠️ **Plant-wide default aging days** (decision B4 / brief §11.1) — needs the supplier's
  cure time. **Default placeholder: 7 days**, clearly marked as a guess in config.
- **Item code scheme** — user-entered vs auto-generated. **Default: user-entered, unique
  per company.**
- **SKU cardinality** (brief §11.2) confirms the list UI approach; designed for tens.
