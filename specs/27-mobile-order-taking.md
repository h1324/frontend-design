# Spec S27 — Mobile Order-Taking (PWA)

**Status:** Ready — audience decided: internal SALES reps only (rides Auth.js, no S26 dependency). Offline-first, idempotent server sync.

## Purpose

Let a field-sales rep take an order on a phone at the customer's premises —
often on flaky or absent internet, per the brief's factory-connectivity reality — priced from the
S25 contract, and have it land as a real S18 sales order once back online. This is the "mobile
order-taking" line of Phase 4. The device is a thin capture layer; the server stays the source of
truth.

## Scope

**In:** an installable **PWA** for internal SALES reps that works **offline** —
browse a cached catalogue with contract prices (S25), build an order for a chosen customer + ship-to,
capture it locally, and **sync** it to a `DRAFT`/`CONFIRMED` S18 SO when connectivity returns, with a
visible pending/synced/failed queue. Idempotent submission so a retried sync never double-creates.

**Out:** confirming credit-blocked orders on the device (the server runs the S18 credit check at sync
— the device shows the _last known_ credit state as advisory only); stock allocation on the device
(server-side at confirmation); payments; a native app (PWA only — brief §4 explicitly avoids a
separate mobile app); editing masters offline.

## Dependencies

- S18 (`createSO`/`confirmSO` — the sync target and the authority on credit + allocation), S25
  (`resolvePrice` — device shows contract price, server re-resolves at sync as the authority), S7
  (customers/ship-tos), S5 (items catalogue), S4 (SALES auth). The server exposes the existing
  services behind an **idempotent submit endpoint**; the device adds no new business math — it can be
  wrong about price/credit and the server corrects it.

## Data model

Server-side (device state lives in IndexedDB, not the DB):

```
OrderDraftSubmission  id, companyId, clientRequestId (unique — the idempotency key),
                      submittedBy, customerId, shipToId, payloadJson (lines + device-priced rates),
                      status (RECEIVED|APPLIED|REJECTED|SUPERSEDED),
                      resultSoId?, priceDelta? (device vs server), rejectionReason?, at
```

`clientRequestId` is generated on the device when the order is first captured and travels with every
retry — it is the dedupe key. `payloadJson` records what the device _thought_ the price was;
`priceDelta` flags where the server's `resolvePrice` disagreed so the rep is told, rather than the
change being silent.

## Rules & invariants

1. **The server is the authority; the device is a proposal.** At sync the server re-runs
   `resolvePrice` (S25) and the S18 credit check — the device's cached price/credit are advisory. A
   price the device showed is never trusted into an invoice; a divergence is surfaced (`priceDelta`),
   not silently accepted.
2. **Idempotent submit.** Every submission carries a `clientRequestId`; re-submitting the same key
   returns the same result and never creates a second SO. This is the whole correctness story for
   flaky links — retries are safe by construction.
3. **Offline capture is durable but not authoritative.** Orders captured offline sit in a device queue
   and in `OrderDraftSubmission (RECEIVED)` once uploaded; they become real only when `APPLIED` creates
   the SO. A credit-blocked order syncs as a `DRAFT` SO flagged for a logged override (S18) — it is
   never auto-confirmed over the limit.
4. **Cached catalogue is read-only and stamped.** The device caches items + the customer's contract
   prices with a `pricedAsOf` timestamp; a stale cache still lets the rep work, and the server's
   re-resolve at sync is what counts.
5. **Every applied submission audits** (who/device/when → SO), and the SO carries `source=MOBILE` so
   it is distinguishable from desk-entered orders.

## Public surface

- `/m` — the PWA shell (installable, service-worker cached): customer picker, catalogue with contract
  price, cart, submit, and a **sync queue** view (pending/synced/failed with retry).
- `POST` server action `submitMobileOrder({clientRequestId, customerId, shipToId, lines})` — idempotent;
  creates/looks-up the `OrderDraftSubmission`, re-prices, runs `createSO` (+ credit check), returns
  `{soId, status, priceDelta}`.
- `lib/mobile/` — `applyMobileSubmission` (idempotent apply), `mobileCatalogueFor(customerId)` (the
  cacheable, contract-priced projection). Reuses S18/S25 services entirely.

## Acceptance criteria

1. Submitting the same `clientRequestId` twice yields one SO and identical results both times (idempotent).
2. An order captured against a stale cached price is re-priced by the server at sync; a divergence is
   reported as `priceDelta` and the SO uses the server price, not the device price.
3. A credit-over-limit mobile order syncs as a `DRAFT` SO flagged for override, never auto-confirmed.
4. The catalogue projection contains no cost/margin and is scoped to what the rep may sell to that
   customer; SO carries `source=MOBILE`; all applies audited.
5. `npm run check` green (idempotent apply, server re-price authority, credit-block-to-draft path).
   Service-worker/UI behaviour verified manually; unit tests cover the server apply + idempotency.

## Open questions

- ✅ **Who uses it — DECIDED: internal SALES reps only.** Rides the existing Auth.js SALES role, so
  S27 has no dependency on S26 and can ship first. Dealer self-ordering, if ever wanted, would be a
  later feature on the S26 `PortalUser` boundary — not this module.
- ⚠️ **Sync target status.** Do mobile orders arrive as `DRAFT` (staff confirm) or auto-`CONFIRMED`
  when within credit? **Default: auto-`CONFIRMED` when the server credit check passes, `DRAFT` when it
  doesn't** — reps get instant orders, risky ones wait for an override. Confirm.
- **Offline storage & retention.** How long may an unsynced order live on a device before it is
  considered stale? **Default: 7 days in IndexedDB, warned after 48h unsynced.** Confirm.
- **Conflict on price change mid-flight.** If a contract changes between capture and sync, accept the
  new price silently or require rep re-confirm? **Default: apply new price, flag `priceDelta`, keep the
  order** (never drop it). Confirm.
