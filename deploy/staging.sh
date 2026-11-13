#!/usr/bin/env bash
# One-command (re)deploy of the STAGING stack on Google Cloud Run, asia-south1 (job DC). Staging is the stack19-staging Google Cloud project plus the stack19-staging Supabase project; nothing here
# can touch another project: both ids are constants below. Synthetic data only; the real-data gate stays closed (ADR 0015). What runs where: docs/ops/staging.md.
#
#   deploy/staging.sh deploy [api|web|worker|all]   [--dry-run]   build the images remotely (Cloud Build) and deploy; default: all.   (`make deploy-staging`, DRY=1 for a dry run)
#   deploy/staging.sh status                                      the services, the job, the scheduler and the live revisions                   (`make staging-status`)
#   deploy/staging.sh latest <sme-api|sme-web>                   undo a rollback: 100 % of traffic to the newest revision again                  (`make staging-latest SERVICE=sme-web`)
#   deploy/staging.sh rollback <sme-api|sme-web> [REVISION]       send 100 % of traffic to REVISION (default: the one before the live one)   (`make rollback-staging SERVICE=sme-api`)
#
# No secret is read, printed or stored here: the Supabase publishable key is public (read from the CLI), every server-side secret is a Secret Manager reference (names in docs/ops/staging.md).
set -euo pipefail
cd "$(dirname "$0")/.."

PROJECT_ID="project-2757c07e-37d2-4167-88f"
PROJECT_NUMBER="620338396268"
SUPABASE_REF="uiallwgywitryxatcqxf"
REGION="asia-south1"
export PROJECT_ID REGION

cmd="${1:-}"; shift || true
case "$cmd" in
  status)
    gcloud run services list --project "$PROJECT_ID" --region "$REGION" --format='table(metadata.name,status.url,status.latestReadyRevisionName,spec.template.spec.serviceAccountName.basename())'
    gcloud run jobs list --project "$PROJECT_ID" --region "$REGION"
    gcloud scheduler jobs list --project "$PROJECT_ID" --location "$REGION"
    exit 0 ;;
  rollback)
    svc="${1:?usage: staging.sh rollback <sme-api|sme-web> [REVISION]}"; rev="${2:-}"
    case "$svc" in sme-api | sme-web) ;; *) echo "service must be sme-api or sme-web" >&2; exit 2 ;; esac
    if [ -z "$rev" ]; then
      # revisions, newest first; the one after the one that SERVES (a newer revision may exist that never got traffic: the guard refused it)
      live="$(gcloud run services describe "$svc" --project "$PROJECT_ID" --region "$REGION" --format='value(status.traffic[0].revisionName)')"
      rev="$(gcloud run revisions list --project "$PROJECT_ID" --region "$REGION" --service "$svc" --sort-by='~metadata.creationTimestamp' --format='value(metadata.name)' | awk -v s="$live" 'f { print; exit } $0 == s { f = 1 }')"
      [ -n "$rev" ] || { echo "no earlier revision to go back to" >&2; exit 1; }
    fi
    echo "rolling $svc back to $rev"
    gcloud run services update-traffic "$svc" --project "$PROJECT_ID" --region "$REGION" --to-revisions "$rev=100"
    exit 0 ;;
  latest)
    # after a rollback a new deploy no longer takes traffic by itself: this sends 100 % to the newest revision again
    svc="${1:?usage: staging.sh latest <sme-api|sme-web>}"
    case "$svc" in sme-api | sme-web) ;; *) echo "service must be sme-api or sme-web" >&2; exit 2 ;; esac
    gcloud run services update-traffic "$svc" --project "$PROJECT_ID" --region "$REGION" --to-latest
    exit 0 ;;
  deploy) ;;
  *) echo "usage: $0 deploy [api|web|worker|all] [--dry-run] | status | rollback <service> [revision] | latest <service>" >&2; exit 2 ;;
esac

what="all"; execute="--execute"
for arg in "$@"; do
  case "$arg" in
    --dry-run) execute="" ;;
    api | web | worker | all) what="$arg" ;;
    *) echo "unknown argument: $arg" >&2; exit 2 ;;
  esac
done

# public values only (read BEFORE the declared settings are checked: api.env points at SUPABASE_PUBLISHABLE_KEY with @env:, so the key is never in git)
SUPABASE_URL="https://$SUPABASE_REF.supabase.co"
SUPABASE_PUBLISHABLE_KEY="$(supabase projects api-keys --project-ref "$SUPABASE_REF" --agent no -o json 2>/dev/null | python3 -c 'import sys,json; d,_=json.JSONDecoder().raw_decode(sys.stdin.read()); print(next(k["api_key"] for k in d if k["type"]=="publishable"),end="")')"
[ -n "$SUPABASE_PUBLISHABLE_KEY" ] || { echo "could not read the publishable key: run \`supabase login\`" >&2; exit 1; }
export SUPABASE_URL SUPABASE_PUBLISHABLE_KEY

# THE API'S SETTINGS ARE DECLARED IN THE REPOSITORY (owner, 12 Nov 2026): deploy/settings/staging/ (api.env, api.secrets, api.scale; deploy/settings.py). The deploy applies exactly those files and nothing from the
# shell of whoever runs it (the old `TELEPHONY_INBOUND=1 API_MIN_INSTANCES=1 make deploy-staging` prefixes are gone). To change a setting: edit the file in a pull request, then deploy with ALLOW_FLAG_CHANGE=NAME naming it.
# Before anything is built the declared files are compared with the revision that SERVES (a difference is drift, or the change meant for this deploy); the new revision is made WITHOUT traffic, compared with the
# serving one (deploy/api_guard.sh) and only then gets the traffic.
FLAGS_BEFORE=""
API_SETTINGS_DIR="deploy/settings/staging"
. deploy/api_guard.sh
if [ "$what" = "api" ] || [ "$what" = "all" ]; then guard_before "$PROJECT_ID" "$REGION"; fi   # (read-only, so a dry run prints the command the real run will use)

# public values only
export API_URL="https://sme-api-$PROJECT_NUMBER.$REGION.run.app"
export MAIL_DOMAIN="${MAIL_DOMAIN:-stack19.com}"   # the domain verified at the e-mail provider; the addresses are made from it here, never written out (job RESEND)
export PRIVACY_EMAIL="${PRIVACY_EMAIL:-privacy@${MAIL_DOMAIN}}" HELLO_EMAIL="${HELLO_EMAIL:-hello@${MAIL_DOMAIN}}"   # the inboxes of the privacy notice and the waitlist (job DQ, DPDP)
export WEB_ORIGIN="${WEB_ORIGIN:-https://staging.stack19.com}"   # the address the web is served from (the API's CORS fence, the sitemap): the custom domain, a Cloudflare Worker in front of the run.app address (docs/ops/staging.md)
export BUILD_SA="sme-build@$PROJECT_ID.iam.gserviceaccount.com"
dirty=""; git diff --quiet HEAD -- . 2>/dev/null || dirty="-dirty$(date +%H%M%S)"
export TAG="${TAG:-$(git rev-parse --short HEAD)$dirty}"   # TAG=<tag> names the tag to build and deploy

# the TEST FENCE (docs/runbooks/whatsapp-staging.md): the only numbers a message may be sent to, by the API AND by the worker. Left empty, NOTHING is sent.
if [ -z "${WHATSAPP_ALLOWED_RECIPIENTS+x}" ]; then
  # Not given: keep the fence the worker already has. A deploy that forgot it used to close the fence for the API, and the Owner's approved reply was refused ("rejected") without Meta ever being called (29 Oct).
  WHATSAPP_ALLOWED_RECIPIENTS="$(gcloud run jobs describe sme-worker --region "$REGION" --project "$PROJECT_ID" --format=json 2>/dev/null | python3 -c 'import json,sys
d=json.load(sys.stdin)
for c in d["spec"]["template"]["spec"]["template"]["spec"]["containers"]:
    for e in c.get("env", []):
        if e["name"] == "WHATSAPP_ALLOWED_RECIPIENTS":
            print(e.get("value", ""))' 2>/dev/null || true)"
fi
WHATSAPP_ALLOWED_RECIPIENTS="${WHATSAPP_ALLOWED_RECIPIENTS-}"

if [ "$what" = "api" ] || [ "$what" = "all" ]; then
  # ONE server on staging (owner, 9 Nov 2026): a live call lives on the server that answered it, so Take over, Whisper and Hang up only work on that one (deploy/settings/staging/api.scale). Production needs the routing below (docs/pre-pilot-checklist.md)
  # API_TIMEOUT=660: a browser Talk live session is one WebSocket request and Cloud Run ends a request at its timeout; the session cap on staging is 600 s (BROWSER_VOICE_SESSION_SECONDS), so the request may live a minute longer (owner, 13 Nov 2026). Production keeps 300 until the owner decides.
  API_TIMEOUT=660 NO_TRAFFIC=1 API_SETTINGS_DIR="$API_SETTINGS_DIR" RUN_SA="sme-api-run@$PROJECT_ID.iam.gserviceaccount.com" AGENTS_ENABLED=true CPU_ALWAYS=true ./deploy/cloudrun.sh api $execute
fi
# the flag check on the NEW revision, which has no traffic yet: nothing may differ from the revision that serves, except what ALLOW_FLAG_CHANGE names. Only then does it get the traffic (stops with exit 3 otherwise, the old one keeps serving).
if [ -n "$FLAGS_BEFORE" ] && [ -n "$execute" ]; then guard_after "$PROJECT_ID" "$REGION"; fi
# The nightly pronunciation round trip (docs/runbooks/pronunciation-nightly-qa.md) is a Cloud Run job on the API's image, created by the owner. Once it exists, every API deploy moves it to the new image, so each night tests the
# lexicon and the speech path that are live. Nothing happens when the job is not there.
if { [ "$what" = "api" ] || [ "$what" = "all" ]; } && [ -n "$execute" ] && gcloud run jobs describe sme-pron-qa --project "$PROJECT_ID" --region "$REGION" >/dev/null 2>&1; then
  gcloud run jobs update sme-pron-qa --project "$PROJECT_ID" --region "$REGION" --image "$REGION-docker.pkg.dev/$PROJECT_ID/${REPO:-sme}/api:$TAG"
fi
if [ "$what" = "web" ] || [ "$what" = "all" ]; then
  # the staging web's feature flags live in the repo (owner, 9 Nov 2026): every deploy sets them again, so none can be lost
  WEB_FLAGS="^|^$(grep -v -e '^#' -e '^$' deploy/staging-web-flags.env | paste -sd'|' -)"
  WEB_FLAGS="$WEB_FLAGS" WEB_RUN_SA="sme-web-run@$PROJECT_ID.iam.gserviceaccount.com" ./deploy/cloudrun.sh web $execute
fi
if [ "$what" = "worker" ] || [ "$what" = "all" ]; then
  # Automatic WhatsApp replies (job DY): the worker needs the model key, and its service account needs secretAccessor on sme-anthropic-api-key (an owner IAM step, docs/runbooks/whatsapp-staging.md).
  # Run with WORKER_AUTO_REPLY=1 once that is granted; without it the worker still sends (WhatsApp adapter, fenced) but does not draft replies.
  WORKER_AR_ENV="" WORKER_AR_SECRETS=""
  if [ "${WORKER_AUTO_REPLY:-0}" = 1 ]; then WORKER_AR_ENV=",AUTO_REPLY_ENABLED=true,AUTO_REPLY_MODEL=claude-haiku-5-5"; WORKER_AR_SECRETS=",ANTHROPIC_API_KEY=sme-anthropic-api-key:latest"; fi
  # The AI lead reader (owner decision, 31 Oct 2026): the worker reads a new WhatsApp lead's first message with the light model and fills the profile with low confidence (WORKER_LEAD_READER=1). Same key as the auto-reply; the
  # database decides who is read (real-data gate open, not a school, agents on, 200 reads a workspace a day).
  if [ "${WORKER_LEAD_READER:-0}" = 1 ]; then
    WORKER_AR_ENV="$WORKER_AR_ENV,LEAD_READER_ENABLED=true,LEAD_READER_MODEL=claude-haiku-5-5"
    case "$WORKER_AR_SECRETS" in *ANTHROPIC_API_KEY*) ;; *) WORKER_AR_SECRETS="$WORKER_AR_SECRETS,ANTHROPIC_API_KEY=sme-anthropic-api-key:latest" ;; esac
  fi
  # the worker has its own image (the API's code plus ffmpeg, job DJ), built here with the same TAG. TELEPHONY_MAX_CALL_S: the worker closes a call that said nothing for the call cap + 60 s (the live bar never lies), so it must know the cap
  RUN_SA="sme-worker-run@$PROJECT_ID.iam.gserviceaccount.com" SCHEDULER_SA="sme-tick@$PROJECT_ID.iam.gserviceaccount.com" SCHEDULER_EMAIL="scheduler@demo.example.test" \
    WORKER_EVERY_MINUTES=1 WORKER_OUTBOX_ADAPTER=whatsapp \
    WORKER_EXTRA_ENV="BILLING_EMAIL_SENDER=resend,MAIL_FROM=noreply@${MAIL_DOMAIN},MAIL_REPLY_TO=support@${MAIL_DOMAIN},SPEECH_PROVIDER=sarvam,OUTREACH_DIALER=fake,TELEPHONY_MAX_CALL_S=${TELEPHONY_MAX_CALL_S:-180},WHATSAPP_GRAPH_VERSION=v25.0,WHATSAPP_ALLOWED_RECIPIENTS=${WHATSAPP_ALLOWED_RECIPIENTS}${WORKER_AR_ENV}" \
    WORKER_EXTRA_SECRETS="RESEND_API_KEY=sme-resend-api-key:latest,SARVAM_API_KEY=sme-sarvam-api-key:latest,WHATSAPP_ACCESS_TOKEN=sme-whatsapp-token:latest${WORKER_AR_SECRETS}" \
    ./deploy/cloudrun.sh worker $execute
fi
echo "staging: $WEB_ORIGIN  (api: $API_URL)  tag $TAG"
