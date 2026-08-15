# Spec S29 — Cross-Entity Consolidated View

**Status:** Draft — activates the day-one `company_id`; second-entity data model & access are the decisions

## Purpose

Cash the option the schema has carried since day one. Every table has `company_id` "to avoid a painful
multi-entity retrofit" (specs/README cross-cutting #3) even though there is a single entity at launch.
This module is the payoff: when a second plant/company exists, give an owner/admin a **consolidated
read-only view** — stock, sales, receivables, production — across entities, without merging their
ledgers or breaking the per-company isolation every other module relies on.

## Scope

**In:** an **entity-group** grouping of companies, a **consolidated dashboard** (aggregate + per-entity
breakdown) over existing S22 KPIs, S19 receivables, S3 stock, and S13 sales, and a **company switcher /
"all entities" scope** for authorised users. Strictly **read-only aggregation** — it reads each
company's data through the same scoped services and sums; it writes nothing operational.

**Out:** any cross-entity _transaction_ (inter-company stock transfer, inter-company billing — a much
larger, later module); consolidated statutory accounts or elimination entries (that is the CA's Tally
work, forbidden here per CLAUDE.md); changing the single-tenant isolation for ordinary users; a generic
BI/report-builder. Currency is uniform ₹ (single-country) — no FX.

## Dependencies

- The universal `companyId` on every table (S2 + all modules), S22 (`lib/kpi.ts` — reused per company
  then aggregated), S19 (receivables per company), S3 (stock/availability per company), S13 (sales),
  S4 (a new group-level access grant). No new per-transaction math — this is a fan-out-then-fold over
  existing scoped queries.

## Data model

```
EntityGroup       id, name, createdBy
EntityGroupMember id, entityGroupId, companyId (unique per group)
UserEntityAccess  id, userId, entityGroupId, scope (GROUP_READ),
                  grantedBy, grantedAt
```

No operational table gains a column — the consolidated view is a **query concern, not a storage one**.
Isolation stays intact: an ordinary user is still pinned to one `companyId`; only a user with an
explicit `UserEntityAccess (GROUP_READ)` grant may fan a read across the group's member companies.

## Rules & invariants

1. **Consolidation is read-only and additive.** The view fans a read across member companies (each
   through the _same_ company-scoped service used normally) and folds the results — sum for money/qty,
   weighted where a rate. It never writes, never nets one entity's balance against another's, and never
   creates an inter-company entry.
2. **Group access is an explicit, audited grant, separate from role.** Seeing across entities requires
   `UserEntityAccess (GROUP_READ)`; without it a user sees only their own `companyId`, exactly as today.
   Granting/revoking audits (who/whom/when). This grant widens _read_ only — it never widens write into
   another entity.
3. **Per-entity provenance is always preserved.** Every consolidated figure is presented with its
   per-entity breakdown; the aggregate never hides which company contributed what (required for the
   owner to act, and to keep the numbers auditable back to a single company's module).
4. **Money stays paise/Decimal and same-currency.** Aggregation sums paise directly; no rounding at the
   fold beyond display. Uniform ₹ — no FX conversion in scope.
5. **No leakage downward.** The group view does not expose one entity's operational documents inside
   another entity's normal (single-company) screens; cross-entity data appears _only_ under the explicit
   group scope.

## Public surface

- `/group` — consolidated dashboard: total + per-entity stock value, sales, receivables ageing,
  production output/OEE; entity filter. Visible only with a `GROUP_READ` grant.
- Company switcher in the top nav — "All entities" appears only for group-scoped users; otherwise the
  user's single company (usually invisible at single-entity launch).
- `/admin/entity-groups` — ADMIN: define groups, add member companies, grant/revoke `GROUP_READ`.
- `lib/group/` — `groupContext(user)` (resolves the accessible company set), `consolidate(metricFn,
companies)` (the fan-out-then-fold helper) reused across dashboards; each metric reuses its existing
  per-company service, so no metric is re-implemented.

## Acceptance criteria

1. With a single company (launch state) the system behaves exactly as today — no `/group`, no switcher,
   no behavioural change; the consolidation code is dormant until a second entity + grant exist.
2. A `GROUP_READ` user sees an aggregate across member companies **with** a correct per-entity breakdown;
   the aggregate equals the sum of the per-entity figures (money in paise, no drift).
3. A user **without** the grant cannot reach `/group` or any other company's data — single-company
   isolation holds; the grant widens read only, never write.
4. Grant/revoke and group membership changes are audited; no inter-company transaction or netting is
   possible through this module.
5. `npm run check` green (group-scope resolution, fan-out-fold aggregate == sum of parts, isolation
   holds without the grant). Uses a two-company fixture.

## Open questions

- ⚠️ **Is a second entity actually coming, and when?** This module is dormant until then. **Default:
  build the read-only consolidation seam now (it is cheap because `company_id` already exists), defer the
  UI polish until a real second entity is created.** Confirm whether to build now or hold.
- ⚠️ **Inter-company transactions.** Will entities ever transfer stock or bill each other? That is a
  separate, much larger module (stock movement + tax between GSTINs). **Default: explicitly out of scope
  here — this spec is _view only_.** Confirm so expectations are set.
- **Grant granularity.** Is a single `GROUP_READ` enough, or do we need per-module group grants (e.g.
  see consolidated sales but not consolidated cost)? **Default: one `GROUP_READ` covering the read-only
  dashboards.** Confirm.
- **Entity identity.** Are separate entities separate GSTINs under one owner, or divisions of one GSTIN?
  Affects nothing in storage (both are `company` rows) but matters for how "consolidated" is read.
  Confirm for labelling.
