# EPE Foam ERP

Manufacturing operations system for an EPE (expanded polyethylene) foam sheet plant.
Production, inventory, dispatch, and costing — integrating with TallyPrime, not replacing
it. See [`docs/brief.md`](docs/brief.md) for the full brief, [`CLAUDE.md`](CLAUDE.md) for
the engineering rules, and [`specs/`](specs/) for per-module specifications.

## Stack

Next.js (App Router) · TypeScript · PostgreSQL · Prisma · Tailwind + shadcn/ui ·
Auth.js · Vitest.

## Prerequisites

- Node.js 22 LTS
- Docker (for the local PostgreSQL database)

## Getting started

```bash
# 1. Install dependencies
npm install

# 2. Configure environment
cp .env.example .env
npx auth secret            # writes/updates AUTH_SECRET, or set it by hand

# 3. Start PostgreSQL only (docker-compose.override.yml publishes it on localhost:5432)
docker compose up -d db

# 4. Apply migrations and seed the first company + admin user
npm run db:migrate
npm run db:seed

# 5. Run the app
npm run dev                # http://localhost:3000
```

> This is the **host-development** path: Postgres in Docker, the app on your machine. To run the
> whole stack in containers instead (app + hourly aging sweeper + DB), see
> [`docs/deploy.md`](docs/deploy.md) — that path needs `AUTH_SECRET` and `AGING_SWEEP_TOKEN` set
> and doesn't use the host `DATABASE_URL`.

Sign in with the seeded admin: **admin@epe.local** / **admin1234**
(change this immediately outside local development).

## Scripts

| Script               | Does                                          |
| -------------------- | --------------------------------------------- |
| `npm run dev`        | Start the dev server                          |
| `npm run build`      | Production build                              |
| `npm run test`       | Run the Vitest suite                          |
| `npm run typecheck`  | `tsc --noEmit`                                |
| `npm run lint`       | `next lint`                                   |
| `npm run check`      | typecheck + lint + test (the pre-commit gate) |
| `npm run db:migrate` | Apply Prisma migrations (dev)                 |
| `npm run db:seed`    | Seed reference data                           |

## Conventions

- **Migrations only** — never hand-edit the schema against a live database.
- `npm run check` must pass before every commit.
- One module per session; read the relevant `specs/*.md` first.
