#!/usr/bin/env bash
# Budget alerts against a cost attack (job DT, security audit): three monthly budgets of INR 2,000, 5,000 and 10,000 on the project's billing account, each e-mailing at 50, 90 and 100 percent of its amount.
# THE OWNER RUNS THIS (it changes billing). Dry run by default: it prints what it would do.   deploy/budget-alerts.sh [--apply]
# A budget only ALERTS; it never stops spending. The hard stops are the Cloud Run max-instances and the per-provider daily caps in the API (docs/runbooks/hardening.md).
set -euo pipefail
PROJECT_ID="${PROJECT_ID:-project-2757c07e-37d2-4167-88f}"
APPLY=""; [ "${1:-}" = "--apply" ] && APPLY=1
BILLING="$(gcloud billing projects describe "$PROJECT_ID" --format='value(billingAccountName)' | sed 's#billingAccounts/##')"
[ -n "$BILLING" ] || { echo "no billing account is linked to $PROJECT_ID" >&2; exit 1; }
for amount in 2000 5000 10000; do
  name="stack19-monthly-INR-$amount"
  cmd=(gcloud billing budgets create --billing-account "$BILLING" --display-name "$name" --budget-amount "${amount}INR" --filter-projects "projects/$PROJECT_ID"
       --threshold-rule percent=0.5 --threshold-rule percent=0.9 --threshold-rule percent=1.0)
  if gcloud billing budgets list --billing-account "$BILLING" --format='value(displayName)' | grep -qx "$name"; then echo "exists: $name"; continue; fi
  printf '+'; printf ' %q' "${cmd[@]}"; printf '\n'
  [ -z "$APPLY" ] || "${cmd[@]}"
done
[ -n "$APPLY" ] || echo "(dry run: nothing was created. Run with --apply. Billing-account e-mail recipients get the alerts; add more in the console under Billing > Budgets.)"
