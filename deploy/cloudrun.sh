#!/usr/bin/env bash
# Manual deploy to Google Cloud Run, region asia-south1 (Mumbai) (T006b M2, ADR 0015, docs/runbooks/hosting-deploy.md).
#
# DRY RUN BY DEFAULT: it prints every command and runs none. Add --execute to run them. It never reads a .env file; it takes everything
# from the environment you set for this run. It holds no secret: the only values involved are public (the Supabase URL and publishable key, the
# origins). The API needs NO server secret (it acts with each user's own JWT).
#
#   PROJECT_ID=...  SUPABASE_URL=https://<ref>.supabase.co  SUPABASE_PUBLISHABLE_KEY=<public publishable key> \   # the legacy SUPABASE_ANON_KEY is still accepted
#   API_URL=https://<api service url>  WEB_ORIGIN=https://<web service url or your domain> \
#   ./deploy/cloudrun.sh api   [--execute]      # build, push, deploy the API  (request-based CPU; CPU_ALWAYS=true for agents)
#   ./deploy/cloudrun.sh web   [--execute]      # build, push, deploy the web  (request-based CPU, scales to zero)
#
# Order for a first deploy: api, read its URL, then web with API_URL set to it, then set WEB_ORIGIN on the API (redeploy it) and run
# scripts/verify_hosted.py.
set -euo pipefail

what="${1:-}"; shift || true
execute=false
for arg in "$@"; do [ "$arg" = "--execute" ] && execute=true; done
[ "$what" = "api" ] || [ "$what" = "web" ] || { echo "usage: $0 api|web [--execute]" >&2; exit 2; }

: "${PROJECT_ID:?set PROJECT_ID}" "${SUPABASE_URL:?set SUPABASE_URL}" "${WEB_ORIGIN:?set WEB_ORIGIN}"
PUBLIC_KEY="${SUPABASE_PUBLISHABLE_KEY:-${SUPABASE_ANON_KEY:-}}"
[ -n "$PUBLIC_KEY" ] || { echo "set SUPABASE_PUBLISHABLE_KEY (public; the legacy SUPABASE_ANON_KEY is also accepted)" >&2; exit 2; }
case "$SUPABASE_URL$WEB_ORIGIN" in *http://*) echo "refusing a non-https URL" >&2; exit 2;; esac
REGION="${REGION:-asia-south1}"
REPO="${REPO:-sme}"
TAG="${TAG:-$(git rev-parse --short HEAD)}"
registry="$REGION-docker.pkg.dev/$PROJECT_ID/$REPO"

run() { printf '+ %s\n' "$*"; if $execute; then "$@"; fi; }

cd "$(dirname "$0")/.."

if [ "$what" = "api" ]; then
  image="$registry/api:$TAG"
  # CPU. Agent runs execute in worker threads INSIDE the process: with request-based billing Cloud Run throttles the CPU between requests
  # and a run would stall. So agents need CPU_ALWAYS=true (instance-based billing, one warm instance, about $54 a month in Mumbai).
  # The first pilot has agents OFF (labelling and erasure are request/response work): the default is request-based, scales to zero,
  # about $0-2 a month. Turning agents on without CPU_ALWAYS is refused here.
  AGENTS="${AGENTS_ENABLED:-false}"
  CPU_ALWAYS="${CPU_ALWAYS:-false}"
  if [ "$AGENTS" = "true" ] && [ "$CPU_ALWAYS" != "true" ]; then
    echo "AGENTS_ENABLED=true needs CPU_ALWAYS=true (agent threads stall on throttled CPU). See ADR 0015." >&2; exit 2
  fi
  if [ "$CPU_ALWAYS" = "true" ]; then cpu_flags=(--no-cpu-throttling --min-instances 1); else cpu_flags=(--cpu-throttling --min-instances 0); fi
  run docker build --platform linux/amd64 -f deploy/Dockerfile.api -t "$image" .
  run docker push "$image"
  # Two instances at most (--max-instances 2) so a loop cannot run the bill up.
  run gcloud run deploy sme-api --project "$PROJECT_ID" --region "$REGION" --image "$image" \
    "${cpu_flags[@]}" --cpu 1 --memory 512Mi --max-instances 2 --concurrency 40 --timeout 300 --port 8080 \
    --allow-unauthenticated \
    --set-env-vars "API_ENV=production,API_CORS_ORIGINS=$WEB_ORIGIN,SUPABASE_URL=$SUPABASE_URL,SUPABASE_PUBLISHABLE_KEY=$PUBLIC_KEY,SUPABASE_JWT_ISSUER=$SUPABASE_URL/auth/v1,SUPABASE_JWT_AUDIENCE=authenticated,SUPABASE_JWKS_URL=$SUPABASE_URL/auth/v1/.well-known/jwks.json,SUPABASE_JWT_ALGORITHMS=ES256,AGENTS_ENABLED=$AGENTS"
else
  : "${API_URL:?set API_URL (the API service URL, https)}"
  case "$API_URL" in https://*) ;; *) echo "API_URL must be https" >&2; exit 2;; esac
  image="$registry/web:$TAG"
  run docker build --platform linux/amd64 -f deploy/Dockerfile.web -t "$image" \
    --build-arg "NEXT_PUBLIC_API_BASE_URL=$API_URL" --build-arg "NEXT_PUBLIC_SUPABASE_URL=$SUPABASE_URL" \
    --build-arg "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=$PUBLIC_KEY" .
  run docker push "$image"
  run gcloud run deploy sme-web --project "$PROJECT_ID" --region "$REGION" --image "$image" \
    --cpu 1 --memory 512Mi --min-instances 0 --max-instances 3 --concurrency 40 --timeout 60 --port 8080 --allow-unauthenticated
fi
$execute || echo "(dry run: nothing was run. Add --execute to run the commands above.)"
