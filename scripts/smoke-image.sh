#!/usr/bin/env bash
#
# Prove the deployable image is safe before it goes anywhere.
#
# `npm test` cannot catch what this catches. Both serious bugs found on
# 30 Aug 2026 were invisible to the test suite and to a workstation build, and
# showed up only in a real image:
#
#   1. Next's file tracer copied the live database into the artifact.
#   2. Building without PROJECTLC_AUTH prerendered fourteen capability-gated
#      routes as an unrestricted viewer, so the container served /roster to
#      anonymous callers.
#
# Each assertion below is one of those, plus the fail-closed boot guard, the
# headers and the runtime user. Run it locally or in CI:
#
#   scripts/smoke-image.sh projectlc:test
#
set -uo pipefail

IMAGE="${1:-projectlc:test}"
NAME="lc-smoke-$$"
VOL="lc-smoke-vol-$$"
PORT="${SMOKE_PORT:-3990}"
FAILED=0

# Substring tests below use [[ == ]] rather than a pipe into `grep -q`: grep
# exiting early on a match closes the pipe and MSYS reports the SIGPIPE as
# "Aborted (core dumped)" on every check, which reads like a crash in CI logs.
shopt -s nocasematch

cleanup() {
  docker rm -f "$NAME" >/dev/null 2>&1 || true
  docker volume rm "$VOL" >/dev/null 2>&1 || true
}
trap cleanup EXIT

pass() { echo "  PASS  $1"; }
fail() { echo "  FAIL  $1"; FAILED=1; }

# Docker publishes the port before the app is listening, so an early request
# gets an empty reply rather than a refused connection — which --retry-connrefused
# does not retry. Poll until it actually answers.
wait_ready() {
  for _ in $(seq 1 60); do
    if curl -sf -o /dev/null --max-time 5 "http://localhost:$PORT/healthz"; then return 0; fi
    sleep 1
  done
  return 1
}

echo "smoke-testing $IMAGE"
echo

# --- 1. No database anywhere in the image ------------------------------------
# Asked of the image rather than the build directory: the question is what
# ships, not what the build left lying around locally.
DBS=$(docker run --rm --entrypoint sh "$IMAGE" -c 'find / -xdev \( -name "*.db" -o -name "*.db-wal" \) 2>/dev/null | head -5')
if [ -z "$DBS" ]; then
  pass "no database in the image"
else
  fail "database present in the image:"
  echo "$DBS" | sed 's/^/          /'
fi

# --- 2. Refuses to boot without enforcement ----------------------------------
# The guard must stop the server, not warn. If this ever serves a page, the
# deployment is one typo away from publishing the ledger.
# Mounted even though this container is expected to fail: the image declares
# VOLUME /data, so a run without -v leaves an *anonymous* volume behind every
# time. Seven of them accumulated before anyone noticed.
docker run -d --name "$NAME" -e PROJECTLC_AUTH= -v "$VOL:/data" -p "$PORT:3000" "$IMAGE" >/dev/null
sleep 5
CODE=$(curl -s -o /dev/null -w '%{http_code}' --max-time 8 "http://localhost:$PORT/" 2>/dev/null || echo "000")
if [ "$CODE" = "500" ] || [ "$CODE" = "000" ]; then
  pass "refuses to serve without PROJECTLC_AUTH=on (got $CODE)"
else
  fail "served HTTP $CODE with authorization disabled — the boot guard is not working"
fi
docker rm -f "$NAME" >/dev/null 2>&1 || true

# --- 3. Boots correctly when configured properly -----------------------------
docker run -d --name "$NAME" -e PROJECTLC_AUTH=on -e TZ=Europe/Oslo \
  -v "$VOL:/data" -p "$PORT:3000" "$IMAGE" >/dev/null

if wait_ready; then
  HEALTH=$(curl -s --max-time 10 "http://localhost:$PORT/healthz")
  if [ "$HEALTH" = '{"ok":true}' ]; then
    pass "/healthz reports ok"
  else
    fail "/healthz returned: $HEALTH"
  fi
else
  fail "container never became reachable"
  docker logs "$NAME" 2>&1 | tail -20 | sed 's/^/          /'
  echo
  echo "image smoke test FAILED"
  exit 1
fi

# --- 4. Gated routes leak nothing to an anonymous caller ---------------------
# A fresh volume holds the seed roster, so these strings are exactly what a
# prerendered /roster served last time. On a real deployment they'd be raiders.
# Fetched once rather than per needle, which raced the container.
ROSTER=$(curl -s --max-time 15 "http://localhost:$PORT/roster")
LEAKED=0
for needle in "Wishlist progress" "Items won" "Add character" "Remove demo data"; do
  if [[ "$ROSTER" == *"$needle"* ]]; then
    fail "anonymous /roster leaked: $needle"
    LEAKED=1
  fi
done
[ "$LEAKED" = "0" ] && pass "anonymous /roster leaks no roster content"

# --- 5. Redirects point at the caller's host, not the bind address -----------
# HOSTNAME=0.0.0.0 is required for the container to accept connections, and it
# used to leak into every redirect: sign-in finished on http://0.0.0.0:3000,
# which no browser can open. The flow works right up to the last hop, so only an
# end-to-end check catches it.
LOCATION=$(curl -s -i --max-time 10 "http://localhost:$PORT/api/auth/discord/callback?code=x&state=y" | grep -i '^location:' | tr -d '')
if [[ "$LOCATION" == *"0.0.0.0"* || "$LOCATION" == *"://"* ]]; then
  fail "redirect leaks the bind address or an absolute origin: $LOCATION"
else
  pass "redirects are relative (${LOCATION#*: })"
fi

# --- 6. Security headers are actually on the wire ----------------------------
HEADERS=$(curl -s -I --max-time 10 "http://localhost:$PORT/")
MISSING=0
for h in content-security-policy strict-transport-security x-content-type-options referrer-policy; do
  if [[ "$HEADERS" != *"$h:"* ]]; then
    fail "missing header: $h"
    MISSING=1
  fi
done
[ "$MISSING" = "0" ] && pass "security headers present"

# --- 7. Runs as a non-root user ----------------------------------------------
UID_IN=$(docker exec "$NAME" id -u 2>/dev/null || echo "?")
if [ "$UID_IN" != "0" ] && [ "$UID_IN" != "?" ]; then
  pass "runs as non-root (uid $UID_IN)"
else
  fail "running as uid $UID_IN"
fi

echo
if [ "$FAILED" = "0" ]; then
  echo "image smoke test PASSED"
else
  echo "image smoke test FAILED"
  exit 1
fi
