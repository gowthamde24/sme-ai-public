#!/usr/bin/env bash
# The PRODUCTION stack on Google Cloud Run (asia-south1) + the production Supabase project (Mumbai). Written 11 Nov 2026 (owner: production by 30 Nov, plan docs/runbooks/production-bringup.md).
# NOTHING IS RUN BY DEFAULT: every deploy is a DRY RUN that prints the commands. To act: --execute AND PROD_CONFIRM=<the short commit id printed by `preflight`> AND a clean checkout of main that equals origin/main.
# It is a separate script from deploy/staging.sh on purpose: the two can never touch each other's project (both ids are checked against each other here), and production carries none of staging's test fences.
#
#   deploy/production.sh preflight                       the checks only (read-only): ids, secrets that must exist, git state; prints the commit id to confirm
#   deploy/production.sh status                          services, jobs, schedules, live revisions
#   deploy/production.sh deploy [api|web|worker|all] [--execute]
#   deploy/production.sh rollback <sme-api|sme-web> [REVISION] [--execute]   100 % of traffic to REVISION (default: the one before the live one)
#   deploy/production.sh latest <sme-api|sme-web> [--execute]                undo a rollback
#
# Public values come from deploy/.env.production (see deploy/production.env.example). No secret is read, printed or stored here: every server-side secret is a Secret Manager reference
# created by the owner with a hidden prompt (`deploy/cloudrun.sh secrets`, or `gcloud secrets create ... --data-file=-` on stdin).
set -euo pipefail
cd "$(dirname "$0")/.."

STAGING_PROJECT_ID="project-2757c07e-37d2-4167-88f"; STAGING_SUPABASE_REF="uiallwgywitryxatcqxf"
ENV_FILE="${PROD_ENV_FILE:-deploy/.env.production}"
[ -f "$ENV_FILE" ] || { echo "missing $ENV_FILE: copy deploy/production.env.example to it and fill in the public ids (docs/runbooks/production-bringup.md, step 1)" >&2; exit 2; }
set -a; . "$ENV_FILE"; set +a
for v in PROD_PROJECT_ID PROD_PROJECT_NUMBER PROD_SUPABASE_REF PROD_WEB_ORIGIN PROD_MAIL_DOMAIN; do
  [ -n "${!v:-}" ] || { echo "$v is empty in $ENV_FILE" >&2; exit 2; }
done
[ "$PROD_PROJECT_ID" != "$STAGING_PROJECT_ID" ] || { echo "REFUSED: PROD_PROJECT_ID is the STAGING project" >&2; exit 2; }
[ "$PROD_SUPABASE_REF" != "$STAGING_SUPABASE_REF" ] || { echo "REFUSED: PROD_SUPABASE_REF is the STAGING database" >&2; exit 2; }
case "$PROD_WEB_ORIGIN" in https://*) ;; *) echo "PROD_WEB_ORIGIN must be https" >&2; exit 2 ;; esac
case "$PROD_WEB_ORIGIN" in *staging*) echo "REFUSED: PROD_WEB_ORIGIN names staging" >&2; exit 2 ;; esac
PROJECT_ID="$PROD_PROJECT_ID"; PROJECT_NUMBER="$PROD_PROJECT_NUMBER"; REGION="asia-south1"; export PROJECT_ID REGION

cmd="${1:-}"; shift || true
execute=""; what="all"; args=()
for arg in "$@"; do case "$arg" in --execute) execute="--execute" ;; api | web | worker | all) what="$arg" ;; *) args+=("$arg") ;; esac; done

# the secrets production needs (names only). REQUIRED ones must exist before any --execute; OPTIONAL ones are mounted only when present.
REQUIRED_SECRETS=(sme-suppression-hmac-key sme-scheduler-password sme-resend-api-key sme-anthropic-api-key sme-sarvam-api-key sme-cartesia-api-key sme-plivo-auth-id sme-plivo-auth-token sme-exotel-stream-secret)

short="$(git rev-parse --short HEAD)"
git_ok() {
  [ -z "$(git status --porcelain)" ] || { echo "REFUSED: the working tree is not clean" >&2; return 1; }
  [ "$(git rev-parse --abbrev-ref HEAD)" = "main" ] || { echo "REFUSED: not on main" >&2; return 1; }
  git fetch -q origin main
  [ "$(git rev-parse HEAD)" = "$(git rev-parse origin/main)" ] || { echo "REFUSED: HEAD is not origin/main" >&2; return 1; }
}
missing_secrets() {
  local m=()
  for s in "${REQUIRED_SECRETS[@]}"; do gcloud secrets describe "$s" --project "$PROJECT_ID" >/dev/null 2>&1 || m+=("$s"); done
  [ ${#m[@]} -eq 0 ] || { printf 'missing secret: %s\n' "${m[@]}" >&2; return 1; }
}

case "$cmd" in
  preflight)
    echo "project: $PROJECT_ID   supabase: $PROD_SUPABASE_REF   web: $PROD_WEB_ORIGIN"
    git_ok && echo "git: clean, main == origin/main"
    missing_secrets && echo "secrets: all required ones exist"
    echo "commit to confirm for --execute: PROD_CONFIRM=$short"
    exit 0 ;;
  status)
    gcloud run services list --project "$PROJECT_ID" --region "$REGION" --format='table(metadata.name,status.url,status.latestReadyRevisionName,spec.template.spec.serviceAccountName.basename())'
    gcloud run jobs list --project "$PROJECT_ID" --region "$REGION"
    gcloud scheduler jobs list --project "$PROJECT_ID" --location "$REGION"
    exit 0 ;;
  rollback | latest)
    svc="${args[0]:?usage: production.sh $cmd <sme-api|sme-web> [REVISION] [--execute]}"
    case "$svc" in sme-api | sme-web) ;; *) echo "service must be sme-api or sme-web" >&2; exit 2 ;; esac
    if [ "$cmd" = rollback ]; then
      rev="${args[1]:-$(gcloud run revisions list --project "$PROJECT_ID" --region "$REGION" --service "$svc" --sort-by='~metadata.creationTimestamp' --format='value(metadata.name)' | sed -n 2p)}"
      [ -n "$rev" ] || { echo "no earlier revision to go back to" >&2; exit 1; }
      step=(gcloud run services update-traffic "$svc" --project "$PROJECT_ID" --region "$REGION" --to-revisions "$rev=100")
    else
      step=(gcloud run services update-traffic "$svc" --project "$PROJECT_ID" --region "$REGION" --to-latest)
    fi
    printf '+'; printf ' %q' "${step[@]}"; printf '\n'
    if [ -n "$execute" ]; then [ "${PROD_CONFIRM:-}" = "$short" ] || { echo "REFUSED: PROD_CONFIRM=$short is needed" >&2; exit 2; }; "${step[@]}"; fi
    exit 0 ;;
  deploy) ;;
  *) echo "usage: $0 preflight | status | deploy [api|web|worker|all] [--execute] | rollback <svc> [rev] [--execute] | latest <svc> [--execute]" >&2; exit 2 ;;
esac

if [ -n "$execute" ]; then
  git_ok
  [ "${PROD_CONFIRM:-}" = "$short" ] || { echo "REFUSED: set PROD_CONFIRM=$short to deploy this commit to PRODUCTION" >&2; exit 2; }
  missing_secrets
fi

# public values only
SUPABASE_URL="https://$PROD_SUPABASE_REF.supabase.co"
SUPABASE_PUBLISHABLE_KEY="$(supabase projects api-keys --project-ref "$PROD_SUPABASE_REF" --agent no -o json 2>/dev/null | python3 -c 'import sys,json; d,_=json.JSONDecoder().raw_decode(sys.stdin.read()); print(next(k["api_key"] for k in d if k["type"]=="publishable"),end="")')"
[ -n "$SUPABASE_PUBLISHABLE_KEY" ] || { echo "could not read the publishable key: run \`supabase login\`" >&2; exit 1; }
export SUPABASE_URL SUPABASE_PUBLISHABLE_KEY WEB_ORIGIN="$PROD_WEB_ORIGIN"
# Calls and Plivo callbacks are signed against the API's run.app address, which never changes for this service; the web at WEB_ORIGIN is only the browser's address.
export API_URL="https://sme-api-$PROJECT_NUMBER.$REGION.run.app"
export PRIVACY_EMAIL="privacy@${PROD_MAIL_DOMAIN}" HELLO_EMAIL="hello@${PROD_MAIL_DOMAIN}"
export EXTRA_ENV_2="BILLING_EMAIL_SENDER=resend,MAIL_FROM=noreply@${PROD_MAIL_DOMAIN},MAIL_REPLY_TO=support@${PROD_MAIL_DOMAIN},WORKSPACE_SECRETS=gcp,WORKSPACE_SECRETS_PROJECT=$PROJECT_ID"
export BUILD_SA="sme-build@$PROJECT_ID.iam.gserviceaccount.com"
export TAG="${TAG:-$short}"

if [ "$what" = "api" ] || [ "$what" = "all" ]; then
  # TELEPHONY. Mode `sandbox` (only the numbers in the secret sme-telephony-sandbox-numbers may call in) until the owner has opened the real-data gate AND said "live" in writing: then
  # PROD_TELEPHONY_MODE=live PROD_LIVE_OK=yes. Outbound stays false and the Lead Desk dialer stays OFF (TASKS_DIALER empty) until the owner says otherwise.
  mode="${PROD_TELEPHONY_MODE:-sandbox}"
  if [ "$mode" = live ] && [ "${PROD_LIVE_OK:-}" != yes ]; then echo "REFUSED: PROD_TELEPHONY_MODE=live needs PROD_LIVE_OK=yes (the owner's written go-live, docs/runbooks/customer-zero-go-live-checklist.md)" >&2; exit 2; fi
  SAND=""; if gcloud secrets describe sme-telephony-sandbox-numbers --project "$PROJECT_ID" >/dev/null 2>&1; then SAND=",TELEPHONY_SANDBOX_NUMBERS=sme-telephony-sandbox-numbers:latest"; fi
  TEL_ENV="TELEPHONY_MODE=$mode,TELEPHONY_OUTBOUND=${PROD_TELEPHONY_OUTBOUND:-false},TASKS_DIALER=${PROD_TASKS_DIALER:-},TELEPHONY_MAX_CONCURRENT=${PROD_MAX_CONCURRENT_CALLS:-2},TELEPHONY_COST_PAISE_PER_MINUTE=${TELEPHONY_COST_PAISE_PER_MINUTE:-38},TELEPHONY_COST_PULSE_S=30,TELEPHONY_MAX_CALL_S=${TELEPHONY_MAX_CALL_S:-300},TELEPHONY_INBOUND_LANGUAGE=${TELEPHONY_INBOUND_LANGUAGE:-te},SCHEDULER_EMAIL=${PROD_SCHEDULER_EMAIL:?set PROD_SCHEDULER_EMAIL (the scheduler account of the production project)},PUBLIC_BASE_URL=$API_URL"
  TEL_SECRETS=",SCHEDULER_PASSWORD=sme-scheduler-password:latest,EXOTEL_STREAM_SECRET=sme-exotel-stream-secret:latest,PLIVO_AUTH_ID=sme-plivo-auth-id:latest,PLIVO_AUTH_TOKEN=sme-plivo-auth-token:latest$SAND"
  # ONE API instance with always-on CPU (the answer to a call must never wait for a cold start, ADR 0072). MAX 1: a live call lives on the server that answered it (Take over, Whisper, Hang up only work there),
  # so a second instance is not allowed until the routing in docs/pre-pilot-checklist.md exists. Customer Zero is one shop; TELEPHONY_MAX_CONCURRENT caps the calls on that instance.
  # No WhatsApp Cloud API in production v1 (owner, 11 Nov 2026): the WhatsApp summary is a prepared text the owner sends by hand; the outbox adapter stays the fake one.
  RUN_SA="sme-api-run@$PROJECT_ID.iam.gserviceaccount.com" AGENTS_ENABLED=true CPU_ALWAYS=true MIN_INSTANCES=1 API_MAX_INSTANCES=1 \
    EXTRA_ENV="API_ENV=production,BROWSER_VOICE_ENABLED=true,BROWSER_VOICE_SPEAKER_CHECK=shadow,BROWSER_VOICE_DAY_SECONDS=3600,TERMS_VERSION=${TERMS_VERSION:-2026-10-27},PRIVACY_VERSION=${PRIVACY_VERSION:-2026-10-27},LLM_PROVIDER=anthropic,LLM_MODEL=claude-haiku-5-5,LLM_INPUT_MICROS_PER_MTOK=9000000,LLM_OUTPUT_MICROS_PER_MTOK=45000000,LLM_SPEND_CAP_CONFIRMED=true,AGENTS_MAX_WORKERS=1,AGENTS_MAX_QUEUE=4,SPEECH_PROVIDER=sarvam" \
    EXTRA_ENV_2="$EXTRA_ENV_2,$TEL_ENV" \
    EXTRA_SECRETS="ANTHROPIC_API_KEY=sme-anthropic-api-key:latest,RESEND_API_KEY=sme-resend-api-key:latest,SARVAM_API_KEY=sme-sarvam-api-key:latest,CARTESIA_API_KEY=sme-cartesia-api-key:latest,SUPPRESSION_HMAC_KEY=sme-suppression-hmac-key:latest$TEL_SECRETS" \
    ./deploy/cloudrun.sh api $execute
fi
if [ "$what" = "web" ] || [ "$what" = "all" ]; then
  WEB_FLAGS="^|^$(grep -v -e '^#' -e '^$' deploy/production-web-flags.env | paste -sd'|' - || true)"
  WEB_FLAGS="$WEB_FLAGS" WEB_RUN_SA="sme-web-run@$PROJECT_ID.iam.gserviceaccount.com" ./deploy/cloudrun.sh web $execute
fi
if [ "$what" = "worker" ] || [ "$what" = "all" ]; then
  RUN_SA="sme-worker-run@$PROJECT_ID.iam.gserviceaccount.com" SCHEDULER_SA="sme-tick@$PROJECT_ID.iam.gserviceaccount.com" SCHEDULER_EMAIL="${PROD_SCHEDULER_EMAIL:?set PROD_SCHEDULER_EMAIL}" \
    WORKER_EVERY_MINUTES=1 WORKER_OUTBOX_ADAPTER=fake \
    WORKER_EXTRA_ENV="BILLING_EMAIL_SENDER=resend,MAIL_FROM=noreply@${PROD_MAIL_DOMAIN},MAIL_REPLY_TO=support@${PROD_MAIL_DOMAIN},SPEECH_PROVIDER=sarvam,OUTREACH_DIALER=fake,TELEPHONY_MAX_CALL_S=${TELEPHONY_MAX_CALL_S:-300}" \
    WORKER_EXTRA_SECRETS="RESEND_API_KEY=sme-resend-api-key:latest,SARVAM_API_KEY=sme-sarvam-api-key:latest" \
    ./deploy/cloudrun.sh worker $execute
fi
echo "production: $WEB_ORIGIN  (api: $API_URL)  tag $TAG  $([ -n "$execute" ] && echo EXECUTED || echo 'DRY RUN: nothing was changed')"
