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
      # revisions, newest first; the second is the one before the live one
      rev="$(gcloud run revisions list --project "$PROJECT_ID" --region "$REGION" --service "$svc" --sort-by='~metadata.creationTimestamp' --format='value(metadata.name)' | sed -n 2p)"
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

# public values only
SUPABASE_URL="https://$SUPABASE_REF.supabase.co"
SUPABASE_PUBLISHABLE_KEY="$(supabase projects api-keys --project-ref "$SUPABASE_REF" --agent no -o json 2>/dev/null | python3 -c 'import sys,json; d,_=json.JSONDecoder().raw_decode(sys.stdin.read()); print(next(k["api_key"] for k in d if k["type"]=="publishable"),end="")')"
[ -n "$SUPABASE_PUBLISHABLE_KEY" ] || { echo "could not read the publishable key: run \`supabase login\`" >&2; exit 1; }
export SUPABASE_URL SUPABASE_PUBLISHABLE_KEY
export API_URL="https://sme-api-$PROJECT_NUMBER.$REGION.run.app"
export MAIL_DOMAIN="${MAIL_DOMAIN:-stack19.com}"   # the domain verified at the e-mail provider; the addresses are made from it here, never written out (job RESEND)
export PRIVACY_EMAIL="${PRIVACY_EMAIL:-privacy@${MAIL_DOMAIN}}" HELLO_EMAIL="${HELLO_EMAIL:-hello@${MAIL_DOMAIN}}"   # the inboxes of the privacy notice and the waitlist (job DQ, DPDP)
export WEB_ORIGIN="${WEB_ORIGIN:-https://staging.stack19.com}"   # the address the web is served from (the API's CORS fence, the sitemap): the custom domain, a Cloudflare Worker in front of the run.app address (docs/ops/staging.md)
export BUILD_SA="sme-build@$PROJECT_ID.iam.gserviceaccount.com"
dirty=""; git diff --quiet HEAD -- . 2>/dev/null || dirty="-dirty$(date +%H%M%S)"
export TAG="${TAG:-$(git rev-parse --short HEAD)$dirty}"   # TAG=<tag> names the tag to build and deploy

if [ "$what" = "api" ] || [ "$what" = "all" ]; then
  # AI: Anthropic's cheapest model, the key from Secret Manager, a low spend (prices in millionths of a rupee per million tokens at 90 rupees to the dollar: Haiku 5.5 is $0.10 in, $0.50 out per million).
  # CPU is allocated while an instance is up (the agents run in threads) but min-instances 0 means no fixed cost: it scales to zero when idle.
  RUN_SA="sme-api-run@$PROJECT_ID.iam.gserviceaccount.com" AGENTS_ENABLED=true CPU_ALWAYS=true MIN_INSTANCES=0 \
    EXTRA_ENV="TERMS_VERSION=2026-10-27,PRIVACY_VERSION=2026-10-27,LLM_PROVIDER=anthropic,LLM_MODEL=claude-haiku-5-5,LLM_INPUT_MICROS_PER_MTOK=9000000,LLM_OUTPUT_MICROS_PER_MTOK=45000000,LLM_SPEND_CAP_CONFIRMED=true,AGENTS_MAX_WORKERS=1,AGENTS_MAX_QUEUE=4,SPEECH_PROVIDER=sarvam" \
    EXTRA_SECRETS="ANTHROPIC_API_KEY=sme-anthropic-api-key:latest,RESEND_API_KEY=sme-resend-api-key:latest,SARVAM_API_KEY=sme-sarvam-api-key:latest" \
    ./deploy/cloudrun.sh api $execute
fi
if [ "$what" = "web" ] || [ "$what" = "all" ]; then
  WEB_RUN_SA="sme-web-run@$PROJECT_ID.iam.gserviceaccount.com" ./deploy/cloudrun.sh web $execute
fi
if [ "$what" = "worker" ] || [ "$what" = "all" ]; then
  # the worker has its own image (the API's code plus ffmpeg, job DJ), built here with the same TAG
  RUN_SA="sme-worker-run@$PROJECT_ID.iam.gserviceaccount.com" SCHEDULER_SA="sme-tick@$PROJECT_ID.iam.gserviceaccount.com" SCHEDULER_EMAIL="scheduler@demo.example.test" WORKER_EVERY_MINUTES=5 \
    WORKER_EXTRA_ENV="BILLING_EMAIL_SENDER=resend,MAIL_FROM=noreply@${MAIL_DOMAIN},MAIL_REPLY_TO=support@${MAIL_DOMAIN},SPEECH_PROVIDER=sarvam,OUTREACH_DIALER=fake" WORKER_EXTRA_SECRETS="RESEND_API_KEY=sme-resend-api-key:latest,SARVAM_API_KEY=sme-sarvam-api-key:latest" \
    ./deploy/cloudrun.sh worker $execute
fi
echo "staging: $WEB_ORIGIN  (api: $API_URL)  tag $TAG"
