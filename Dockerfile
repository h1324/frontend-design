# EPE Foam ERP — production image for the on-premise plant machine (brief §4).
#
# Multi-stage: a builder compiles the Next.js app and generates the Prisma client, then a lean
# Debian runner carries the built app plus the Prisma CLI (needed to apply migrations on start).
# Debian — not Alpine — because the generated Prisma engines target debian-openssl-3.0.x (glibc).

# ---- builder ------------------------------------------------------------------------
FROM node:22-bookworm-slim AS builder
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1

# Install dependencies against the lockfile first, so this layer caches across source edits.
COPY package.json package-lock.json ./
RUN npm ci

# Build: generate the Prisma client, then compile the app. DATABASE_URL is not needed at build
# time (no DB calls during `next build`) — a placeholder keeps Prisma's env check happy.
COPY . .
ENV DATABASE_URL="postgresql://placeholder:placeholder@localhost:5432/placeholder"
RUN npx prisma generate && npm run build

# ---- runner -------------------------------------------------------------------------
FROM node:22-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000

# tini reaps zombies and forwards signals; curl backs the healthcheck and the aging-sweep timer.
RUN apt-get update \
    && apt-get install -y --no-install-recommends tini curl \
    && rm -rf /var/lib/apt/lists/*

# Carry the whole built app across (node_modules includes the Prisma CLI + engines for
# `migrate deploy`, and the source is present so `db:seed` can run as a one-off bootstrap).
COPY --from=builder /app ./
COPY docker/entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh \
    && useradd --create-home --uid 1001 epe \
    && chown -R epe:epe /app
USER epe

EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
    CMD curl -fsS http://localhost:3000/login || exit 1

# tini → entrypoint (applies migrations, optional seed) → the passed command (the server).
ENTRYPOINT ["/usr/bin/tini", "--", "/usr/local/bin/entrypoint.sh"]
CMD ["npm", "run", "start"]
