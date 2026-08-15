# Spec S25 — Quotations & Price Contracts

**Status:** Draft — defaults proposed, confirm before build (the deferred pre-order layer from S18)

## Purpose

Close the gap _before_ the sales order: capture an enquiry, quote a price, and — once a customer
is a repeat buyer — hold that agreed price as a **contract** so every subsequent order prices
itself. S18 starts at a confirmed order with a rate already on the line; this module is where that
rate comes from. It also feeds S27 (mobile order-taking) and S26 (portal), which need a price to
show before an order exists.

## Scope

**In:** a **quotation** document (enquiry → quote → won/lost) with margin visibility at quote time
(reads S21 cost), one-click **convert-to-SO** (S18), and a **price contract / price list** — a
customer- (or tier-) scoped agreed rate per item, optionally slab/quantity-banded, with a validity
window. A resolver (`resolvePrice`) that S18/S26/S27 call to get the rate for a customer+item+qty+date.

**Out:** the credit check and stock reservation (S18 owns those — a quote never touches stock);
receivables (S19); discount-approval hierarchies beyond a single logged margin-floor override;
promotions/scheme engines; freight/landed-price-to-customer estimation (a later refinement).

## Dependencies

- S7 (`Customer`, `tier`), S5 (`Item`, HSN, `gstRatePct`), S18 (`SalesOrder` — the conversion
  target; a quote line maps 1:1 to an SO line), S21 (`lib/costing.ts` — landed/production cost for
  the margin badge), S2 (numbering `QT/FY/seq`, audit). No new money primitive — paise (BigInt)
  rates, `Decimal` quantities/percentages, as everywhere.

## Data model

```
Quotation       id, companyId, docNo (QT/FY/seq), customerId, shipToId?, enquiryDate,
                validUntil, status (DRAFT|SENT|WON|LOST|EXPIRED|CANCELLED),
                lostReason?, convertedSoId?, createdBy
QuotationLine   id, quotationId, itemId, qtyQuoted (Decimal), uom, ratePaise (BigInt),
                gstRatePct (Decimal), unitCostPaise (BigInt, snapshot at quote time)

PriceContract   id, companyId, docNo (PC/FY/seq), scope (CUSTOMER|TIER),
                customerId? (when CUSTOMER), tier? (when TIER),
                validFrom, validUntil?, status (ACTIVE|EXPIRED|CANCELLED), createdBy
PriceContractLine id, priceContractId, itemId, minQty (Decimal, default 0),
                ratePaise (BigInt), gstRatePct (Decimal)
```

`convertedSoId` is set once (a quote converts to exactly one SO; re-conversion is refused).
`unitCostPaise` is a **snapshot** — the cost at the moment the quote was priced, so the margin
shown to the customer is not silently rewritten by a later cost-rate change.

## Rules & invariants

1. **A quotation never moves stock or money.** It is a pre-order document; allocation, credit and
   receivables begin only at the SO it converts into. Convert is create-only: it builds a `DRAFT`
   SO (S18) from the won quote's lines and stamps `convertedSoId`; the SO then runs its own credit
   check at confirmation.
2. **Price resolution is deterministic and pure** (`resolvePrice`): given `(customerId, itemId, qty,
date)` it returns the most specific active rate — **CUSTOMER contract → TIER contract → item
   list/default**, and within a contract the highest `minQty` band the qty clears — or `null` if
   nothing matches (caller then requires a manual rate). No hidden fallbacks; the chosen source is
   returned alongside the rate for display.
3. **Margin floor is advisory, override logged.** Quoting below a configured margin floor (rate vs.
   `unitCostPaise`) warns; sending/winning such a quote requires a logged override (user + reason),
   mirroring the S18 credit-override pattern. Never a hard block by default.
4. **Contracts are cancel-not-superseded-in-place.** A rate change is a new contract (or a new line
   with a later `validFrom`); the old one is cancelled or expires. Overlapping active contracts for
   the same scope+item+band are rejected at save so resolution is unambiguous.
5. **Numbers gapless, FY-wise; every state change audits** (who/what/when/previous). Quotes and
   contracts are cancelled, never deleted.
6. Rates in paise, quantities/percentages `Decimal`; GST rate copied from the item at line creation
   and editable per line (a quote may agree a different applicable rate).

## Public surface

- `/sales/quotations` — list, create, send, mark won/lost, convert-to-SO. SALES writes; the
  margin-floor override is ADMIN/ACCOUNTS only (mirrors S18).
- `/sales/quotations/[id]` — detail: lines with per-line rate, margin badge (green/amber/below-floor),
  validity, convert button.
- `/sales/price-contracts` — list/create/cancel customer- and tier-scoped contracts and lines.
- `lib/pricing.ts` — pure `resolvePrice(ctx, {customerId, itemId, qty, date})` and
  `quoteMargin(ratePaise, unitCostPaise)`; services `createQuotation`, `sendQuotation`,
  `winQuotation`, `convertToSalesOrder`, `upsertPriceContract`, `cancelPriceContract` — role-checked,
  audited. S18 `createSO` extended to seed line rates from `resolvePrice`.

## Acceptance criteria

1. `resolvePrice` returns the most specific active rate (customer > tier > list), honours quantity
   bands and validity windows, and returns `null` when nothing applies — pure and unit-tested.
2. Winning a quotation and converting it produces a `DRAFT` SO whose lines mirror the quote (item,
   qty, rate, GST); a second convert of the same quote is refused.
3. Quoting below the margin floor warns and only proceeds via a logged override (user + reason).
4. Overlapping active contracts for the same scope+item+band are rejected; numbers gapless;
   cancellation keeps the number; all audited.
5. `npm run check` green (price-resolution precedence/bands/validity, margin calc, convert-to-SO,
   overlap rejection).

## Open questions

- ⚠️ **Price precedence & banding.** Is customer > tier > list correct, and are quantity **slabs**
  (band = highest `minQty` cleared) the right shape, or do we need per-order-value discounts too?
  **Default: customer > tier > list, ascending `minQty` slabs, no value discounts.** Confirm.
- ⚠️ **Margin floor authority & hardness.** Who sets the floor and may it ever hard-block?
  **Default: a single company-wide floor %, advisory only, ADMIN/ACCOUNTS override logged.** Confirm.
- **Quote validity default.** How long is a quote good for? **Default: 15 days → `EXPIRED` by a
  routine.** Confirm.
- **GST on quote.** Show tax-inclusive or exclusive to the customer? **Default: exclusive, tax shown
  as a line** (matches the invoice). Confirm.
