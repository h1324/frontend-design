# Spec S19 — Receivables Ageing (credit control)

**Status:** Built — defaults applied (manual receipts w/ source flag, 30/60/90 buckets, on-account allowed)

## Purpose

Track what each customer owes and how overdue it is, so the credit check (S18) and tier
scoring have real numbers. This is a **credit-control view**, not an accounting ledger — the
statutory books stay in Tally (CLAUDE.md). Outstanding = issued invoices − recorded receipts;
ageing buckets show how late.

## Scope

**In:** a receipts record (payment applied to invoices), the per-customer **outstanding**
figure, **ageing buckets** (current / 0–30 / 31–60 / 61–90 / 90+ by invoice due date), and the
`outstanding` input that S18's credit check and tier scoring consume.

**Out:** the general ledger, TDS, bank reconciliation, P&L — all Tally (CLAUDE.md forbids
building ledgers here). Invoice creation is S13; credit enforcement is S18. No cash-flow
forecasting (Phase 3+).

## Dependencies

- S13 (`Invoice` totals + date; add `dueDate` derived from customer `creditDays`), S7
  (`creditDays`), S18 (consumes `outstanding`; tier scoring reads the ageing), S2 (numbering,
  audit).

## Data model

```
Receipt       id, companyId, docNo (RCT/FY/seq), customerId, receivedAt, mode (CASH|BANK|UPI|CHEQUE|ADJUSTMENT),
              amountPaise (BigInt), reference, source (MANUAL|TALLY), status (POSTED|CANCELLED), createdBy
ReceiptAllocation id, receiptId, invoiceId, amountPaise (BigInt)   // which invoices a receipt settles
```

`Invoice` gains a derived `dueDate` (invoiceDate + customer.creditDays) and a maintained
`amountSettledPaise`. **Outstanding for a customer** = Σ issued-invoice totals − Σ receipt
allocations. Ageing buckets a customer's unsettled invoice balances by `dueDate` vs today
(IST). All money in **paise (BigInt)**.

## Rules & invariants

1. **Not a ledger.** Receipts here exist only to compute outstanding/ageing for credit
   decisions; they never post to a financial ledger. Reversible by cancellation, never edited.
2. **A receipt's allocations cannot exceed its amount**, and an invoice cannot be settled
   beyond its total (over-allocation blocked). Unallocated receipt amount is "on account".
3. **Ageing is by invoice `dueDate`** (invoiceDate + `creditDays`), computed in IST (reuse the
   S2 FY/IST convention).
4. **Cancelling an invoice (S13) unwinds its receivable**; cancelling a receipt reverses its
   allocations. Numbers gapless, FY-wise; everything audited.
5. Outstanding is derived on read (or a maintained aggregate) — S18 calls one function.

## Public surface

- `/receivables` — per-customer outstanding + ageing summary; record a receipt and allocate
  it to invoices. ACCOUNTS + ADMIN write; SALES read (to see a customer's exposure).
- `/receivables/[customerId]` — the customer's open invoices, ageing, and receipt history.
- Server actions: `recordReceipt`, `allocateReceipt`, `cancelReceipt` — role-checked, audited.
- `lib/receivables.ts` — pure ageing-bucket helper + `customerOutstanding(db, customerId)`
  used by S18's credit check.

## Acceptance criteria

1. Recording a receipt and allocating it to invoices lowers the customer's outstanding by the
   allocated amount; over-allocation is rejected.
2. Ageing buckets a customer's unsettled balances correctly by due date (IST).
3. `customerOutstanding` matches Σ invoices − Σ allocations and drives the S18 credit check.
4. Cancelling a receipt or its invoice unwinds the receivable; numbers retained; audited.
5. `npm run check` green (outstanding, ageing-bucket, over-allocation, cancellation tests).

## Open questions

- ⚠️ **Payment source.** Receipts entered manually here, or synced from Tally (the book of
  record)? **Default: manual entry now with a `source` flag (`MANUAL`/`TALLY`)**; a one-way
  Tally→ERP receipt sync lands in Phase 3 costing/sync. Confirm the direction so we don't
  double-count once Tally sync exists.
- ⚠️ **Ageing bucket boundaries** — 30/60/90 or the plant's own (e.g. by `creditDays`).
  **Default: current + 0–30 / 31–60 / 61–90 / 90+**, bucketed from `dueDate`. Confirm.
- **On-account / advance receipts** — **default: allowed** (unallocated amount reduces
  outstanding and is allocatable later).
