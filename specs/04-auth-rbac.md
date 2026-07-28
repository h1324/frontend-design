# Spec S4 — Authentication & Role-Based Access

**Status:** Ready

## Purpose

Full authentication and role-based authorization, so every master and transaction screen
built afterwards is gated as it's created rather than retrofitted.

## Scope

**In:** Auth.js wired end to end, the seven roles, route + action authorization, a user
admin screen (Admin only), password handling, session management.

**Out:** per-module permission _details_ (each module spec states which roles may do
what) — S4 provides the enforcement mechanism and the default role→area map.

## Dependencies

- S0 (Auth.js installed, `User` model, login page).
- S2 (`Role` enum, `companyId`, audit log).

## Roles

`ADMIN | PRODUCTION | STORES | SALES | DISPATCH | ACCOUNTS | VIEWER` (from S2).

Default area access (a starting matrix; individual specs refine):

| Area                             | ADMIN | PRODUCTION | STORES | SALES | DISPATCH | ACCOUNTS | VIEWER |
| -------------------------------- | ----- | ---------- | ------ | ----- | -------- | -------- | ------ |
| Masters (item/customer/supplier) | RW    | R          | R      | R     | R        | R        | R      |
| Production / rolls               | RW    | RW         | R      | R     | R        | R        | R      |
| Stores / GRN                     | RW    | R          | RW     | R     | R        | R        | R      |
| Sales orders                     | RW    | R          | R      | RW    | R        | R        | R      |
| Dispatch / invoice               | RW    | R          | R      | R     | RW       | RW       | R      |
| Costing / reports                | RW    | R          | R      | R     | R        | RW       | R      |
| User admin                       | RW    | –          | –      | –     | –        | –        | –      |

VIEWER is read-only everywhere. Only ADMIN edits masters in Phase 0 (write access for
other roles can widen later).

## Data model

Extend `User` (from S0): `id, companyId, email (unique), name, passwordHash, role,
isActive, lastLoginAt, createdAt`.

## Rules & invariants

1. **Authorization is server-side.** Every protected route handler and server action
   checks the session role; the UI hiding a button is cosmetic, never the control.
2. **Passwords hashed** with a strong adaptive hash (argon2 or bcrypt); never stored or
   logged in plaintext.
3. **Sessions** are JWT with a sensible expiry; logout invalidates client state.
4. **User changes are audited** (create, role change, deactivate) via the S2 audit log.
5. **Deactivate, don't delete** users (referential integrity with audit/actor rows).
6. Least privilege: a new user with no role set is effectively VIEWER until assigned.

## Public surface

- `/login`, `/logout`.
- `/admin/users` — Admin-only CRUD (create, set role, activate/deactivate).
- A server helper `requireRole(session, ...roles)` used by route handlers and actions.
- Middleware gating authenticated vs anonymous (from S0) extended with role checks per
  area.

## Acceptance criteria

1. Unauthenticated access to any protected route redirects to `/login`.
2. A `SALES` user is denied (server-side 403, not just hidden UI) on a masters _write_
   action; a `VIEWER` is denied all writes.
3. Only `ADMIN` can reach `/admin/users`.
4. Creating/changing/deactivating a user writes an audit row.
5. Passwords verified against the hash; wrong password rejected.
6. `npm run check` green, including a role-enforcement test.

## Open questions

- **Password reset / onboarding flow** — email-based reset needs SMTP the plant may not
  have. **Default: Admin sets/resets passwords manually** in Phase 0; self-service reset
  deferred.
- **2FA** — out of scope for Phase 0 unless required.
- Session lifetime. **Default: 12 h**, re-login next shift.
