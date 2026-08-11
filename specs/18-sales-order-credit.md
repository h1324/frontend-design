# Spec S18 — Sales Order, Credit Control & Customer Tier

**Status:** Built — defaults applied (ACCOUNTS/ADMIN override, equal-weight tier bands, SO optional)

## Purpose

Put an order layer over the direct dispatch built in Phase 1: capture a customer order,
reserve stock against it, enforce the credit limit (S7) with a logged override, and score the
customer tier. Dispatch (S13) then fulfils an SO instead of being raised ad-hoc.

## Scope

**In:** SO header + lines (item, qty, rate, ship-to), allocation of available rolls to an SO,
**credit-limit enforcement** at confirmation with a logged supervisor override, order status
through to fulfilment, and a **customer tier score** (the deferred-from-Phase-1 placeholder
made real). Dispatch links back to the SO.

**Out:** quotations/enquiries and pricing contracts (Phase 3), the receivables ageing math
itself (S19 — this module consumes its outstanding figure), payment collection (Tally).

## Dependencies

- S7 (`Customer` credit fields, `tier`, ship-tos), S13 (dispatch fulfils the SO; `allocateRolls`),
  S3 (availability/allocation), S19 (outstanding receivables for the credit check), S2 (numbering,
  audit).

## Data model

```
SalesOrder      id, companyId, docNo (SO/FY/seq), customerId, shipToId, orderDate,
                status (DRAFT|CONFIRMED|PARTIALLY_FULFILLED|FULFILLED|CANCELLED),
                creditStatus (OK|BLOCKED|OVERRIDDEN), creditOverrideBy, creditOverrideReason,
                createdBy
SalesOrderLine  id, soId, itemId, qtyOrdered (Decimal), uom, ratePaise (BigInt),
                gstRatePct (Decimal), qtyFulfilled (Decimal, maintained by S13)
```

Dispatch (S13) gains a nullable `salesOrderId`; fulfilling an SO increments `qtyFulfilled`
and advances SO status. Customer `tier` (A|B|C|UNGRADED) is recomputed by the scoring service.

## Rules & invariants

1. **Credit check at confirmation:** `outstanding (S19) + this order value` vs
   `customer.creditLimit`. Over limit → `creditStatus = BLOCKED`; confirmation refused unless
   a **logged override** (user + reason) sets `OVERRIDDEN` (mirrors the S12/S3 override
   pattern). Zero/`null` credit limit = cash terms (block any credit exposure).
2. **Allocation reserves specific available rolls** (S3 `allocateRolls`, AVAILABLE→ALLOCATED)
   against the SO; dispatch consumes the reservation.
3. **Tier scoring is deterministic and pure** (`lib/customer-tier.ts`): inputs are volume,
   payment behaviour (from S19 ageing) and outstanding discipline → A/B/C; recompute on demand
   and on invoice/receipt events. No external framework.
4. **Numbers gapless, FY-wise; cancel-not-delete**; every state change audits.
5. Credit-limit values are `Decimal`; order line money in paise.

## Public surface

- `/sales/orders` — list, create, confirm (credit-checked), allocate, cancel. SALES writes
  the order; the **credit override is ADMIN/ACCOUNTS only** (see open questions).
- `/sales/orders/[id]` — detail: lines, allocation, credit status, fulfilment progress.
- Server actions: `createSO`, `confirmSO` (runs the credit check), `overrideCredit`,
  `allocateSO`, `cancelSO` — role-checked, audited. Dispatch (S13) extended to accept an SO.

## Acceptance criteria

1. Confirming an SO within the credit limit succeeds; over the limit it is BLOCKED and only
   proceeds via a logged override (user + reason recorded).
2. Allocation reserves available rolls to the SO; dispatch against the SO advances
   `qtyFulfilled` and SO status; over-fulfilment is prevented.
3. Tier scoring returns a deterministic A/B/C/UNGRADED from its inputs (pure, unit-tested).
4. Numbers gapless; cancellation releases allocations and keeps the number; all audited.
5. `npm run check` green (credit-enforcement, override, allocation, tier-scoring tests).

## Open questions

- ⚠️ **Credit-override authority.** Who may override a block — ACCOUNTS, ADMIN, or a sales
  manager? **Default: ACCOUNTS + ADMIN only**, always logged with reason. Confirm.
- ⚠️ **Tier scoring inputs & bands.** Exact dimensions/weights and A/B/C cutoffs.
  **Default: rolling-12-month dispatched volume + on-time-payment ratio (from S19), equal
  weight, tertile cutoffs**, `UNGRADED` until enough history. Confirm the real formula.
- **SO mandatory before dispatch?** **Default: SO is optional** — Phase-1 ad-hoc dispatch
  still works; an SO adds credit control and reservation when used. Confirm whether dispatch
  should be forced through an SO.
