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
#   ./deploy/cloudrun.sh secrets [--execute]    # create the two secrets in Secret Manager (job BG): the suppression key is GENERATED here and never shown; the scheduler password is typed HIDDEN
#   ./deploy/cloudrun.sh worker [--execute]     # the scheduler worker as a Cloud Run JOB run every few minutes by Cloud Scheduler (job BG): no always-on cost (SCHEDULER_EMAIL, SCHEDULER_SA, WORKER_EVERY_MINUTES)
#
# Order for a first deploy: secrets, api, read its URL, then web with API_URL set to it, then set WEB_ORIGIN on the API (redeploy it), run
# `make hosted-smoke` and scripts/verify_hosted.py, and last the worker. The full walk-through, with the accounts only the owner can create: docs/runbooks/hosting-owner-runbook.md
# (the rehearsal with synthetic data: docs/runbooks/hosting-rehearsal-owner.md; every variable and secret: docs/runbooks/hosting-env-and-secrets.md).
#
# Optional: WEB_RUN_SA=<service account the WEB runs as; it needs no role at all: the web holds no secret>   (RUN_SA is the API's and the worker's)
# Optional (worker, job DY): WORKER_OUTBOX_ADAPTER=whatsapp makes the worker send through Meta's Cloud API (default fake); it then needs WHATSAPP_ACCESS_TOKEN in WORKER_EXTRA_SECRETS and WHATSAPP_ALLOWED_RECIPIENTS in WORKER_EXTRA_ENV (docs/runbooks/whatsapp-staging.md)
# Optional (worker, job DJ): WORKER_EXTRA_ENV="A=b" and WORKER_EXTRA_SECRETS="SARVAM_API_KEY=sme-sarvam-api-key:latest" (the voice-note speech key; docs/runbooks/voice-notes-real.md)
# Optional (api): EXTRA_ENV="A=b,C=d" more PLAIN settings (no secret, no comma inside a value)   EXTRA_SECRETS="NAME=secret:latest,..." secrets from Secret Manager   MIN_INSTANCES=0 with CPU_ALWAYS=true
# Optional: BUILD_SA=<service account the Cloud Build runs as>   BUILD=docker (build on this machine instead of Cloud Build)
# Optional, all public values:  RUN_SA=<service account e-mail the service runs as; give it ONLY roles/secretmanager.secretAccessor>   TRUSTED_PROXY_HOPS=1 (how many proxies write X-Forwarded-For; 1 = Cloud Run itself)
#                               WORKER_EVERY_MINUTES=5 (1 to 59; it is the schedule AND the worker's own interval, which the status card judges "running" by)
set -euo pipefail

what="${1:-}"; shift || true
execute=false
for arg in "$@"; do [ "$arg" = "--execute" ] && execute=true; done
case "$what" in api | web | secrets | worker) ;; *) echo "usage: $0 api|web|secrets|worker [--execute]" >&2; exit 2 ;; esac

: "${PROJECT_ID:?set PROJECT_ID}"
SECRET_SUPPRESSION="${SECRET_SUPPRESSION:-sme-suppression-hmac-key}"
SECRET_SCHEDULER="${SECRET_SCHEDULER:-sme-scheduler-password}"
if [ "$what" != "secrets" ]; then
  : "${SUPABASE_URL:?set SUPABASE_URL}" "${WEB_ORIGIN:?set WEB_ORIGIN}"
  PUBLIC_KEY="${SUPABASE_PUBLISHABLE_KEY:-${SUPABASE_ANON_KEY:-}}"
  [ -n "$PUBLIC_KEY" ] || { echo "set SUPABASE_PUBLISHABLE_KEY (public; the legacy SUPABASE_ANON_KEY is also accepted)" >&2; exit 2; }
  case "$SUPABASE_URL$WEB_ORIGIN" in *http://*) echo "refusing a non-https URL" >&2; exit 2;; esac
fi
REGION="${REGION:-asia-south1}"
REPO="${REPO:-sme}"
TAG="${TAG:-$(git rev-parse --short HEAD)}"
registry="$REGION-docker.pkg.dev/$PROJECT_ID/$REPO"

run() { printf '+'; printf ' %q' "$@"; printf '\n'; if $execute; then "$@"; fi; }

# Images are built REMOTELY by Cloud Build (job DC: not on a small laptop). BUILD_SA (optional) is the service account the build runs as (needs: read the _cloudbuild source bucket, write the Artifact Registry repository, write logs).
# BUILD=docker builds on THIS machine instead (the old way; needs Docker running and `gcloud auth configure-docker $REGION-docker.pkg.dev`).
build_api() {
  if [ "${BUILD:-cloudbuild}" = "docker" ]; then
    run docker build --platform linux/amd64 -f deploy/Dockerfile.api -t "$1" .
    run docker push "$1"
  else
    run gcloud builds submit --project "$PROJECT_ID" --region "$REGION" ${BUILD_SA:+--service-account "projects/$PROJECT_ID/serviceAccounts/$BUILD_SA"} --suppress-logs \
      --config deploy/cloudbuild-api.yaml --substitutions "_IMAGE=$1" .
  fi
}
# The scheduler worker's image (job DJ): the same code as the API plus ffmpeg, a target of the same Dockerfile.
build_worker() {
  if [ "${BUILD:-cloudbuild}" = "docker" ]; then
    run docker build --platform linux/amd64 -f deploy/Dockerfile.api --target worker -t "$1" .
    run docker push "$1"
  else
    run gcloud builds submit --project "$PROJECT_ID" --region "$REGION" ${BUILD_SA:+--service-account "projects/$PROJECT_ID/serviceAccounts/$BUILD_SA"} --suppress-logs \
      --config deploy/cloudbuild-api.yaml --substitutions "_IMAGE=$1,_TARGET=worker" .
  fi
}
build_web() {
  if [ "${BUILD:-cloudbuild}" = "docker" ]; then
    run docker build --platform linux/amd64 -f deploy/Dockerfile.web -t "$1" \
      --build-arg "NEXT_PUBLIC_API_BASE_URL=$API_URL" --build-arg "NEXT_PUBLIC_SUPABASE_URL=$SUPABASE_URL" \
      --build-arg "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=$PUBLIC_KEY" --build-arg "NEXT_PUBLIC_SITE_URL=$WEB_ORIGIN" --build-arg "NEXT_PUBLIC_SITE_LIVE=${SITE_LIVE:-0}" --build-arg "NEXT_PUBLIC_SIGNUP_OPEN=${SIGNUP_OPEN:-0}" .
    run docker push "$1"
  else
    run gcloud builds submit --project "$PROJECT_ID" --region "$REGION" ${BUILD_SA:+--service-account "projects/$PROJECT_ID/serviceAccounts/$BUILD_SA"} --suppress-logs \
      --config deploy/cloudbuild-web.yaml --substitutions "_IMAGE=$1,_API_URL=$API_URL,_SUPABASE_URL=$SUPABASE_URL,_PUBLISHABLE_KEY=$PUBLIC_KEY,_SITE_URL=$WEB_ORIGIN,_SIGNUP_OPEN=${SIGNUP_OPEN:-0}" .
  fi
}

cd "$(dirname "$0")/.."

# The settings the API and the worker share (all public values; the secrets come from Secret Manager below)
common_env() {
  printf 'API_ENV=production,LOG_FORMAT=json,SUPABASE_URL=%s,SUPABASE_PUBLISHABLE_KEY=%s,SUPABASE_JWT_ISSUER=%s/auth/v1,SUPABASE_JWT_AUDIENCE=authenticated,SUPABASE_JWKS_URL=%s/auth/v1/.well-known/jwks.json,SUPABASE_JWT_ALGORITHMS=ES256' \
    "$SUPABASE_URL" "$PUBLIC_KEY" "$SUPABASE_URL" "$SUPABASE_URL"
  # job DQ (DPDP): the privacy and hello inboxes the API shows in the notice and the worker e-mails (set by deploy/staging.sh from MAIL_DOMAIN; empty = not set)
  printf '%s' "${PRIVACY_EMAIL:+,PRIVACY_EMAIL=$PRIVACY_EMAIL}${HELLO_EMAIL:+,HELLO_EMAIL=$HELLO_EMAIL}"
}

if [ "$what" = "secrets" ]; then
  # Secret Manager holds the two server-side secrets (the first 6 secret versions are free; check the pricing page). Neither value is ever printed, put on a command line, or written to a file:
  # the suppression key is generated here and piped into gcloud; the scheduler password is typed hidden and piped the same way. An existing secret gets a new VERSION (the old one stays until you destroy it).
  run gcloud services enable secretmanager.googleapis.com --project "$PROJECT_ID"
  for name in "$SECRET_SUPPRESSION" "$SECRET_SCHEDULER"; do
    printf '+ gcloud secrets create %s --project %s --replication-policy=automatic --data-file=-   (value on stdin; if it exists: gcloud secrets versions add %s --data-file=-)\n' "$name" "$PROJECT_ID" "$name"
  done
  if $execute; then
    gen() { python3 -c 'import secrets; print(secrets.token_hex(32), end="")'; }
    put() { # name, value-producing command
      if gcloud secrets describe "$1" --project "$PROJECT_ID" >/dev/null 2>&1; then
        "${@:2}" | gcloud secrets versions add "$1" --project "$PROJECT_ID" --data-file=-
      else
        "${@:2}" | gcloud secrets create "$1" --project "$PROJECT_ID" --replication-policy=automatic --data-file=-
      fi
    }
    put "$SECRET_SUPPRESSION" gen
    read -rsp "Scheduler account password (the one you registered for the scheduler; typed hidden): " sched_pw; echo
    [ -n "$sched_pw" ] || { echo "empty password: nothing stored for the scheduler" >&2; exit 2; }
    put "$SECRET_SCHEDULER" printf '%s' "$sched_pw"
    unset sched_pw
    echo "Stored. Let the Cloud Run service account read them: gcloud secrets add-iam-policy-binding <name> --member serviceAccount:<its email> --role roles/secretmanager.secretAccessor"
  fi
  $execute || echo "(dry run: nothing was run. Add --execute to run the commands above.)"
  exit 0
fi

if [ "$what" = "worker" ]; then
  # The scheduler worker (ADR 0068) is one tick every interval. As a Cloud Run JOB started by Cloud Scheduler it costs nothing while it waits (no always-on instance): each run signs in,
  # runs one tick (`--once`) and exits. Two ticks at once are safe (the database hands each message to exactly one). It acts only while the global outbox switch AND the business's automatic sending are on.
  : "${SCHEDULER_EMAIL:?set SCHEDULER_EMAIL (the registered scheduler account; its password is the secret $SECRET_SCHEDULER)}"
  : "${SCHEDULER_SA:?set SCHEDULER_SA (the service account Cloud Scheduler uses to start the job, an email)}"
  # The schedule and the worker's interval are ONE setting: the status card says the worker is running when its last tick is less than three intervals old, and a job started every 5 minutes that believed
  # the default interval (60 s) would look stopped four minutes out of five.
  EVERY="${WORKER_EVERY_MINUTES:-5}"
  case "$EVERY" in '' | *[!0-9]*) echo "WORKER_EVERY_MINUTES must be a whole number from 1 to 59" >&2; exit 2 ;; esac
  { [ "$EVERY" -ge 1 ] && [ "$EVERY" -le 59 ]; } || { echo "WORKER_EVERY_MINUTES must be from 1 to 59" >&2; exit 2; }
  SCHEDULE="*/$EVERY * * * *"
  INTERVAL=$((EVERY * 60))
  image="$registry/worker:$TAG"   # its own image since job DJ (ffmpeg); the API's stays small
  build_worker "$image"
  run gcloud run jobs deploy sme-worker --project "$PROJECT_ID" --region "$REGION" --image "$image" \
    --command python --args=-m,app.scheduler.worker,--once --cpu 1 --memory 512Mi --max-retries 0 --task-timeout 120s \
    ${RUN_SA:+--service-account "$RUN_SA"} \
    --set-env-vars "$(common_env),OUTBOX_ADAPTER=${WORKER_OUTBOX_ADAPTER:-fake},SCHEDULER_EMAIL=$SCHEDULER_EMAIL,SCHEDULER_INTERVAL_SECONDS=$INTERVAL${WORKER_EXTRA_ENV:+,$WORKER_EXTRA_ENV}" \
    --set-secrets "SCHEDULER_PASSWORD=$SECRET_SCHEDULER:latest,SUPPRESSION_HMAC_KEY=$SECRET_SUPPRESSION:latest${WORKER_EXTRA_SECRETS:+,$WORKER_EXTRA_SECRETS}"
  # create the schedule, or update it when it exists (a redeploy must not fail on it)
  verb=create
  if $execute && gcloud scheduler jobs describe sme-worker-tick --project "$PROJECT_ID" --location "$REGION" >/dev/null 2>&1; then verb=update; fi
  run gcloud scheduler jobs "$verb" http sme-worker-tick --project "$PROJECT_ID" --location "$REGION" --schedule "$SCHEDULE" --time-zone "Asia/Kolkata" \
    --uri "https://run.googleapis.com/v2/projects/$PROJECT_ID/locations/$REGION/jobs/sme-worker:run" --http-method POST \
    --oauth-service-account-email "$SCHEDULER_SA"
  $execute || echo "(dry run: nothing was run. Add --execute to run the commands above. If the schedule job exists already, use: gcloud scheduler jobs update http ...)"
  exit 0
fi

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
  # MIN_INSTANCES (optional): with CPU_ALWAYS=true the default is one warm instance (about $44 a month, ADR 0072). MIN_INSTANCES=0 keeps CPU allocated while an instance is alive but lets it scale to zero when idle:
  # no fixed cost, billed only for the time an instance is up (job DC staging).
  if [ "$CPU_ALWAYS" = "true" ]; then cpu_flags=(--no-cpu-throttling --min-instances "${MIN_INSTANCES:-1}"); else cpu_flags=(--cpu-throttling --min-instances 0); fi
  build_api "$image"
  # --execution-environment gen2 (job DE): measured on staging, 3 new instances each: the Python app is ready 6.1 to 6.2 s after the instance starts on gen2, 6.5 to 8.3 s on gen1 (hundreds of small files are read at start). The web showed no difference.
  # The startup probe asks every 2 seconds, 1 s to answer (job DE: it used to ask every 5 s, so a ready server could wait up to 5 s to be told so; Cloud Run needs the timeout under the period; still 60 s in all before the start is called failed). Two instances at most (--max-instances 2) so a loop cannot run the bill up. The startup probe asks /health (no dependency is touched) until the process answers. API_CORS_ORIGINS is exactly the web's
  # address: the browser never calls the API (the web server does, with the person's token), so this is a fence, not a need. TRUSTED_PROXY_HOPS is what lets the rate limits tell callers apart behind Cloud Run.
  run gcloud run deploy sme-api --project "$PROJECT_ID" --region "$REGION" --image "$image" \
    "${cpu_flags[@]}" --execution-environment gen2 --cpu 1 --memory 512Mi --max-instances 2 --concurrency 40 --timeout 300 --port 8080 \
    --startup-probe=httpGet.path=/health,httpGet.port=8080,timeoutSeconds=1,periodSeconds=2,failureThreshold=30 \
    --allow-unauthenticated ${RUN_SA:+--service-account "$RUN_SA"} \
    --set-env-vars "$(common_env),API_CORS_ORIGINS=$WEB_ORIGIN,AGENTS_ENABLED=$AGENTS,TRUSTED_PROXY_HOPS=${TRUSTED_PROXY_HOPS:-1}${EXTRA_ENV:+,$EXTRA_ENV}${EXTRA_ENV_2:+,$EXTRA_ENV_2}" \
    --set-secrets "SUPPRESSION_HMAC_KEY=$SECRET_SUPPRESSION:latest${EXTRA_SECRETS:+,$EXTRA_SECRETS}"
else
  : "${API_URL:?set API_URL (the API service URL, https)}"
  case "$API_URL" in https://*) ;; *) echo "API_URL must be https" >&2; exit 2;; esac
  image="$registry/web:$TAG"
  build_web "$image"
  run gcloud run deploy sme-web --project "$PROJECT_ID" --region "$REGION" --image "$image" \
    --cpu 1 --memory 512Mi --min-instances 0 --max-instances 3 --concurrency 40 --timeout 300 --port 8080 \
    --startup-probe=httpGet.path=/login,httpGet.port=8080,timeoutSeconds=1,periodSeconds=2,failureThreshold=30 \
    --allow-unauthenticated ${WEB_RUN_SA:+--service-account "$WEB_RUN_SA"}
fi
$execute || echo "(dry run: nothing was run. Add --execute to run the commands above.)"
