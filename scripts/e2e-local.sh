#!/usr/bin/env bash
# make e2e-local (job BE): the real-stack end-to-end run. It starts YOUR OWN API (port 8002) and web (port 3002) against the LOCAL Supabase stack (with Storage), drives the real web with a real browser through
# sign-up, sign-in with the authenticator, Today, the Outbox, Settings, Visits and the saree Catalogue (with a real photo upload), prints one PASS/FAIL line per step, stops what it started (by PID) and removes its
# throwaway workspace. Local only, invented data, nothing leaves this machine. Never uses ports 3000, 8000 or 8001 and never stops a process it did not start. Not part of `make check`, not in CI (it needs Docker,
# the local Supabase stack and a browser). See docs/runbooks/e2e-real-stack.md.
# E2E_SCRIPT=cl-signup.mjs runs the business-type sign-up flows instead (job CL, `make e2e-packs`); AUTH_GOOGLE_CLIENT_ID / AUTH_FACEBOOK_APP_ID in the environment reach the API (public ids only).
set -uo pipefail
cd "$(dirname "$0")/.."
ROOT="$(pwd)"
. scripts/stack.sh   # the AGENT stack unless SME_STACK=owner (docs/runbooks/two-local-stacks.md)
WEB_PORT="${E2E_WEB_PORT:-3002}"
API_PORT="${E2E_API_PORT:-8002}"
case "$WEB_PORT" in 3000) echo "e2e-local: port 3000 is the owner's demo; use another (default 3002)." >&2; exit 2 ;; esac
case "$API_PORT" in 8000|8001) echo "e2e-local: ports 8000 and 8001 belong to someone else; use another (default 8002)." >&2; exit 2 ;; esac
for port in "$WEB_PORT" "$API_PORT"; do
  if lsof -nP -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1; then echo "e2e-local: port $port is already in use (not by this run); stop whatever you started there, or set E2E_WEB_PORT / E2E_API_PORT." >&2; exit 2; fi
done
if ! scripts/sb status -o env >/dev/null 2>&1; then echo "e2e-local: the local Supabase stack ($SME_STACK) is not running. Run: make agent-db-up" >&2; exit 2; fi
if ! docker ps --format '{{.Names}}' | grep -q "^supabase_storage_$SME_PROJECT_ID\$"; then echo "e2e-local: Supabase Storage is not running in the $SME_STACK stack (the catalogue needs it). Run: make agent-db-down && make agent-db-up" >&2; exit 2; fi

LOGDIR="${E2E_LOGS:-$(mktemp -d "${TMPDIR:-/tmp}/e2e-local.XXXXXX")}"
mkdir -p "$LOGDIR"
API_PID=""; WEB_PID=""
stop_mine() {
  # only the processes this script started, by PID, and their own children
  for pid in "$WEB_PID" "$API_PID"; do
    [ -n "$pid" ] || continue
    for child in $(pgrep -P "$pid" 2>/dev/null); do kill "$child" 2>/dev/null || true; done
    kill "$pid" 2>/dev/null || true
  done
}
cleanup() {
  stop_mine
  if [ "${E2E_KEEP:-0}" != "1" ]; then (cd "$ROOT/e2e" && node cleanup-be.mjs) || echo "e2e-local: the clean-up did not finish; run: node e2e/cleanup-be.mjs" >&2; fi
}
trap cleanup EXIT INT TERM

echo "e2e-local: starting the API on :$API_PORT and the web on :$WEB_PORT (logs in $LOGDIR)"
# PLACES_PROVIDER=fake: the API's own fixture map search (job CC: the Find retailers screen); WHATSAPP_ACCESS_TOKEN: a synthetic local-only value so the Connect WhatsApp screen can reach "connected" (the outbox adapter stays the fake; nothing is sent to Meta)
# VOICE_*_PROVIDER=fake: the API's own FAKE speech adapters (development only, no key, no cost, nothing leaves this machine): the recording is "heard" as a fixed sentence and the spoken answer is a short tone
( cd services/ai-api && AGENTS_ENABLED=true VOICE_STT_PROVIDER=fake VOICE_TTS_PROVIDER=fake PLACES_PROVIDER=fake WHATSAPP_ACCESS_TOKEN=local-fake-whatsapp-token exec ../../scripts/with-local-demo-env.sh .venv/bin/uvicorn app.main:app --port "$API_PORT" ) >"$LOGDIR/api.log" 2>&1 &
API_PID=$!
( cd apps/web && SIGNUP_MAX_PER_HOUR="${E2E_SIGNUP_MAX_PER_HOUR:-200}" LOCAL_DEMO_API_URL="http://localhost:$API_PORT" exec ../../scripts/with-local-demo-env.sh node node_modules/next/dist/bin/next dev -p "$WEB_PORT" ) >"$LOGDIR/web.log" 2>&1 &
WEB_PID=$!

wait_for() { # url, name
  for _ in $(seq 1 90); do
    if curl -fs -o /dev/null "$1"; then return 0; fi
    kill -0 "$API_PID" 2>/dev/null || { echo "e2e-local: the API stopped (see $LOGDIR/api.log)" >&2; return 1; }
    sleep 1
  done
  echo "e2e-local: $2 did not come up in 90 s (see $LOGDIR)" >&2; return 1
}
wait_for "http://localhost:$API_PORT/health" "the API" || exit 1
wait_for "http://localhost:$WEB_PORT/login" "the web" || exit 1

cd e2e
[ -d node_modules ] || npm ci
export E2E_WEB_URL="http://localhost:$WEB_PORT" E2E_API_URL="http://localhost:$API_PORT"
node "${E2E_SCRIPT:-be-stack.mjs}"
status=$?
echo "e2e-local: exit $status (screenshots: ${E2E_SHOTS:-e2e/shots-be})"
exit $status
