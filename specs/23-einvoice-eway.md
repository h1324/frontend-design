# Spec S23 — E-Invoice (IRN) & E-Way Bill

**Status:** Built — MockProvider default; thresholds/cancel-window as config (open questions defaulted)

## Purpose

Populate the e-invoice and e-way-bill fields the S13 invoice already carries — `irn`,
`signedQr`, `ewbNo`, `ewbValidTill` — by calling the IRP/GSP, so a dispatched invoice is
statutorily compliant (IRN + signed QR) and legally movable (e-way bill). The fields were
built day one with no retrofit; this module turns them on.

## Scope

**In:** a provider abstraction over the IRP (e-invoice) and NIC (e-way bill) APIs with a
**MOCK** implementation (deterministic fake IRN/QR/EWB) as the default so the flow works with
no external credentials; generating an IRN for an issued invoice, generating/updating an
e-way bill, cancelling an IRN within the allowed window, and an attempt log. Threshold gating
(only invoices above the e-invoice/e-way-bill limits require it).

**Out:** the invoice document itself (S13), GSTR filing/returns (Tally), the GST portal login,
b2c dynamic QR, and storing GSP credentials in code (they come from environment/secrets, never
the repo).

## Dependencies

- S13 (`Invoice` with the IRN/QR/EWB columns, totals, place-of-supply, HSN lines), S7
  (customer GSTIN/ship-to state), the company GSTIN, S2 (audit). No schema change to `Invoice`
  beyond a status/log table.

## Data model

```
EInvoiceLog  id, companyId, invoiceId, action (GEN_IRN|CANCEL_IRN|GEN_EWB|CANCEL_EWB),
             provider (MOCK|<gsp>), status (OK|ERROR), requestHash, responseRef,
             errorCode, errorMessage, at
Invoice      (existing fields populated: irn, signedQr, ewbNo, ewbValidTill;
             + einvoiceStatus (NONE|GENERATED|CANCELLED), ackNo, ackDate)
```

Money and payloads never store secrets. The provider is chosen by config; the **MOCK** provider
returns deterministic values so integration tests and demos run with no network.

## Rules & invariants

1. **Idempotent generation** — an invoice already carrying an IRN is never re-submitted; a
   second call is a no-op that returns the stored IRN (dedupe by `requestHash`).
2. **E-invoice applicability is turnover + B2B, never invoice value** — an IRN is generated only
   when the company is over the GST AATO threshold (the `Company.einvoiceApplicable` flag, set once
   turnover crosses ₹5 cr) **and** the buyer is B2B (has a GSTIN). A B2C invoice (no buyer GSTIN)
   is marked `NONE`, whatever its value — never submitted, never errored. Every eligible line must
   carry a 6- or 8-digit HSN, or generation is refused. The **e-way bill** is the value-gated one
   (≥ ₹50,000 consignment).
3. **Cancel window** — an IRN may be cancelled only within the statutory window (24h, config);
   after that it is refused and must be handled by a credit note (S13 cancel).
4. **Every call writes an `EInvoiceLog`** (who/when/status/error); nothing is silently dropped.
5. **Secrets from environment only**; the provider interface takes injected credentials — none
   are committed (CLAUDE.md / repo hygiene).

## Public surface

- `/dispatch/[id]` (extend) — "Generate IRN" and "Generate e-way bill" actions on an issued
  invoice, showing IRN/QR/EWB and the last attempt; DISPATCH/ACCOUNTS + ADMIN write.
- `lib/einvoice/` — `provider.ts` (interface + `MockProvider`), `einvoice.ts` services
  (`generateIrn`, `cancelIrn`, `generateEwayBill`) building the IRP payload from the invoice,
  pure `buildIrpPayload(invoice)`, `isEInvoiceApplicable(companyApplicable, buyerGstin)`,
  `isValidEInvoiceHsn(hsn)`, and value-gated `isEwayBillRequired(totalPaise, thresholds)`.

## Acceptance criteria

1. Generating an IRN on an eligible invoice (MOCK provider) populates `irn`/`signedQr`/`ackNo`
   and logs the attempt; a second call is a no-op returning the same IRN.
2. A B2C invoice (no buyer GSTIN), or one from a sub-threshold company, is marked `NONE`, not
   submitted — regardless of value.
3. An e-way bill generates with a validity date; IRN cancel within the window clears the fields
   and logs it; outside the window it is refused.
4. `buildIrpPayload` produces a schema-shaped payload from the invoice + GSTINs (pure test).
5. `npm run check` green (payload build, idempotency, threshold, cancel-window tests).

## Open questions

- ⚠️ **GSP/IRP provider.** Which GSP (e.g. a NIC-authorised GSP) and sandbox credentials?
  **Default: a `MockProvider`** that satisfies the interface; the real adapter is added when the
  GSP is chosen. Confirm the provider so the adapter targets its schema.
- ⚠️ **Thresholds.** E-invoice is keyed on the `Company.einvoiceApplicable` turnover flag + a B2B
  buyer (not a value limit); the **e-way bill** is value-gated. **Default: e-way bill ≥ ₹50,000
  consignment** (config constant), editable. Confirm the current e-way-bill limit.
- **E-way-bill distance/validity** — auto-distance (PIN-to-PIN) or manual? **Default: manual
  distance entry** feeding validity; auto-distance when the provider supports it.
