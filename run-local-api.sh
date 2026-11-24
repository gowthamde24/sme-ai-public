#!/bin/bash
# Run the Stack19 API on http://localhost:8000 against the STAGING database (uiallwgywitryxatcqxf). Secrets are read from Secret Manager into this process only (never written to a file).
# Needs: gcloud signed in with access to project-2757c07e-37d2-4167-88f, the venv at services/ai-api/.venv (or VENV=...). Stop it with Ctrl-C when not in use.
# Local-only switches below are ON here and nowhere else: SIGNUP_OPEN with the fake phone sender (the start answer returns the code), WHAT_YOU_SELL_LISTS, PRICING_V2.
set -euo pipefail
cd "$(dirname "$0")"
PROJECT=project-2757c07e-37d2-4167-88f
set -a
# shellcheck disable=SC1091
. <(grep -v '^\s*#' deploy/settings/staging/api.env | grep '=')
for pair in SCHEDULER_PASSWORD=sme-scheduler-password SUPPRESSION_HMAC_KEY=sme-suppression-hmac-key CHANNEL_AGENT_PASSWORD=sme-channel-agent-password ANTHROPIC_API_KEY=sme-anthropic-api-key; do
  export "${pair%%=*}=$(gcloud secrets versions access latest --secret "${pair#*=}" --project "$PROJECT")"
done
API_CORS_ORIGINS=http://localhost:3000
ADMIN_ENVIRONMENT=staging
SIGNUP_OPEN=true SIGNUP_PHONE_SENDER=fake SIGNUP_FAKE_CODE_ECHO=true
WHAT_YOU_SELL_LISTS=true PRICING_V2=true
set +a
cd services/ai-api
exec "${VENV:-.venv}/bin/uvicorn" app.main:app --no-server-header --port "${PORT:-8000}"
