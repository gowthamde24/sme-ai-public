#!/usr/bin/env bash
# STAGING only: the daily "fresh leads" job of the two Lead Desk demo workspaces (night 4 part B2; docs/runbooks/demo-workspaces.md). Every day at 05:00 India time Cloud Scheduler starts the Cloud Run job
# sme-demo-refresh, which runs scripts/refresh_demo_leads.py: three new website-form leads in DEMO Sri Sai Homes and DEMO Vidya Coaching Centre (both synthetic), nothing else. Idempotent for one day.
#
#   deploy/demo-refresh.sh [--dry-run] [--skip-access]   (re)create the service account, its access to the four demo secrets, the image, the job and the schedule; --dry-run prints the commands and runs none;
#                                          --skip-access leaves the service account and the four secret bindings alone (already done) and starts at the build. BUILD_SA=<account> makes Cloud Build run as that account.
#   deploy/demo-refresh.sh run             start the job once now (the same as the schedule; a second run on the same day adds nothing)
#
# The job's own service account (sme-demo-refresh) can read exactly four secrets (the passwords and authenticator secrets of the two demo owners) and nothing else. No secret is read, printed or stored here;
# the Supabase publishable key is public (it is in the web's pages).
set -euo pipefail
cd "$(dirname "$0")/.."

PROJECT_ID="project-2757c07e-37d2-4167-88f"
SUPABASE_REF="uiallwgywitryxatcqxf"
REGION="asia-south1"
API_URL="https://sme-api-620338396268.asia-south1.run.app"
JOB="sme-demo-refresh"
SCHEDULE_JOB="sme-demo-refresh-daily"
JOB_SA="$JOB@$PROJECT_ID.iam.gserviceaccount.com"
TICK_SA="sme-tick@$PROJECT_ID.iam.gserviceaccount.com"   # the account Cloud Scheduler already uses to start the worker job
SECRETS=(sme-demo-real_estate-password sme-demo-real_estate-totp sme-demo-coaching-password sme-demo-coaching-totp)

if [ "${1:-}" = "run" ]; then
  gcloud run jobs execute "$JOB" --project "$PROJECT_ID" --region "$REGION" --wait
  exit 0
fi
execute="--execute"; skip_access=""
for arg in "$@"; do
  case "$arg" in --dry-run) execute="" ;; --skip-access) skip_access=1 ;; *) echo "usage: $0 [--dry-run] [--skip-access] | run" >&2; exit 2 ;; esac
done

run() { printf '+'; printf ' %q' "$@"; printf '\n'; if [ -n "$execute" ]; then "$@"; fi; }

image="$REGION-docker.pkg.dev/$PROJECT_ID/sme/demo-refresh:$(git rev-parse --short HEAD)"
PUBLISHABLE_KEY="$(supabase projects api-keys --project-ref "$SUPABASE_REF" --agent no -o json 2>/dev/null | python3 -c 'import sys,json; d,_=json.JSONDecoder().raw_decode(sys.stdin.read()); print(next(k["api_key"] for k in d if k["type"]=="publishable"),end="")')"
[ -n "$PUBLISHABLE_KEY" ] || { echo "could not read the publishable key: run \`supabase login\`" >&2; exit 1; }

if [ -z "$skip_access" ]; then
  if [ -z "$execute" ] || ! gcloud iam service-accounts describe "$JOB_SA" --project "$PROJECT_ID" >/dev/null 2>&1; then
    run gcloud iam service-accounts create "$JOB" --project "$PROJECT_ID" --display-name "Staging demo leads refresh (reads four demo secrets)"
  fi
  for s in "${SECRETS[@]}"; do
    run gcloud secrets add-iam-policy-binding "$s" --project "$PROJECT_ID" --member "serviceAccount:$JOB_SA" --role roles/secretmanager.secretAccessor --condition=None
  done
fi
# the build context: ONLY the Dockerfile and the three scripts (the repository's ignore files keep scripts/ out of every image, so the repository root cannot be the source)
if [ -n "$execute" ]; then
  ctx="$(mktemp -d)"; trap 'rm -rf "$ctx"' EXIT
  cp deploy/Dockerfile.demo-refresh scripts/demo_data.py scripts/seed_staging.py scripts/refresh_demo_leads.py "$ctx"/
else
  ctx="<a temp folder with Dockerfile.demo-refresh and the three scripts>"
fi
run gcloud builds submit --project "$PROJECT_ID" --region "$REGION" ${BUILD_SA:+--service-account "projects/$PROJECT_ID/serviceAccounts/$BUILD_SA"} --suppress-logs \
  --config deploy/cloudbuild-demo-refresh.yaml --substitutions "_IMAGE=$image" "$ctx"
run gcloud run jobs deploy "$JOB" --project "$PROJECT_ID" --region "$REGION" --image "$image" --service-account "$JOB_SA" \
  --cpu 1 --memory 512Mi --max-retries 1 --task-timeout 300s \
  --set-env-vars "SUPABASE_PUBLISHABLE_KEY=$PUBLISHABLE_KEY" \
  --args=--i-know-this-loads-demo-data-into-staging,--project-ref,"$SUPABASE_REF",--api-url,"$API_URL"
run gcloud run jobs add-iam-policy-binding "$JOB" --project "$PROJECT_ID" --region "$REGION" --member "serviceAccount:$TICK_SA" --role roles/run.invoker
# the schedule: 05:00 India time every day; created, or updated when it exists
verb=create
if [ -n "$execute" ] && gcloud scheduler jobs describe "$SCHEDULE_JOB" --project "$PROJECT_ID" --location "$REGION" >/dev/null 2>&1; then verb=update; fi
run gcloud scheduler jobs "$verb" http "$SCHEDULE_JOB" --project "$PROJECT_ID" --location "$REGION" --schedule "0 5 * * *" --time-zone "Asia/Kolkata" \
  --uri "https://run.googleapis.com/v2/projects/$PROJECT_ID/locations/$REGION/jobs/$JOB:run" --http-method POST \
  --oauth-service-account-email "$TICK_SA"
[ -n "$execute" ] || echo "(dry run: nothing was run. Run without --dry-run to do it.)"
