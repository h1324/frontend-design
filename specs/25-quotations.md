# Spec S25 — Quotations & Price Contracts

**Status:** Built — customer > tier > list slab pricing + order-value discounts (`ValueDiscountTier`), advisory margin floor with logged override, convert-to-SO. The deferred pre-order layer from S18.

## Purpose

Close the gap _before_ the sales order: capture an enquiry, quote a price, and — once a customer
is a repeat buyer — hold that agreed price as a **contract** so every subsequent order prices
itself. S18 starts at a confirmed order with a rate already on the line; this module is where that
rate comes from. It also feeds S27 (mobile order-taking) and S26 (portal), which need a price to
show before an order exists.

## Scope

**In:** a **quotation** document (enquiry → quote → won/lost) with margin visibility at quote time
(reads S21 cost), one-click **convert-to-SO** (S18), and a **price contract / price list** — a
customer- (or tier-) scoped agreed rate per item, quantity-slab-banded, with a validity window, plus
**order-value discounts** (a whole-order % off above a value threshold). Two resolvers the rest of
the sales side calls: `resolvePrice` (per-line rate for a customer+item+qty+date) and
`resolveOrderDiscount` (the order-total discount for a customer/tier+order-value+date).

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
ValueDiscountTier id, companyId, scope (CUSTOMER|TIER), customerId? (when CUSTOMER),
                tier? (when TIER), minOrderValuePaise (BigInt), discountPct (Decimal),
                validFrom, validUntil?, status (ACTIVE|EXPIRED|CANCELLED), createdBy
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
3. **Order-value discount is a second, orthogonal axis** (`resolveOrderDiscount`): after every line
   is priced, the pre-tax order subtotal picks the highest `minOrderValuePaise` tier it clears
   (customer tier → customer's price-tier, same specificity order), yielding one whole-order
   discount %. It applies to the taxable subtotal **before** GST, is recorded as its own line
   (never smeared into unit rates, so genealogy of the price stays legible), and defaults to 0% when
   no tier applies. Per-line slab pricing and the order-value discount stack; neither overrides the
   other.
4. **Margin floor is advisory, override logged.** Quoting below a configured margin floor (rate vs.
   `unitCostPaise`, measured **after** the order-value discount) warns; sending/winning such a quote
   requires a logged override (user + reason), mirroring the S18 credit-override pattern. Never a
   hard block by default.
5. **Contracts are cancel-not-superseded-in-place.** A rate change is a new contract (or a new line
   with a later `validFrom`); the old one is cancelled or expires. Overlapping active contracts for
   the same scope+item+band are rejected at save so resolution is unambiguous.
6. **Numbers gapless, FY-wise; every state change audits** (who/what/when/previous). Quotes and
   contracts are cancelled, never deleted.
7. Rates in paise, quantities/percentages `Decimal`; GST rate copied from the item at line creation
   and editable per line (a quote may agree a different applicable rate).

## Public surface

- `/sales/quotations` — list, create, send, mark won/lost, convert-to-SO. SALES writes; the
  margin-floor override is ADMIN/ACCOUNTS only (mirrors S18).
- `/sales/quotations/[id]` — detail: lines with per-line rate, margin badge (green/amber/below-floor),
  validity, convert button.
- `/sales/price-contracts` — list/create/cancel customer- and tier-scoped contracts, lines, and
  order-value discount tiers.
- `lib/pricing.ts` — pure `resolvePrice(ctx, {customerId, itemId, qty, date})`,
  `resolveOrderDiscount(ctx, {customerId, orderValuePaise, date})`, and
  `quoteMargin(ratePaise, unitCostPaise)`; services `createQuotation`, `sendQuotation`,
  `winQuotation`, `convertToSalesOrder`, `upsertPriceContract`, `upsertValueDiscountTier`,
  `cancelPriceContract` — role-checked, audited. S18 `createSO` extended to seed line rates from
  `resolvePrice` and the order discount from `resolveOrderDiscount`.

## Acceptance criteria

1. `resolvePrice` returns the most specific active rate (customer > tier > list), honours quantity
   bands and validity windows, and returns `null` when nothing applies — pure and unit-tested.
2. `resolveOrderDiscount` returns the highest value-tier the pre-tax subtotal clears (customer >
   tier), applied to the taxable subtotal before GST as its own line, 0% when none applies — pure
   and unit-tested; per-line slab pricing and the order-value discount stack correctly.
3. Winning a quotation and converting it produces a `DRAFT` SO whose lines mirror the quote (item,
   qty, rate, GST) and carries the resolved order-value discount; a second convert of the same quote
   is refused.
4. Quoting below the margin floor (measured after the order-value discount) warns and only proceeds
   via a logged override (user + reason).
5. Overlapping active contracts/value-tiers for the same scope+item+band are rejected; numbers
   gapless; cancellation keeps the number; all audited.
6. `npm run check` green (price-resolution precedence/bands/validity, order-discount tiers, margin
   calc post-discount, convert-to-SO, overlap rejection).

## Open questions

- ✅ **Price precedence & banding — DECIDED.** Customer > tier > list, ascending `minQty` slabs, **and**
  order-value discounts (a whole-order % above a value threshold, via `ValueDiscountTier`). Both axes
  stack; the value discount applies to the pre-tax subtotal as its own line.
- **Margin floor authority & hardness.** Who sets the floor and may it ever hard-block?
  **Default: a single company-wide floor %, advisory only, ADMIN/ACCOUNTS override logged.** Tuning —
  flip without schema change.
- **Quote validity default.** How long is a quote good for? **Default: 15 days → `EXPIRED` by a
  routine.** Confirm.
- **GST on quote.** Show tax-inclusive or exclusive to the customer? **Default: exclusive, tax shown
  as a line** (matches the invoice). Confirm.
