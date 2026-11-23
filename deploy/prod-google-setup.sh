#!/usr/bin/env bash
# The Google side of PRODUCTION in one script (runbook section 3): APIs, the Artifact Registry repository `sme`, the five service accounts, the build bucket, the grants and the budget alerts.
#   deploy/prod-google-setup.sh            DRY RUN: prints every command it would run and runs NOTHING (reads only: it checks the project, billing and what already exists)
#   deploy/prod-google-setup.sh --apply    runs them, one at a time, skipping what already exists (safe to run twice)
# It touches ONLY the production project below (every gcloud call names it with --project). It reads no secret and creates none: that is deploy/prod-secrets-prompt.sh.
# The owner runs it (it changes IAM and billing alerts); nothing here is ever run by an agent without his written "run it".
set -euo pipefail
cd "$(dirname "$0")/.."
PROJECT_ID="stack19-production"; PROJECT_NUMBER="488341211094"; REGION="asia-south1"
STAGING_PROJECT_ID="project-2757c07e-37d2-4167-88f"
APPLY=""; [ "${1:-}" = "--apply" ] && APPLY=1
[ "$PROJECT_ID" != "$STAGING_PROJECT_ID" ] || { echo "REFUSED: this is the STAGING project" >&2; exit 2; }
say() { printf '%s\n' "$*"; }
# run a command (or only print it in the dry run); `+` marks every command
act() { printf '+'; printf ' %q' "$@"; printf '\n'; if [ -n "$APPLY" ]; then "$@"; fi; }

say "production Google setup for $PROJECT_ID ($PROJECT_NUMBER), region $REGION: $([ -n "$APPLY" ] && echo APPLY || echo 'DRY RUN, nothing is changed')"
got="$(gcloud projects describe "$PROJECT_ID" --format='value(projectNumber)' 2>/dev/null || true)"
[ "$got" = "$PROJECT_NUMBER" ] || { echo "REFUSED: gcloud cannot read project $PROJECT_ID (or its number is not $PROJECT_NUMBER: got '${got:-nothing}'). Check: gcloud auth list" >&2; exit 2; }
billing="$(gcloud billing projects describe "$PROJECT_ID" --format='value(billingEnabled)' 2>/dev/null || true)"
[ "$billing" = "True" ] || { echo "REFUSED: billing is not enabled on $PROJECT_ID" >&2; exit 2; }

say "== 1. APIs"
act gcloud services enable run.googleapis.com artifactregistry.googleapis.com secretmanager.googleapis.com cloudbuild.googleapis.com cloudscheduler.googleapis.com \
  logging.googleapis.com monitoring.googleapis.com iam.googleapis.com iamcredentials.googleapis.com billingbudgets.googleapis.com --project "$PROJECT_ID"

say "== 2. Artifact Registry repository sme"
if gcloud artifacts repositories describe sme --location "$REGION" --project "$PROJECT_ID" >/dev/null 2>&1; then say "exists: repository sme"
else act gcloud artifacts repositories create sme --repository-format=docker --location "$REGION" --description "Stack19 images" --project "$PROJECT_ID"; fi

say "== 3. the five service accounts (each does one job)"
create_sa() {   # name, display name
  if gcloud iam service-accounts describe "$1@$PROJECT_ID.iam.gserviceaccount.com" --project "$PROJECT_ID" >/dev/null 2>&1; then say "exists: $1"
  else act gcloud iam service-accounts create "$1" --display-name "$2" --project "$PROJECT_ID"; fi
}
create_sa sme-api-run "API service (reads its own secrets only)"
create_sa sme-web-run "Web service (no secrets)"
create_sa sme-worker-run "Worker job (reads its own secrets only)"
create_sa sme-tick "Cloud Scheduler: starts the worker job"
create_sa sme-build "Cloud Build: builds and pushes images"
SA() { printf '%s@%s.iam.gserviceaccount.com' "$1" "$PROJECT_ID"; }

say "== 4. grants (least privilege: the build account writes images and logs; nobody gets a project-wide role beyond that)"
act gcloud projects add-iam-policy-binding "$PROJECT_ID" --member "serviceAccount:$(SA sme-build)" --role roles/logging.logWriter --condition=None --quiet
act gcloud artifacts repositories add-iam-policy-binding sme --location "$REGION" --member "serviceAccount:$(SA sme-build)" --role roles/artifactregistry.writer --project "$PROJECT_ID" --quiet
bucket="${PROJECT_ID}_cloudbuild"
if gcloud storage buckets describe "gs://$bucket" --project "$PROJECT_ID" >/dev/null 2>&1; then say "exists: bucket $bucket"
else act gcloud storage buckets create "gs://$bucket" --location "$REGION" --project "$PROJECT_ID" --uniform-bucket-level-access; fi
act gcloud storage buckets add-iam-policy-binding "gs://$bucket" --member "serviceAccount:$(SA sme-build)" --role roles/storage.objectViewer --quiet
say "(the worker job's invoker grant for sme-tick is made by deploy/production.sh when the job exists; the secrets' grants are made by deploy/prod-secrets-prompt.sh)"

say "== 5. budget alerts (alerts only: a budget never stops spending; the hard stops are max-instances and the providers' caps)"
act env PROJECT_ID="$PROJECT_ID" ./deploy/budget-alerts.sh $([ -n "$APPLY" ] && echo --apply)

say "done: $([ -n "$APPLY" ] && echo 'applied' || echo 'dry run only. Read the + lines, then run again with --apply')"
