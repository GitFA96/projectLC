# syntax=docker/dockerfile:1

# projectLC — one process, one volume, one guild.
#
# The app is stateful in three ways at once (a SQLite file it writes, an
# in-process read model keyed to that file's data_version, and Next's route
# cache invalidated in-process), so this image is meant to run as **exactly one
# replica**. Two containers against one volume will serve each other's stale
# pages with nothing in any log to say so.

# **On pinning the base image.** `node:24-alpine` floats patch and minor
# releases, so a rebuild picks up base-image security fixes without anybody
# remembering to. The stricter practice is to pin a digest for reproducibility —
# but a digest freezes you on today's CVEs until something bumps it, and
# pinned-and-unwatched is the worst of the three options.
#
# `.github/dependabot.yml` now watches this file weekly, so pinning a digest has
# become a reasonable choice rather than a trap. Left floating for now because
# patch and minor security fixes then arrive without a PR at all; switch to a
# digest if you would rather review every base-image change than receive them.

# ---- deps -------------------------------------------------------------------
FROM node:24-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
# Nothing here compiles: SQLite comes from node:sqlite, built into Node, so no
# build toolchain is needed and the image stays portable across architectures.
#
# The cache mount survives between builds without landing in a layer, so an
# unchanged lockfile costs no network. It needs the `# syntax` line at the top
# of this file — remove that and this silently becomes an ordinary RUN.
RUN --mount=type=cache,target=/root/.npm npm ci

# ---- build ------------------------------------------------------------------
FROM node:24-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# `npm run build` is `next build` **plus** scripts/prune-standalone.mjs, which
# removes the traced copy of data/ and fails the build if any database survives
# into the artifact. Do not replace this with a bare `next build`.
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

# ---- runtime ----------------------------------------------------------------
FROM node:24-alpine AS runner
WORKDIR /app

# Standard OCI metadata. Worth having before the image is ever pushed anywhere:
# registries and scanners read these, and adding them later means retagging.
LABEL org.opencontainers.image.title="projectLC"       org.opencontainers.image.description="Loot council tracker for WoW: The Burning Crusade"       org.opencontainers.image.source="https://github.com/GitFA96/projectLC"       org.opencontainers.image.licenses="Apache-2.0"

ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0 \
    PROJECTLC_DB=/data/projectlc.db

# Sixteen server-rendered files format timestamps in *process-local* time while
# Warcraft Logs instants are stored as UTC, so a raid night renders hours out on
# a UTC container. Override this with the guild's own zone at run time.
ENV TZ=UTC

# The `node` user (uid 1000) ships with the image; the volume has to belong to
# it or the first write fails with EACCES rather than anything readable.
RUN mkdir -p /data && chown -R node:node /data

COPY --from=builder --chown=node:node /app/.next/standalone ./
# Standalone deliberately omits these two. `public/` does not exist in this
# project today; if one is ever added, it has to be copied here as well or every
# asset 404s while the pages themselves render perfectly.
COPY --from=builder --chown=node:node /app/.next/static ./.next/static

USER node
EXPOSE 3000
VOLUME ["/data"]

# /healthz is public by design and reads the database, so it proves more than
# "Node is running". Alpine has no curl; Node 24 has a global fetch.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server.js"]
