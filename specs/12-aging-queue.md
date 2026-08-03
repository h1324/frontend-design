# Spec S12 — Aging Queue

**Status:** Built — `lib/aging.ts`: `agingSweep(tx, companyId, asOf, actorUserId?)` flips
`CURING → AVAILABLE` for every roll with `agingReadyDate <= asOf` (one guarded `updateMany`,
a `CURE_COMPLETE` audit per transition, **no ledger posting** — sellability flips, the roll
stays put); idempotent (a second run flips nothing). `releaseEarly(tx, actor, rollId, reason)`
is the logged supervisor override (PRODUCTION-write, reason required, CURING-only). Pure
`agingCountdown` gives the IST-day countdown ("ready today/tomorrow/in N days"). Scheduling
mechanism **confirmed as the default**: `POST /api/jobs/aging-sweep` — a token-authenticated
internal route (`AGING_SWEEP_TOKEN`, timing-safe compare; unset → 503) that a plant cron
container hits hourly, sweeping every company. `/production/aging` UI: the curing queue with
countdowns, an on-demand "Run sweep now", and per-roll "Release early" (reason required);
home nav link added. Verified: 5 pure + 2 DB tests (due-only flip, idempotency, `CURE_COMPLETE`
audit, `availableRolls` after sweep, early-release override + reason-required + gating),
`npm run check` green (148 tests), build OK; runtime-checked the queue render, the token
gate (401/401/200), the sweep flipping exactly the due rolls with null-actor audit rows, and
idempotency.

## Original plan

## Purpose

Move rolls from `CURING` to `AVAILABLE` when their aging-ready date passes, so "available
stock" ≠ "physical stock" is enforced automatically — the time-gated-inventory hard problem
(brief §3b, CLAUDE.md rule 5).

## Scope

**In:** the automatic curing→available transition, the queue UI (what's curing and when it's
ready), and the logged supervisor override for early release.

**Out:** the availability _query_ (already in S3 `availableRolls`), roll creation (S11),
dispatch blocking (S13 uses S3's availability).

## Dependencies

- S3 (`RollState`, `availableRolls`, allocation/override pattern), S2 (audit).

## The transition

Rolls are created `CURING` with an `agingReadyDate` (S11). S3's availability query already
filters `state = AVAILABLE AND agingReadyDate <= now`, but stock reports and the floor need
the **state to actually flip**, so a sweep does it:

```
agingSweep(tx, companyId, asOf): flips every roll where
  state = CURING AND agingReadyDate <= asOf   →   AVAILABLE
  (each transition writes an audit row: CURE_COMPLETE, before/after state)
```

Idempotent — running it twice is a no-op. Implemented in `lib/aging.ts` (pure logic + one
guarded `updateMany`), callable from a scheduled trigger and on-demand.

## Rules & invariants

1. **Only CURING → AVAILABLE** is automatic. No stock movement — the roll doesn't move, its
   sellability flips; audit row only (no ledger posting).
2. **Early release is an override** (CLAUDE.md 5): a supervisor may flip a still-curing roll to
   AVAILABLE before its ready date, recorded with **user + reason** (reuse the S3 override
   pattern). Dispatch/converting against curing stock likewise require this logged override.
3. **Timezone is IST** — "ready today" means ready by end of the IST day (reuse the S2 FY/IST
   convention).

## Public surface

- `/production/aging` — the curing queue: rolls in CURING with ready dates, countdown, and a
  per-roll "release early" (override, reason required). PRODUCTION + ADMIN.
- A scheduled job endpoint/route that runs `agingSweep` (see open questions on mechanism).

## Acceptance criteria

1. `agingSweep` flips exactly the rolls whose `agingReadyDate <= asOf` and leaves the rest;
   running it again changes nothing (idempotent).
2. Each transition writes a `CURE_COMPLETE` audit row.
3. An early release flips a curing roll with a logged override (user + reason); without a
   reason it is refused.
4. After a sweep, `availableRolls` returns the newly-available rolls.
5. `npm run check` green (sweep + override tests).

## Open questions

- ⚠️ **Scheduling mechanism.** On-prem Docker, so options: (a) a Postgres/`pg_cron` job, (b) a
  container cron hitting an internal route, (c) app-level scheduler. **Default: a small cron
  container calling an authenticated internal route** (`POST /api/jobs/aging-sweep`) once an
  hour — simplest to run and observe on the plant mini-PC. Confirm.
- **Sweep frequency** — hourly is plenty (aging is measured in days). Confirm.
- Whether a "just about to be ready" heads-up is wanted (e.g. rolls ready tomorrow). **Default:
  show countdown in the queue; no separate alert in Phase 1.**
