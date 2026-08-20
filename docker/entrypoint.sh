#!/usr/bin/env bash
# Container entrypoint: bring the schema up to date, optionally seed, then exec the server.
# Migrations run on every start — `prisma migrate deploy` is idempotent, applying only the
# migrations not yet recorded in the database, so a restart with no new migrations is a no-op.
set -euo pipefail

if [ -z "${DATABASE_URL:-}" ]; then
  echo "[entrypoint] FATAL: DATABASE_URL is not set" >&2
  exit 1
fi

echo "[entrypoint] applying database migrations (prisma migrate deploy)…"
./node_modules/.bin/prisma migrate deploy

# One-off bootstrap of a fresh database. Off by default — set RUN_SEED=true for the very first
# boot of a new install, then unset it so later restarts never re-run the seed.
if [ "${RUN_SEED:-false}" = "true" ]; then
  echo "[entrypoint] RUN_SEED=true — seeding database…"
  npm run db:seed
fi

echo "[entrypoint] starting: $*"
exec "$@"
