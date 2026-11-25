#!/bin/bash
# Run the Stack19 API on http://localhost:8000 against the STAGING database (uiallwgywitryxatcqxf). Secrets are read from Secret Manager into this process only (never written to a file).
# Needs: gcloud signed in with access to project-2757c07e-37d2-4167-88f, the venv at services/ai-api/.venv (or VENV=...). Stop it with Ctrl-C when not in use.
# Local-only switches below are ON here and nowhere else: SIGNUP_OPEN with the fake phone sender (the start answer returns the code), WHAT_YOU_SELL_LISTS, PRICING_V2, WEBHOOKS_OUT, CONTACT_FORM. The web half is ./run-local-web.sh.
set -euo pipefail
cd "$(dirname "$0")"
PROJECT=project-2757c07e-37d2-4167-88f
while IFS= read -r line; do   # the declared staging settings (plain values; bash 3.2 cannot `source <(...)`)
  case "$line" in ''|'#'*) ;; *=*) export "$line" ;; esac
done < deploy/settings/staging/api.env
set -a
# the declared file says `@env:SUPABASE_PUBLISHABLE_KEY` (the deploy fills it in): the staging project's public key, from the Supabase CLI
SUPABASE_PUBLISHABLE_KEY="$(supabase projects api-keys --project-ref uiallwgywitryxatcqxf --agent no -o json | python3 -c 'import sys,json; print(next(k["api_key"] for k in json.load(sys.stdin) if k.get("type")=="publishable"))')"
while IFS= read -r line; do   # every secret the staging API declares (deploy/settings/staging/api.secrets), into this process only; one that cannot be read is skipped
  case "$line" in ''|'#'*) continue ;; esac
  name="${line%%=*}"; ref="${line#*=}"; ref="${ref%%:*}"
  value="$(gcloud secrets versions access latest --secret "$ref" --project "$PROJECT" 2>/dev/null)" && export "$name=$value"
done < deploy/settings/staging/api.secrets
# Razorpay TEST keys (no real money), if the owner's local file exists: local runs only, never copied into a repo
[ -f /Volumes/Stack19/stack19/.secrets-local/razorpay-test.env ] && . /Volumes/Stack19/stack19/.secrets-local/razorpay-test.env
API_ENV=development API_CORS_ORIGINS=http://localhost:3000
ADMIN_ENVIRONMENT=staging
SIGNUP_OPEN=true SIGNUP_PHONE_SENDER=fake SIGNUP_FAKE_CODE_ECHO=true
WHAT_YOU_SELL_LISTS=true PRICING_V2=true JOBS=on
WEBHOOKS_OUT=on WORKSPACE_SECRETS=fake CONTACT_FORM=true   # Developers > Webhooks (fake signing-secret store), the public Talk to us form (run-local-web.sh)
# LOCAL_ENV_OVERRIDES="PAGE_MAX_INFLIGHT=24 CALL_COORDINATION=true" ./run-local-api.sh : settings for this run only
for pair in ${LOCAL_ENV_OVERRIDES:-}; do export "$pair"; done
set +a
cd services/ai-api
exec "${VENV:-.venv}/bin/uvicorn" app.main:app --no-server-header --port "${PORT:-8000}"
