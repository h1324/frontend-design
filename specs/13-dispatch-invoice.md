# Spec S13 — Dispatch & Invoice

**Status:** Draft — confirm GST-rate source and e-invoice/e-way-bill provider

## Purpose

Turn available rolls into a shipment and a compliant tax invoice: pick rolls → dispatch note →
invoice (correct GST by ship-to state, HSN, document numbering) → mark rolls dispatched, with
genealogy preserved for complaint tracing.

## Scope

**In:** picking/allocation of available rolls, dispatch note, tax invoice (CGST/SGST vs IGST,
HSN, taxable value, IRN + e-way-bill _fields_), and the SERIAL-OUT postings that leave stock.

**Out:** **credit-limit enforcement and receivables** (Phase 2 — order entry), **IRN/e-invoice
API calls and e-way-bill generation** (Phase 3 — fields are built now, APIs later), **Tally
sync** (Phase 3, one-way ERP→Tally). Full sales-order workflow is Phase 2; Phase 1 dispatches
directly against a customer + ship-to.

## Dependencies

- S3 (allocate/`post` SERIAL OUT, availability), S7 (customer + ship-to `gstStateCode`),
  S5 (item HSN + a GST rate — see open questions), S2 (`nextDocNumber`, audit, gapless FY).

## Data model

```
DispatchNote  id, companyId, docNo (DN/FY/seq), customerId, shipToId, dispatchedAt,
              transporter, vehicleNo, lrNo, status (OPEN|DISPATCHED|CANCELLED), createdBy
DispatchRoll  id, dispatchNoteId, rollId (→ Roll)          // the specific rolls shipped
Invoice       id, companyId, docNo (INV/FY/seq), dispatchNoteId, customerId, shipToId,
              invoiceDate, placeOfSupplyStateCode,
              taxableValuePaise, cgstPaise, sgstPaise, igstPaise, totalPaise,
              irn (nullable), signedQr (nullable), ewbNo (nullable), ewbValidTill (nullable),
              status (DRAFT|ISSUED|CANCELLED), createdBy
InvoiceLine   id, invoiceId, itemId, description, hsnCode, qtyKg (Decimal), qtyM2 (Decimal),
              ratePaise, taxableValuePaise, gstRatePct (Decimal),
              cgstPaise, sgstPaise, igstPaise
```

Money in **paise (integers)**; quantities in `Decimal`; every line carries **both kg and m²**
(CLAUDE.md 3). Genealogy: `DispatchRoll → Roll → Lot` is the trace chain.

## Rules & invariants

1. **Tax determination by ship-to state:** seller GST state vs `shipTo.gstStateCode` →
   **intra-state = CGST + SGST**, **inter-state = IGST** (brief §7). Place of supply = ship-to
   state.
2. **Only AVAILABLE, aging-ready rolls dispatch** (S3). Curing/allocated-elsewhere rolls need
   the logged override (S12/S3). Picking sets rolls `ALLOCATED`; dispatch posts **SERIAL OUT**
   (`reason = DISPATCH`) and flips them `DISPATCHED`.
3. **Document numbers gapless, FY-wise; cancel-not-delete** (S2, CLAUDE.md 7). A cancelled
   invoice keeps its number and reverses its stock via S3 reversal.
4. **Invoice model accommodates IRN + signed QR + e-way-bill from day one** (brief §7) even
   though the APIs are Phase 3 — no retrofit.
5. **Not an accounting system** (CLAUDE.md): compute invoice tax for the document, but ledgers/
   returns stay in Tally; the invoice later syncs out (Phase 3).
6. Every movement writes an audit row.

## Public surface

- `/dispatch` — pick rolls for a customer/ship-to, create a dispatch note, generate the
  invoice, print. DISPATCH + ACCOUNTS + ADMIN write (per S4 matrix).
- `/dispatch/[id]` — dispatch + invoice detail, cancel path.
- Server actions: `createDispatch`, `pickRolls`, `generateInvoice`, `cancelInvoice`,
  `cancelDispatch` — role-checked, audited, transactional with the ledger postings.

## Acceptance criteria

1. Dispatching an intra-state ship-to yields CGST+SGST; an inter-state ship-to yields IGST;
   place of supply = ship-to state.
2. Dispatched rolls flip to `DISPATCHED` with SERIAL-OUT postings; they leave availability.
3. Invoice + dispatch numbers are gapless per FY; cancellation reverses stock and keeps the
   number.
4. Each invoice line carries both kg and m² and the correct HSN; totals reconcile
   (taxable + taxes = total), all in paise.
5. Genealogy: a dispatched roll traces back to its lot.
6. `npm run check` green (tax split, numbering, cancellation-reversal, genealogy tests).

## Open questions

- ⚠️ **GST rate source.** Item needs a rate to compute tax. Add `gstRatePct` to the item
  master (S5) or a small HSN→rate tax master? **Default: add `gstRatePct` on `Item`** (simple,
  per-SKU); a tax master can come if rates get shared/complex. Confirm the rate for EPE sheets
  with the CA (Chapter 39).
- ⚠️ **E-invoice (IRN) & e-way-bill provider** — IRP direct or a GSP API, and the e-way-bill
  threshold. **Phase 3**; Phase 1 stores the fields and leaves them null. Confirm the GSP.
- **Sales order in Phase 1?** Brief §6.5 has SO→allocation→dispatch. **Default: direct dispatch
  against customer + ship-to** in Phase 1; the SO layer (with credit block) is Phase 2.
- **Rounding** — invoice rounding to the rupee (a `roundOffPaise` line)? Confirm with the CA;
  **default: round the invoice total to the nearest rupee with a stored round-off.**
