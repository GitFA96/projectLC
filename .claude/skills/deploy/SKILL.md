---
name: deploy
description: Deploy projectLC, or verify a deployment is safe. Use when building or shipping the container image, cutting a release, setting up a host, or checking a running deployment. Covers the checks that fail silently and the two bugs that only appear in a real image.
---

# Deploying projectLC

One guild, one process, one volume. The app is stateful three ways at once — a
SQLite file it writes, an in-process read model keyed to that file's
`data_version`, and Next's route cache invalidated in-process — so it runs as
**exactly one replica, always**. Two containers on one volume serve each other's
stale pages with nothing in any log to say so.

Full reasoning lives in `local/deployment-spec.md`. This is the procedure.

## Before anything: snapshot

Migrations are additive and applied automatically on first connection, and
**there is no down path**. Redeploying the previous image does not roll back —
the database has already moved on. So the snapshot *is* the rollback:

```bash
npm run backup          # PROJECTLC_DB, or data/projectlc.db
```

`VACUUM INTO` through a **read-only** handle, opened directly rather than
through `getDb()` — the app's opener runs the schema and the migrations on every
boot, so a backup taken the app's way would migrate the thing it is backing up.
The copy is then opened and read before any old one is pruned, and the run exits
1 if any of that fails.

Never a plain file copy: the most recent writes sit in the `-wal` and a copy
without it opens cleanly and is silently short.

`PROJECTLC_BACKUP_DIR` (default `backups/` beside the database) and
`PROJECTLC_BACKUP_KEEP` (default 14) are the two knobs. **A backup beside the
database survives a bad migration, not a lost disk** — the schedule that calls
this has to copy the directory off the host, and that half is still an operator
task, not a script.

## Build

```bash
npm run build          # never bare `next build`
```

`npm run build` is `next build` plus two guards, and skipping them is how both
of these shipped once:

- **`check-dynamic-routes.mjs`** — fails if any page is prerendered. A page
  rendered at build time had no request and no viewer, so its capability check
  never ran and it serves that HTML to everyone. This is not theoretical: a
  build without `PROJECTLC_AUTH` turned fourteen gated routes static and served
  the whole roster anonymously.
- **`prune-standalone.mjs`** — fails if a database survives into the artifact.
  Next's tracer follows `defaultDbPath()` to the real file and copies tens of MB
  of real characters, awards and raid nights into the directory you are about to
  push to a registry.

**Do not "fix" either by adding an exception.** They are the only thing standing
between a silent mistake and a published one.

## Verify the image, not the build

```bash
npm run image          # build, then smoke-test a live container
```

Six assertions, and every one of them exists because a unit test could not have
caught it: no database in the image, refuses to serve without
`PROJECTLC_AUTH=on`, `/healthz` ok, **no roster content in an anonymous
`/roster`**, security headers on the wire, non-root uid.

A workstation build is not the build that ships. `.env.local` sets
`PROJECTLC_AUTH`, which makes every route dynamic, which makes the build look
correct. A container build excludes `.env.local` — correctly — and that is when
the problem appears. Reproduce locally with `PROJECTLC_AUTH= npm run build`.

### Reclaiming space

Rebuilding to the same tag orphans the previous image, and BuildKit's cache
grows fast — 9.4 GB after one afternoon of iterating, against 471 MB of images.
The cache is almost always the thing filling the disk, not the images:

```bash
npm run image:clean    # dangling images + unused build cache
docker system df       # where the space actually went
```

The next build after a clean is slower, which is the whole trade.

## Configure the host

```bash
npm run doctor
```

Run it with the deployment's real environment. It fails on: Node below 22.13,
`PROJECTLC_AUTH` not `on` in production, `NODE_TLS_REJECT_UNAUTHORIZED` present,
`DATA_BACKEND=seed`, a relative or missing `PROJECTLC_DB`, and a Discord
redirect URI with the wrong path or scheme. It warns on `TZ` and on missing
Warcraft Logs credentials.

Two that catch people out:

- **`TZ`.** Timestamps render in process-local time while Warcraft Logs instants
  are UTC. On a UTC container a 19:30 CEST pull shows as 17:30 and reads as a
  parsing bug. Set the guild's own zone.
- **`DISCORD_REDIRECT_URI`.** Discord matches it exactly. A mismatch fails at
  Discord's consent screen with Discord's error, not yours. Register the
  production URL on the Discord application and set the identical string.

### Rate limiting belongs at the proxy

The app has none, deliberately: TLS terminates in front of it, so the only place
that sees a client IP is the reverse proxy, and a limiter inside a single Node
process would be counting the proxy.

Four routes are worth a limit, and only one of them is about brute force:

- **`/api/fight-graph`** is the one that costs money. It carries a `logs.view`
  check, so this is not an anonymous hole — but every call spends the
  deployment's shared Warcraft Logs quota, and a page left refreshing spends it
  in a loop. Limit this one even if you limit nothing else.
- **`/signin`, `/claim`, `/join`** are the credential paths. The claim code is
  too large to guess, so the case here is noise and log volume rather than a
  break-in.

A per-IP limit of a few requests a second, burst of a few dozen, is enough for a
guild of forty. In Caddy that is one `rate_limit` directive; in nginx, one
`limit_req_zone` plus a `limit_req` on those locations.

**Not a CSP nonce.** `script-src 'unsafe-inline'` is still there and is tracked
in `docs/backlog.md` with the condition that should trigger it — the two are
separate decisions and conflating them has stalled both before.

## First run

1. Start with `PROJECTLC_AUTH=on` from the beginning. An older draft of the
   runbook said to enable it after claiming or you would lock yourself out —
   **that is false.** `/claim` is `pageView("public")` and the claim code rides
   through sign-in in the OAuth state, so the callback mints the first account
   and claims the deployment in one pass with enforcement already on. Believing
   otherwise is what left a deployment wide open for the length of an install.
2. Set `PROJECTLC_CLAIM_CODE` at provision time. Otherwise the code is minted
   per boot and printed only to the console, and reading container logs is an
   awkward first step on several platforms. It stops meaning anything the moment
   the deployment is claimed.
3. Claim at `/claim`, then verify from a private window that a signed-out
   visitor gets no roster data.
4. Invite officers on `/roster/members`. There is no self-registration by
   design.

## Running it

```bash
docker run -d --name projectlc \
  -e PROJECTLC_AUTH=on -e TZ=Europe/Oslo \
  -e PROJECTLC_DB=/data/projectlc.db \
  -e DISCORD_CLIENT_ID=... -e DISCORD_CLIENT_SECRET=... \
  -e DISCORD_REDIRECT_URI=https://host/api/auth/discord/callback \
  -e WCL_CLIENT_ID=... -e WCL_CLIENT_SECRET=... \
  -v projectlc-data:/data -p 3000:3000 \
  projectlc:test
```

One replica. Never point it at the live database file — mount a copy if you are
testing, because migrations run on first connection and cannot be undone.

## After deploying

- `curl -sf https://host/healthz` returns `{"ok":true}`.
- A signed-out visitor gets no roster content.
- Restore the snapshot onto a scratch host at least once. An untested backup is
  a plan, not a backup — and "it verified" is not the same claim as "the app
  boots on it". Point `PROJECTLC_DB` at a copy of the backup and open a page.
