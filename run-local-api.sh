#!/bin/bash
# Run the Stack19 API on http://localhost:8000 against the STAGING database (uiallwgywitryxatcqxf). Secrets are read from Secret Manager into this process only (never written to a file).
# Needs: gcloud signed in with access to project-2757c07e-37d2-4167-88f, the venv at services/ai-api/.venv (or VENV=...). Stop it with Ctrl-C when not in use.
# Local-only switches below are ON here and nowhere else: SIGNUP_OPEN with the fake phone sender (the start answer returns the code), WHAT_YOU_SELL_LISTS, PRICING_V2.
set -euo pipefail
cd "$(dirname "$0")"
PROJECT=project-2757c07e-37d2-4167-88f
while IFS= read -r line; do   # the declared staging settings (plain values; bash 3.2 cannot `source <(...)`)
  case "$line" in ''|'#'*) ;; *=*) export "$line" ;; esac
done < deploy/settings/staging/api.env
set -a
while IFS= read -r line; do   # every secret the staging API declares (deploy/settings/staging/api.secrets), into this process only; one that cannot be read is skipped
  case "$line" in ''|'#'*) continue ;; esac
  name="${line%%=*}"; ref="${line#*=}"; ref="${ref%%:*}"
  value="$(gcloud secrets versions access latest --secret "$ref" --project "$PROJECT" 2>/dev/null)" && export "$name=$value"
done < deploy/settings/staging/api.secrets
API_ENV=development API_CORS_ORIGINS=http://localhost:3000
ADMIN_ENVIRONMENT=staging
SIGNUP_OPEN=true SIGNUP_PHONE_SENDER=fake SIGNUP_FAKE_CODE_ECHO=true
WHAT_YOU_SELL_LISTS=true PRICING_V2=true JOBS=on
set +a
cd services/ai-api
exec "${VENV:-.venv}/bin/uvicorn" app.main:app --no-server-header --port "${PORT:-8000}"
