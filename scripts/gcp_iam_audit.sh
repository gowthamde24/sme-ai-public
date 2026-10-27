#!/usr/bin/env bash
# READ-ONLY audit of who can do what in the Google Cloud project (job DT, security audit): every service account with its project roles, user-managed keys (there should be none), what each Cloud Run service
# and job runs as, whether it is public, and which secrets each runtime account can read. Prints no secret value. Needs `gcloud auth login` as someone who can read IAM.
set -euo pipefail
P="${PROJECT_ID:-project-2757c07e-37d2-4167-88f}"; R="${REGION:-asia-south1}"
echo "== service accounts and user-managed keys"
for sa in $(gcloud iam service-accounts list --project "$P" --format='value(email)'); do
  echo "$sa  keys=$(gcloud iam service-accounts keys list --iam-account "$sa" --managed-by=user --format='value(name)' | wc -l | tr -d ' ')"
done
echo "== project roles (people and our own accounts)"
gcloud projects get-iam-policy "$P" --format=json | python3 -c '
import sys, json
by = {}
for b in json.load(sys.stdin)["bindings"]:
    for m in b["members"]:
        by.setdefault(m, []).append(b["role"])
for m, r in sorted(by.items()):
    if m.startswith("user:") or "/sme-" in m or "@" + "project" in m or "sme-" in m or "compute@developer" in m:
        print(m, r)'
echo "== Cloud Run services: runs as, ingress, who may invoke, max instances"
for s in $(gcloud run services list --project "$P" --region "$R" --format='value(metadata.name)'); do
  echo "$s: $(gcloud run services describe "$s" --project "$P" --region "$R" --format='value(spec.template.spec.serviceAccountName,metadata.annotations."run.googleapis.com/ingress",spec.template.metadata.annotations."autoscaling.knative.dev/maxScale")') invokers=$(gcloud run services get-iam-policy "$s" --project "$P" --region "$R" --format='value(bindings.members)')"
done
echo "== Cloud Run jobs: runs as"
for j in $(gcloud run jobs list --project "$P" --region "$R" --format='value(metadata.name)'); do
  echo "$j: $(gcloud run jobs describe "$j" --project "$P" --region "$R" --format='value(spec.template.spec.template.spec.serviceAccountName)')"
done
echo "== secrets: who can read each (a member listed on the SECRET, not the project)"
for s in $(gcloud secrets list --project "$P" --format='value(name)'); do
  echo "$s: $(gcloud secrets get-iam-policy "$s" --project "$P" --format='value(bindings.members)' | tr ';' ' ')"
done
