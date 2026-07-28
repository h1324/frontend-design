# Spec S6 — Supplier Master

**Status:** Ready

## Purpose

The register of parties the plant buys from — polymer, blowing agent, additives, packing
— so purchase, GRN, and landed-cost (Phase 2) have someone to reference.

## Scope

**In:** supplier schema, CRUD, GSTIN validation, seed data.

**Out:** purchase orders, GRN, landed cost — Phase 2, they *reference* this master.

## Dependencies

- S2 (`companyId`, audit log).

## Data model

```
Supplier  id, companyId, code (unique per company), name, legalName,
          gstin (nullable — some small suppliers unregistered),
          addressJson, contactJson,     // phone, email, contact person
          suppliesJson,                  // free tags: LDPE, BUTANE, TALC, GMS, MASTERBATCH, PACKING
          paymentTerms, isActive, createdAt
```

## Rules & invariants

1. **GSTIN validated for format when present** (15-char India GSTIN pattern; checksum
   optional) but **allowed to be null** — some suppliers are unregistered.
2. **Code immutable** once referenced by a purchase document; other fields editable with
   audit.
3. Edits write audit rows (S2).
4. Deactivate, don't delete (referential integrity with future POs).

## Seed data

Real supplier names for the actual material categories:
- LDPE supplier(s), butane, talc, GMS, masterbatch, packing.

⚠️ Real supplier names to be supplied — placeholders until then.

## Public surface

- `/masters/suppliers` — list, create, edit, deactivate. Admin write; others read.
- Server actions: `createSupplier`, `updateSupplier`, `deactivateSupplier` — role-checked
  and audited.

## Acceptance criteria

1. Creating a supplier with a malformed GSTIN is rejected; with a null GSTIN succeeds.
2. Seed loads the material-category suppliers.
3. Edits are audited; code immutable once referenced.
4. `npm run check` green.

## Open questions

- ⚠️ **Real supplier names** (blocks meaningful seed).
- Whether GSTIN checksum validation is required or format-only. **Default: format-only**
  in Phase 0; full checksum can come with the e-invoice work (Phase 3).
- Whether a party can be both supplier and customer (shared entity). **Default: separate
  masters** — simpler, revisit only if it causes double-entry pain.
