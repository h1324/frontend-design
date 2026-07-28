# Spec S7 — Customer Master

**Status:** Draft — tiering logic depends on external "Diamond" framework

## Purpose

The register of parties the plant sells to, with the GST, address, and credit attributes
that sales orders, dispatch, invoicing, and receivables (Phase 2) all depend on.

## Scope

**In:** customer schema, CRUD, GSTIN validation, multiple ship-to addresses, credit
fields, a placeholder tier.

**Out:** the tier _scoring_ logic and receivables ageing — both flagged as "port from
Diamond" in the brief and deferred (see open questions). Credit-limit _enforcement_
happens at order entry (Phase 2), not here; this master just stores the limit.

## Dependencies

- S2 (`companyId`, audit log).

## Data model

```
Customer     id, companyId, code (unique per company), name, legalName,
             gstin (nullable), pan,
             creditLimit (Decimal, money scale), creditDays (int),
             paymentTerms, transporterPreference,
             tier,                         // placeholder enum — see rules
             isActive, createdAt

ShipToAddress id, customerId → Customer, label, addressJson,
              gstStateCode,                // drives CGST/SGST vs IGST (Phase 2)
              isDefault
```

Billing address lives on `Customer`; **multiple ship-to** addresses hang off
`ShipToAddress`, each with its own GST state code (needed later for CGST/SGST-vs-IGST
determination by ship-to state — brief §7).

## Rules & invariants

1. **GSTIN validated for format when present**, nullable for unregistered buyers.
2. **`gstStateCode` on each ship-to** — the tax logic in Phase 2 keys off ship-to state,
   not billing state, so it must be captured per address now.
3. **`creditLimit`/`creditDays` are stored here; enforcement is Phase 2** at order entry
   (with the logged-override path per brief §6.5). Storing them now avoids a later
   migration.
4. **Tier is a placeholder enum** (`A | B | C | UNGRADED`, default `UNGRADED`). The
   scoring model ("port from Diamond") is **not** built in Phase 0 — the field exists so
   the schema is stable when scoring lands.
5. **Code immutable** once referenced by an order/invoice; other fields editable with
   audit.
6. Edits write audit rows (S2). Deactivate, don't delete.

## Seed data (CLAUDE.md §d — real names)

Real customer names — primarily mattress manufacturers (wide-roll wrap/protection
packaging), plus general-packaging secondary customers, each with realistic credit
limits/days and at least one with **multiple ship-to** addresses in different states (to
exercise the IGST path later).

⚠️ Real customer names to be supplied — placeholders until then.

## Public surface

- `/masters/customers` — list, create, edit, deactivate; manage ship-to addresses.
  Admin write; Sales read in Phase 0 (write can widen later per S4).
- Server actions: `createCustomer`, `updateCustomer`, `deactivateCustomer`,
  `addShipTo`, `updateShipTo` — role-checked and audited.

## Acceptance criteria

1. A customer with multiple ship-to addresses persists each with its own GST state code;
   exactly one is default.
2. Malformed GSTIN rejected; null GSTIN accepted.
3. Credit limit/days persist as Decimal/int; no enforcement fires in Phase 0.
4. Tier defaults to `UNGRADED`; no scoring runs.
5. Edits audited; code immutable once referenced.
6. `npm run check` green.

## Open questions

- ⚠️ **"Diamond framework" is undocumented and not in this repo.** Both the customer
  **tier scoring** (§6.1) and **receivables ageing** (§6.5) are meant to be ported from
  it. Locate/confirm access to Diamond before Phase 2. Phase 0 is unblocked — tier is a
  placeholder — but this is the biggest external dependency in the project.
- **Tier band definition** (A/B/C by what dimensions/weights) — deferred with Diamond.
- **PAN required or optional** — **default: optional**, capture when available.
- Whether credit limit is per-company or per-ship-to. **Default: per-customer.**
