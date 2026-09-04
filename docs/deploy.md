# Deployment — on-premise plant machine

The plant runs the whole stack with Docker Compose (brief §4): Postgres, the Next.js app, and a
sweeper that fires the hourly aging sweep (S12). The app applies database migrations on every
start, so a deploy is "pull, build, up".

> **Always deploy with `-f docker-compose.yml`.** The repo also ships
> `docker-compose.override.yml`, a _developer_ convenience that publishes the Postgres port to the
> host. Plain `docker compose` auto-merges it — which you do **not** want in production (the DB
> should stay on the internal network). Passing `-f docker-compose.yml` uses the base file only.
> (Alternatively, delete `docker-compose.override.yml` on the plant machine.)

## One-time setup

1. Install Docker Engine + the Compose plugin on the plant mini-PC.
2. Create `.env` next to `docker-compose.yml` (copy `.env.example`) and set, at minimum:
   - `POSTGRES_PASSWORD` — a strong DB password (not the `epe` default).
   - `AUTH_SECRET` — `openssl rand -base64 32`. Required; the app refuses to start without it.
   - `AGING_SWEEP_TOKEN` — `openssl rand -hex 32`. Required; guards the sweep endpoint.
     `DATABASE_URL` is derived from the `POSTGRES_*` values inside Compose — you do not set it there.

## First boot (fresh database)

Seed the real SKUs, suppliers and customers exactly once:

```bash
RUN_SEED=true docker compose -f docker-compose.yml up -d --build
```

Then **change the seeded admin password** (`admin@epe.local` / `admin1234`) immediately, and drop
`RUN_SEED` back to `false` (or unset it) so later restarts never re-seed.

## Normal operation

```bash
docker compose -f docker-compose.yml up -d --build   # build + start (migrations run on app start)
docker compose -f docker-compose.yml logs -f app     # watch the app (migration output at startup)
docker compose -f docker-compose.yml ps              # health of db / app / sweeper
docker compose -f docker-compose.yml down            # stop (data persists in the epe_pgdata volume)
```

The app listens on `:3000`. Put a reverse proxy (Caddy/nginx) in front for TLS before exposing it
beyond the plant LAN. `SWEEP_INTERVAL` (seconds, default 3600) tunes the aging-sweep cadence.

## Backups

The append-only stock ledger is the system of record — back it up. Example nightly dump:

```bash
docker compose exec -T db pg_dump -U "$POSTGRES_USER" "$POSTGRES_DB" | gzip > epe-$(date +%F).sql.gz
```

## Not covered by this stack

- **TLS / reverse proxy** — add one in front of the app.
- **Real integrations** — e-invoice (GSP) and Tally sync ship with mock providers; wire the real
  adapters + credentials before those features do anything live.
