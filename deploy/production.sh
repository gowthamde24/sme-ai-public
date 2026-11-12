#!/usr/bin/env bash
# The PRODUCTION stack on Google Cloud Run (asia-south1) + the production Supabase project (Mumbai). Written 11 Nov 2026 (owner: production by 30 Nov, plan docs/runbooks/production-bringup.md).
# NOTHING IS RUN BY DEFAULT: every deploy is a DRY RUN that prints the commands. To act: --execute AND PROD_CONFIRM=<the short commit id printed by `preflight`> AND a clean checkout of main that equals origin/main.
# It is a separate script from deploy/staging.sh on purpose: the two can never touch each other's project (both ids are checked against each other here), and production carries none of staging's test fences.
#
#   deploy/production.sh preflight                       the checks only (read-only): ids, secrets that must exist, git state; prints the commit id to confirm
#   deploy/production.sh status                          services, jobs, schedules, live revisions
#   deploy/production.sh deploy [api|web|worker|all] [--execute]
#   PROD_SLICE=waitlist deploy/production.sh deploy [api|worker|all] [--execute]    the waitlist slice (docs/runbooks/production-waitlist-slice.md): the API from the declared files in deploy/settings/production-waitlist/
#                                                        (agents off, telephony off, scale to zero, secrets: the suppression key and the captcha secret), plus the worker. `web` is refused (the app is not in the slice). Needs an explicit
#                                                        PRIVACY_VERSION (the owner-approved text's version string; the form accepts consent to exactly that text).
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

# PROD_SLICE: "" = the full stack (the phone, the app), "waitlist" = the waitlist slice only (owner, 12 Nov 2026).
slice="${PROD_SLICE:-}"
case "$slice" in "" | waitlist) ;; *) echo "PROD_SLICE must be empty or waitlist" >&2; exit 2 ;; esac
do_api=false; do_web=false; do_worker=false
case "$what" in api) do_api=true ;; web) do_web=true ;; worker) do_worker=true ;; all) do_api=true; do_web=true; do_worker=true ;; esac
if [ -n "$slice" ]; then
  [ "$what" != web ] || { echo "REFUSED: PROD_SLICE=$slice does not include the app web (the public site moves separately, website-go-live.md step 8)" >&2; exit 2; }
  do_web=false
fi

# the secrets production needs (names only). REQUIRED ones must exist before any --execute; OPTIONAL ones are mounted only when present.
if [ "$slice" = waitlist ]; then
  REQUIRED_SECRETS=(sme-suppression-hmac-key sme-turnstile-secret sme-scheduler-password sme-resend-api-key)
else
  REQUIRED_SECRETS=(sme-suppression-hmac-key sme-scheduler-password sme-resend-api-key sme-anthropic-api-key sme-sarvam-api-key sme-cartesia-api-key sme-plivo-auth-id sme-plivo-auth-token sme-exotel-stream-secret sme-telephony-sandbox-numbers)
fi

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
      live="$(gcloud run services describe "$svc" --project "$PROJECT_ID" --region "$REGION" --format='value(status.traffic[0].revisionName)')"   # the one that SERVES: a newer revision may exist that never got traffic (the guard refused it)
      rev="${args[1]:-$(gcloud run revisions list --project "$PROJECT_ID" --region "$REGION" --service "$svc" --sort-by='~metadata.creationTimestamp' --format='value(metadata.name)' | awk -v s="$live" 'f { print; exit } $0 == s { f = 1 }')}"
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

# THE API IS DEPLOYED WITHOUT TRAFFIC, CHECKED, AND ONLY THEN GIVEN THE TRAFFIC (owner, 12 Nov 2026, after the staging deploy that dropped the telephony settings): deploy/api_guard.sh. Settings are only UPDATED (cloudrun.sh), never replaced.
# Every difference from the revision that serves, except what ALLOW_FLAG_CHANGE names (e.g. ALLOW_FLAG_CHANGE=TELEPHONY_MODE for the go-live), stops the script with exit 3 and the new revision gets no traffic.

# public values only (the declared files read them through their @env: lines, BEFORE the guard compares the files with the serving revision)
SUPABASE_URL="https://$PROD_SUPABASE_REF.supabase.co"
SUPABASE_PUBLISHABLE_KEY="$(supabase projects api-keys --project-ref "$PROD_SUPABASE_REF" --agent no -o json 2>/dev/null | python3 -c 'import sys,json; d,_=json.JSONDecoder().raw_decode(sys.stdin.read()); print(next(k["api_key"] for k in d if k["type"]=="publishable"),end="")')"
[ -n "$SUPABASE_PUBLISHABLE_KEY" ] || { echo "could not read the publishable key: run \`supabase login\`" >&2; exit 1; }
export SUPABASE_URL SUPABASE_PUBLISHABLE_KEY WEB_ORIGIN="$PROD_WEB_ORIGIN"
export SUPABASE_JWT_ISSUER="$SUPABASE_URL/auth/v1" SUPABASE_JWKS_URL="$SUPABASE_URL/auth/v1/.well-known/jwks.json"
export API_CORS_ORIGINS="${PROD_SITE_ORIGIN:+$PROD_SITE_ORIGIN,}$PROD_WEB_ORIGIN"   # the public site's address (optional) and the app's
# Calls and Plivo callbacks are signed against the API's run.app address, which never changes for this service; the web at WEB_ORIGIN is only the browser's address.
export API_URL="https://sme-api-$PROJECT_NUMBER.$REGION.run.app"
export PRIVACY_EMAIL="privacy@${PROD_MAIL_DOMAIN}" HELLO_EMAIL="hello@${PROD_MAIL_DOMAIN}"
export MAIL_FROM="noreply@${PROD_MAIL_DOMAIN}" MAIL_REPLY_TO="support@${PROD_MAIL_DOMAIN}" SCHEDULER_EMAIL="${PROD_SCHEDULER_EMAIL:-}"
export BUILD_SA="sme-build@$PROJECT_ID.iam.gserviceaccount.com"
export TAG="${TAG:-$short}"

# THE DECLARED SETTINGS of the API: deploy/settings/production-waitlist/ for the slice, deploy/settings/production/ for the full stack (api.env, api.secrets, api.scale). Nothing else is added to the service.
if [ "$slice" = waitlist ]; then API_SETTINGS_DIR="deploy/settings/production-waitlist"; else API_SETTINGS_DIR="deploy/settings/production"; fi
export API_SETTINGS_DIR
if $do_api; then
  if [ "$slice" = waitlist ]; then
    : "${PRIVACY_VERSION:?REFUSED: set PRIVACY_VERSION to the version string of the owner-approved privacy text (a stale or unapproved value would make the form accept consent to the wrong text)}"
  else
    : "${PROD_SCHEDULER_EMAIL:?set PROD_SCHEDULER_EMAIL (the scheduler account of the production project)}"
    PRIVACY_VERSION="${PRIVACY_VERSION:-2026-10-27}"   # the text that is live today; the owner's new version string comes with the approval
    # TELEPHONY: `live` is the owner's written go-live (customer-zero-go-live-checklist.md): the declared file may only say it when PROD_LIVE_OK=yes, and the deploy names the change (ALLOW_FLAG_CHANGE=TELEPHONY_MODE).
    if grep -q '^TELEPHONY_MODE=live' "$API_SETTINGS_DIR/api.env" && [ "${PROD_LIVE_OK:-}" != yes ]; then echo "REFUSED: $API_SETTINGS_DIR/api.env says TELEPHONY_MODE=live: that needs PROD_LIVE_OK=yes (the owner's written go-live)" >&2; exit 2; fi
  fi
  export PRIVACY_VERSION
fi
FLAGS_BEFORE=""
. deploy/api_guard.sh
if $do_api; then guard_before "$PROJECT_ID" "$REGION"; fi   # (read-only: a dry run too)

if $do_api; then
  # slice: agents off, scale to zero, request-based CPU. Full: ONE instance with always-on CPU (the answer to a call must never wait for a cold start, ADR 0072; MAX 1 because a live call lives on the server that answered it:
  # Take over, Whisper, Hang up only work there, so a second instance is not allowed until the routing in docs/pre-pilot-checklist.md exists; TELEPHONY_MAX_CONCURRENT caps the calls on it). The scale comes from api.scale.
  # No WhatsApp Cloud API in production v1 (owner, 11 Nov 2026): the WhatsApp summary is a prepared text the owner sends by hand; the outbox adapter stays the fake one.
  if [ "$slice" = waitlist ]; then agents=false; cpu_always=false; else agents=true; cpu_always=true; fi
  NO_TRAFFIC=1 API_SETTINGS_DIR="$API_SETTINGS_DIR" RUN_SA="sme-api-run@$PROJECT_ID.iam.gserviceaccount.com" AGENTS_ENABLED="$agents" CPU_ALWAYS="$cpu_always" ./deploy/cloudrun.sh api $execute
  if [ -n "$FLAGS_BEFORE" ] && [ -n "$execute" ]; then guard_after "$PROJECT_ID" "$REGION"; fi
fi
if $do_web; then
  WEB_FLAGS="^|^$(grep -v -e '^#' -e '^$' deploy/production-web-flags.env | paste -sd'|' - || true)"
  WEB_FLAGS="$WEB_FLAGS" WEB_RUN_SA="sme-web-run@$PROJECT_ID.iam.gserviceaccount.com" ./deploy/cloudrun.sh web $execute
fi
if $do_worker; then
  # the slice's worker sends the "new entry" e-mail and does the 12-month purge: the resend key only (no speech key, no dialer)
  if [ "$slice" = waitlist ]; then W_ENV="BILLING_EMAIL_SENDER=resend,MAIL_FROM=noreply@${PROD_MAIL_DOMAIN},MAIL_REPLY_TO=support@${PROD_MAIL_DOMAIN},OUTREACH_DIALER=fake"; W_SECRETS="RESEND_API_KEY=sme-resend-api-key:latest"
  else W_ENV="BILLING_EMAIL_SENDER=resend,MAIL_FROM=noreply@${PROD_MAIL_DOMAIN},MAIL_REPLY_TO=support@${PROD_MAIL_DOMAIN},SPEECH_PROVIDER=sarvam,OUTREACH_DIALER=fake,TELEPHONY_MAX_CALL_S=${TELEPHONY_MAX_CALL_S:-300}"; W_SECRETS="RESEND_API_KEY=sme-resend-api-key:latest,SARVAM_API_KEY=sme-sarvam-api-key:latest"; fi
  RUN_SA="sme-worker-run@$PROJECT_ID.iam.gserviceaccount.com" SCHEDULER_SA="sme-tick@$PROJECT_ID.iam.gserviceaccount.com" SCHEDULER_EMAIL="${PROD_SCHEDULER_EMAIL:?set PROD_SCHEDULER_EMAIL}" \
    WORKER_EVERY_MINUTES=1 WORKER_OUTBOX_ADAPTER=fake \
    WORKER_EXTRA_ENV="$W_ENV" \
    WORKER_EXTRA_SECRETS="$W_SECRETS" \
    ./deploy/cloudrun.sh worker $execute
fi
echo "production: $WEB_ORIGIN  (api: $API_URL)  tag $TAG  $([ -n "$execute" ] && echo EXECUTED || echo 'DRY RUN: nothing was changed')"
