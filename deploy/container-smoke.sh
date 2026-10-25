#!/usr/bin/env bash
# OPT-IN, never in `make check` (job CE): build the API image (deploy/Dockerfile.api) and prove, on THIS machine and the AGENT stack only, what Cloud Run will rely on:
#   1 the image builds and is small          2 it runs as a numeric non-root user (10001)        3 outside development it REFUSES to start without its configuration
#   4 it starts, /health answers, /ready reaches the database, the docs and metrics pages are not served
#   5 a forged X-Forwarded-For does not change who the API thinks the caller is (uvicorn's proxy headers are off; the API reads the header itself, only as far as TRUSTED_PROXY_HOPS says)
#   6 SIGTERM stops it cleanly and quickly (Cloud Run waits 10 seconds)       7 the SAME image runs the scheduler worker (`python -m app.scheduler.worker --once`) and the worker's heartbeat reaches the database
# It uses port 8001 (the agents' API port) for a container named sme-ce-api-smoke and removes it. It never touches 3000, 8000, the owner's stack or any process but its own container.
# It reads no .env file and prints no key: the stack's public key is passed by NAME to docker (`-e NAME`), never on a command line. Needs Docker and `make agent-db-up`. Run: `make container-smoke`.
set -euo pipefail
cd "$(dirname "$0")/.."

export SME_STACK=agent
PORT="${API_PORT:-8001}"
NAME=sme-ce-api-smoke
IMAGE="${IMAGE:-sme-api:smoke}"
case "$PORT" in 3000 | 8000) echo "container-smoke: port $PORT is the owner's. Use 8001." >&2; exit 2 ;; esac
command -v docker >/dev/null || { echo "container-smoke: Docker is needed." >&2; exit 2; }
if lsof -iTCP:"$PORT" -sTCP:LISTEN -nP >/dev/null 2>&1; then echo "container-smoke: port $PORT is busy (not by this script). Stop what is using it, or set API_PORT=<another free port>." >&2; exit 2; fi

pass=0; failed=0
ok() { pass=$((pass + 1)); printf 'PASS  %s\n' "$1"; }
bad() { failed=$((failed + 1)); printf 'FAIL  %s\n' "$1"; }
# a check runs in a subshell, so an `exit` inside it ends only that check
check() { if ( eval "$2" ); then ok "$1"; else bad "$1"; fi; }
cleanup() { docker rm -f "$NAME" >/dev/null 2>&1 || true; }
trap cleanup EXIT
cleanup

echo "== build (needs the network for pip) =="
docker build -q -f deploy/Dockerfile.api -t "$IMAGE" . >/dev/null
size_mb=$(docker image inspect "$IMAGE" --format '{{.Size}}' | awk '{printf "%d", $1/1048576}')
echo "INFO  image $IMAGE is $size_mb MB to pull (as Docker reports its content size)"
check "the image is under 400 MB" "[ $size_mb -lt 400 ]"
check "it runs as the numeric user 10001, not root" "[ \"\$(docker run --rm --entrypoint id $IMAGE -u)\" = 10001 ]"
check "ffmpeg codes a spoken tone as OGG/Opus mono for WhatsApp voice notes (job DJ)" "docker run --rm --entrypoint python $IMAGE -m app.voice.convert | grep -q 'self-test ok: ogg/opus mono'"
check "no .env file or secret is inside the image" "! docker run --rm --entrypoint sh $IMAGE -c 'find / -xdev \\( -name .env -o -name \"*.pem\" -o -name \"*.key\" \\) -not -path \"*/site-packages/*\" -not -path \"/usr/*\" -not -path \"/etc/*\" -not -path \"/proc/*\" 2>/dev/null | grep -q .'"

echo "== outside development it refuses to start without its configuration =="
set +e
refusal=$(docker run --rm -e API_ENV=production "$IMAGE" 2>&1); code=$?
set -e
check "API_ENV=production with no settings exits non-zero (exit $code)" "[ $code -ne 0 ]"
check "and says which settings are missing" "printf '%s' \"\$refusal\" | grep -q 'SUPABASE_URL is required'"

echo "== start against the AGENT stack =="
# SUPABASE_URL and the public key of the agent stack, exported by name only (the helper prints nothing)
scripts/with-local-supabase-env.sh sh -c '
  docker run -d --name "'"$NAME"'" -p 127.0.0.1:'"$PORT"':8080 \
    -e API_ENV=development -e LOG_FORMAT=json -e RATE_LIMIT_ENABLED=true \
    -e "SUPABASE_URL=$(printf %s "$SUPABASE_URL" | sed "s#127.0.0.1#host.docker.internal#; s#localhost#host.docker.internal#")" \
    -e SUPABASE_PUBLISHABLE_KEY \
    "'"$IMAGE"'" >/dev/null'
for _ in $(seq 1 40); do curl -fsS "http://127.0.0.1:$PORT/health" >/dev/null 2>&1 && break; sleep 0.5; done
check "/health answers 200 with status ok" "curl -fsS http://127.0.0.1:$PORT/health | grep -q '\"status\":\"ok\"'"
check "/ready reaches the database through the stack's API (200)" "[ \"\$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:$PORT/ready)\" = 200 ]"
check "the Docker health check turns healthy" "for _ in \$(seq 1 40); do [ \"\$(docker inspect $NAME --format '{{.State.Health.Status}}')\" = healthy ] && exit 0; sleep 2; done; false"
check "an anonymous call is a 401 in the one error shape" "curl -s http://127.0.0.1:$PORT/v1/me | grep -q '\"request_id\"'"
# (/docs and /openapi.json are on in development by design; the hosted smoke checks that they are off there)
check "/metrics is not served (404) without METRICS_TOKEN" "[ \"\$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:$PORT/metrics)\" = 404 ]"
check "no server header names the software" "! curl -sI http://127.0.0.1:$PORT/health | grep -qi '^server:'"

echo "== a forged X-Forwarded-For does not change the caller =="
# (/v1/me, not /health: the container's own health check calls /health from inside and is a different caller)
curl -s -o /dev/null "http://127.0.0.1:$PORT/v1/me"
curl -s -o /dev/null -H 'X-Forwarded-For: 203.0.113.77' "http://127.0.0.1:$PORT/v1/me"
callers=$(docker logs "$NAME" 2>&1 | grep '"route": "/v1/me"\|"route":"/v1/me"' | sed -n 's/.*"caller": *"\([0-9a-f]*\)".*/\1/p' | sort -u | wc -l | tr -d ' ')
check "both requests were logged as the same caller (distinct callers: $callers)" "[ \"$callers\" = 1 ]"

echo "== SIGTERM =="
start=$(date +%s)
docker stop -t 10 "$NAME" >/dev/null
elapsed=$(( $(date +%s) - start ))
exit_code=$(docker inspect "$NAME" --format '{{.State.ExitCode}}')
check "it stopped in under 10 seconds (took ${elapsed}s)" "[ $elapsed -lt 10 ]"
check "and exited 0, not killed (exit $exit_code)" "[ \"$exit_code\" = 0 ]"
cleanup

echo "== the same image as the scheduler worker =="
set +e
no_config=$(docker run --rm "$IMAGE" python -m app.scheduler.worker --once 2>&1); wcode=$?
set -e
check "the worker with no account configured exits 2 and says so (exit $wcode)" "[ $wcode -eq 2 ] && printf '%s' \"\$no_config\" | grep -q 'SCHEDULER_EMAIL is required'"
# prepare the local scheduler account on the agent stack (the same step as `make dev-worker-local`), then run one tick INSIDE the container
(cd services/ai-api && scripts_dir=../../scripts && "$scripts_dir/with-local-supabase-env.sh" .venv/bin/python "$scripts_dir/dev_worker_local.py" --once >/dev/null 2>&1) || echo "INFO  (the native one-tick run that registers the local scheduler account returned non-zero; the container run below decides)"
sched_email=$(cd services/ai-api && .venv/bin/python -c "import sys; sys.path.insert(0, '../../scripts'); import dev_worker_local as d; print(d.SCHEDULER_EMAIL, end='')")
set +e
SCHEDULER_PASSWORD=$(cd services/ai-api && .venv/bin/python -c "import sys; sys.path.insert(0, '../../scripts'); import dev_worker_local as d; print(d.SCHEDULER_PASSWORD, end='')") \
  scripts/with-local-supabase-env.sh sh -c '
  docker run --rm -e API_ENV=development \
    -e "SUPABASE_URL=$(printf %s "$SUPABASE_URL" | sed "s#127.0.0.1#host.docker.internal#; s#localhost#host.docker.internal#")" \
    -e SUPABASE_PUBLISHABLE_KEY -e SCHEDULER_PASSWORD -e "SCHEDULER_EMAIL='"$sched_email"'" -e OUTBOX_ADAPTER=fake \
    "'"$IMAGE"'" python -m app.scheduler.worker --once' >/dev/null 2>&1
tick=$?
set -e
check "one tick in the container exits 0 (exit $tick)" "[ $tick -eq 0 ]"
beat=$(docker exec supabase_db_sme-ai-agent psql -U postgres -At -c "select (last_tick_at > now() - interval '2 minutes') from scheduler.heartbeat where id = 1" 2>/dev/null || true)
check "and its heartbeat reached the database" "[ \"$beat\" = t ]"

echo
echo "container-smoke: $pass passed, $failed failed"
[ "$failed" -eq 0 ]
