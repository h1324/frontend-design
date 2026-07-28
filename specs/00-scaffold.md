# Spec S0 — Project Scaffold & Toolchain

**Status:** Built — Next.js 15 + React 19, Prisma 6 + PostgreSQL, Tailwind + shadcn/ui,
Auth.js v5 (credentials, JWT), Vitest, ESLint + Prettier. Verified: migration applies,
seed loads, `/` redirects when logged out, admin login round-trips, `npm run check` green,
`npm run build` succeeds.

## Purpose

Stand up the empty-but-running project so every later session has a booting app, a
database, a test runner, and a login. No business logic.

## Scope

**In:** Next.js + TypeScript app, Tailwind + shadcn/ui, Prisma + PostgreSQL (via
docker-compose for local dev), Vitest, ESLint + Prettier, Auth.js installed with a
minimal credentials login and a single seeded admin user, an npm `check` script, and a
first empty migration.

**Out:** any master, ledger, or UOM code (their own sessions). Full RBAC (S4) — S0 ships
only "logged in vs not."

## Dependencies

None. This is the first session.

## Deliverables

- `package.json` scripts: `dev`, `build`, `test`, `lint`, `format`, `check`
  (`check` = typecheck + lint + test, the pre-commit gate).
- `docker-compose.yml` running PostgreSQL 16 for local dev.
- `prisma/schema.prisma` with datasource + generator and **one** `User` model
  (id, email, name, passwordHash, role, companyId) so Auth.js has something to bind to.
- `prisma/seed.ts` stub that creates one company and one admin user.
- `lib/db.ts` — the singleton Prisma client.
- `lib/decimal.ts` — re-export of the Decimal type + the project's scale constants, so
  every module imports scales from one place.
- Auth.js configured with a credentials provider; `/login` page; middleware that
  redirects unauthenticated users. Sessions are JWT.
- Vitest configured; one trivial passing test to prove the runner works.
- `.env.example` documenting `DATABASE_URL`, `AUTH_SECRET` (never commit real values).
- `README.md` in repo root: how to run (`docker compose up`, `npm run dev`), how to
  test, how to migrate.

## Rules & invariants

- **Migrations only** — `prisma migrate dev`, never `db push` against real data, never
  hand-edited SQL for schema.
- Secrets come from env; `.env` is git-ignored, `.env.example` is committed.
- `npm run check` must pass before any commit (this is the standing gate for all
  sessions).

## Acceptance criteria

1. `docker compose up` starts Postgres; `npm run dev` boots the app.
2. `npm run test` runs and the trivial test passes.
3. `npx prisma migrate dev` applies the initial migration cleanly on an empty DB.
4. Visiting a protected route while logged out redirects to `/login`; the seeded admin
   can log in.
5. `npm run check` is green.

## Open questions

- Package manager (npm / pnpm / bun). **Default: npm** unless you prefer pnpm.
- Node LTS version to pin in `.nvmrc`. **Default: latest LTS.**
