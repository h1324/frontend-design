# Spec S24 — Tally Sync

**Status:** Built — MockConnector default, explicit CustomerTallyMap, receipts Tally→ERP only (open questions defaulted)

## Purpose

Hold the boundary CLAUDE.md draws: **TallyPrime is the statutory book of record.** This ERP
owns production, inventory, dispatch, costing and credit control; Tally owns the ledgers. This
module is the bridge — invoices sync **out** to Tally (sales vouchers), and receipts sync
**in** from Tally (the payment side of S19), so neither system double-keys and neither double-
counts.

## Scope

**In:** a one-way **ERP→Tally invoice export** (issued invoices → Tally sales vouchers) and a
one-way **Tally→ERP receipt import** (Tally receipts → S19 `Receipt` rows tagged `source=TALLY`),
each idempotent, with a sync log and a manual "sync now" plus a reviewable queue. A connector
abstraction with a **MOCK** implementation (and a Tally XML payload builder) so it runs with no
live Tally.

**Out:** building any ledger/trial-balance/GST-return logic here (forbidden — CLAUDE.md); master
sync (ledgers/stock items are assumed to exist in Tally, matched by name/alias); two-way
conflict resolution beyond "Tally wins for receipts, ERP is source for invoices"; realtime
streaming (this is batch/on-demand).

## Dependencies

- S13 (`Invoice` — the export source), S19 (`Receipt` with `ReceiptSource.TALLY` already in the
  enum — the import target), S7 (customer↔Tally ledger name mapping), S2 (audit). Credentials
  and the Tally endpoint come from environment, never the repo.

## Data model

```
TallySync   id, companyId, entityType (INVOICE|RECEIPT), entityId (nullable for inbound-new),
            direction (OUT|IN), status (PENDING|SENT|ACK|ERROR|SKIPPED),
            externalRef (Tally voucher GUID/number), payloadHash, attempts, lastError, at
CustomerTallyMap  id, companyId, customerId (unique), tallyLedgerName
```

Idempotency is by `payloadHash` (outbound) and `externalRef` (inbound) — a voucher already
synced is never re-sent or re-imported. All money stays in **paise (BigInt)** internally,
formatted to rupees in the Tally XML.

## Rules & invariants

1. **ERP is the source of truth for invoices; Tally for receipts** — the sync never overwrites
   the owner. Invoice export is create-only in Tally (a cancelled invoice sends a cancellation
   voucher, never a silent edit).
2. **Idempotent** — re-running a sync is safe; dedupe by `payloadHash` (out) / `externalRef`
   (in). An imported receipt reuses S19 `recordReceipt` so ageing/outstanding stay consistent.
3. **No ledger logic here** — this module only marshals documents across the boundary; balances
   live in Tally.
4. **Every attempt logs a `TallySync` row** (status, external ref, error); failures are
   retryable and visible, never silently dropped.
5. **Secrets/endpoint from environment**; the connector interface takes injected config — the
   MOCK connector needs none.

## Public surface

- `/integrations/tally` — sync status board: pending/failed invoices out, imported receipts in,
  retry a failed item, "sync now". ACCOUNTS + ADMIN write.
- `lib/tally/` — `connector.ts` (interface + `MockConnector`), `tally-sync.ts` services
  (`exportInvoice`, `importReceipts`, `retry`), pure `buildSalesVoucherXml(invoice, ledgerName)`
  and `parseReceiptVoucher(xml)`.

## Acceptance criteria

1. An issued invoice exports to a Tally sales-voucher payload (MOCK connector) and records a
   `SENT/ACK` `TallySync` row; re-export is a no-op (idempotent by `payloadHash`).
2. A Tally receipt imports as an S19 `Receipt` tagged `source=TALLY`, lowering outstanding, and
   is not re-imported on a second run (dedupe by `externalRef`).
3. A cancelled invoice sends a cancellation voucher, never an edit.
4. `buildSalesVoucherXml` produces well-formed Tally XML from an invoice + ledger name (pure).
5. `npm run check` green (payload build, idempotency both directions, receipt round-trip).

## Open questions

- ⚠️ **Connector mechanism.** Tally's HTTP XML gateway (port 9000), a file drop (XML import), or
  a third-party bridge? **Default: HTTP XML gateway with a `MockConnector`** for tests; the real
  adapter targets the chosen transport. Confirm.
- ⚠️ **Ledger/stock-item mapping.** Match customers to Tally ledgers by name, or an explicit
  map? **Default: an explicit `CustomerTallyMap`** (falls back to customer name). Confirm naming.
- **Receipt import trigger** — manual "sync now", polling, or a Tally-side push? **Default:
  manual + on-demand**; scheduled polling can be added (a routine) once the transport is fixed.
- **Sync direction lock** — confirm receipts are _only_ ever Tally→ERP so S19's manual entry and
  the import never double-count (S19 `source` flag exists for exactly this).
