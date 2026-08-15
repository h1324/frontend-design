# Spec S26 — Customer Portal

**Status:** Draft — external-facing; auth model is the blocking decision (defaults proposed)

## Purpose

Give the B2B customer a read-mostly window onto their own account: where their orders are, their
invoices (with the IRN/signed QR from S23), what they owe and how overdue it is, and a channel to
raise a complaint that lands in the S16 genealogy trail. It cuts the "where's my dispatch / send me
that invoice / what's my balance" phone calls that otherwise hit Sales and Accounts.

## Scope

**In:** a **separate external-facing surface** scoped to one customer, showing their **orders/quotes**
(S18/S25 status + fulfilment), **dispatches** (S13 — LR/e-way, delivery status), **invoices** (S13 +
S23 IRN/QR, PDF download), **outstanding & ageing** (S19, read-only), and a **complaint form** that
creates the S16 complaint linked to a roll/invoice. Portal users are provisioned per customer with a
distinct role and can only ever see their own `customerId`.

**Out:** placing/editing orders (that is S27 mobile order-taking / internal SO — the portal is
read-mostly at launch; a "reorder" button just drafts an internal SO for staff to confirm); any
payment collection or gateway (Tally/bank own money movement); price contracts or cost/margin (never
shown externally); cross-customer or internal data of any kind.

## Dependencies

- S4 (Auth.js — extended with an external principal), S7 (`Customer`, ship-tos), S13 (dispatch,
  invoice, LR), S16 (complaint + genealogy), S18/S25 (orders/quotes), S19 (`customerOutstandingPaise`,
  ageing buckets), S23 (IRN/QR/e-way for the invoice view). Reuses existing read services — the portal
  adds **no** new financial math, only a scoped, externally-safe projection of it.

## Data model

```
PortalUser      id, companyId, customerId, email (unique), passwordHash, name,
                status (INVITED|ACTIVE|DISABLED), invitedBy, lastLoginAt?
PortalInvite    id, portalUserId, tokenHash, expiresAt, acceptedAt?
Complaint (extend S16 if not already present)
                id, companyId, customerId, rollId?, invoiceId?, category, description,
                status (OPEN|ACKNOWLEDGED|INVESTIGATING|RESOLVED|REJECTED),
                raisedVia (PORTAL|INTERNAL), createdBy (portalUserId or userId)
```

`PortalUser` is a **distinct principal type** from the internal `User` (different table, different
role space) so an external login can never be mistaken for a staff account or carry an internal
`Area` grant. Every portal query is hard-filtered by the session's `customerId` at the data layer,
not just the UI.

## Rules & invariants

1. **Tenant isolation is enforced server-side, always.** Every portal loader derives `customerId`
   from the authenticated `PortalUser` session and filters on it; a portal request can never pass a
   `customerId` (or invoice/roll id belonging to another customer) and have it honoured. IDs are
   ownership-checked, not trusted from the URL.
2. **Read-mostly.** The only writes a portal user can make are: raise a complaint, and request a
   reorder (which creates an **internal DRAFT SO** for staff — it does not confirm, allocate, or bill).
   No portal action touches the stock ledger, credit, or receivables directly.
3. **Nothing internal leaks.** Cost, margin, other customers, internal notes, supplier/production data
   are never selected into a portal projection. What the customer sees is their own documents plus the
   public-by-nature invoice fields (incl. the GST IRN/QR, which is designed to be shared).
4. **Invoices are shown as issued** — the portal never recomputes tax or totals; it renders the stored
   S13 invoice and the S23 IRN/QR. Outstanding/ageing come straight from S19.
5. **Every portal login and complaint audits** (who = portalUserId, what, when). Invites are single-use,
   expiring, token-hashed at rest.

## Public surface

- `/portal/login`, `/portal/accept-invite/[token]` — external auth, separate from internal `/login`.
- `/portal` — dashboard: outstanding + ageing summary, open orders, recent dispatches, open complaints.
- `/portal/orders`, `/portal/orders/[id]` — order/quote status + fulfilment; "reorder" (drafts internal SO).
- `/portal/invoices`, `/portal/invoices/[id]` — invoice list + detail with IRN/QR and PDF.
- `/portal/complaints` — raise + track; links a roll/invoice.
- Internal: `/customers/[id]/portal-users` — SALES/ADMIN invite/disable portal users.
- `lib/portal/` — `portalSession` (external auth guard returning a `customerId`-scoped context),
  `invitePortalUser`, `raiseComplaint`, `requestReorder`; all loaders take the scoped context, never a
  raw id.

## Acceptance criteria

1. A portal user sees only their own customer's orders, dispatches, invoices, outstanding and
   complaints; any attempt to load another customer's document id is denied (ownership-checked).
2. The invoice view renders the stored invoice with S23 IRN/signed-QR and a downloadable PDF; no tax
   or total is recomputed in the portal.
3. Raising a complaint creates an S16 complaint (`raisedVia=PORTAL`) linked to the roll/invoice and is
   visible to internal QC.
4. "Reorder" creates an internal `DRAFT` SO only — it does not confirm, allocate stock, or bill.
5. `npm run check` green (tenant-isolation guard, ownership checks, complaint creation, invite
   lifecycle). Portal auth-scope tests are the priority; UI tests skipped per CLAUDE.md.

## Open questions

- ⚠️ **Auth model for external users.** Separate `PortalUser` table + credentials (proposed), magic-link
  only, or federate to the customer's own identity? **Default: separate `PortalUser` with invite +
  password + optional magic-link, isolated from internal Auth.js roles.** This is the blocking decision —
  it sets the whole security boundary. Confirm.
- ⚠️ **Exposure surface.** Is showing full ageing/overdue exposure to the customer desirable, or only the
  document-level balance? **Default: show their own ageing (it is their money), never internal cost/margin.**
  Confirm.
- **Reorder depth.** Should the portal ever place a confirmable order, or always draft-for-staff?
  **Default: draft-for-staff at launch;** real self-service ordering is S27's job. Confirm.
- **Hosting/exposure.** Same Next.js app on a distinct route + Cloudflare Tunnel, or a separate origin?
  **Default: same app, `/portal/*` segment, separate session cookie.** Confirm with the deployment plan.
