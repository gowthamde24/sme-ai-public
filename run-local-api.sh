#!/bin/bash
# Run the Stack19 API on http://localhost:8000 against the STAGING database (uiallwgywitryxatcqxf). Secrets are read from Secret Manager into this process only (never written to a file).
# Needs: gcloud signed in with access to project-2757c07e-37d2-4167-88f, the venv at services/ai-api/.venv (or VENV=...). Stop it with Ctrl-C when not in use.
# Every switch below is ON here and nowhere else; every provider that could send or buy something is a fake (see the block). HOW-TO-RUN-C1.md says what is fake.
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
# ---- every API switch ON, locally only ------------------------------------------------------------
SIGNUP_OPEN=true SIGNUP_PHONE_SENDER=fake SIGNUP_FAKE_CODE_ECHO=true     # the start answer returns the 6-digit code
WHAT_YOU_SELL_LISTS=true PRICING_V2=true JOBS=on JOBS_GET_PAID=on ADMIN_CONSOLE=true
CONTACT_FORM=true CAPTCHA_PROVIDER=none
BILLING_CHARGE_CALLS=true CALL_COORDINATION=true
WEBHOOKS_OUT=on CRM_PUSH=on INDIAMART_PULL=on WORKSPACE_SECRETS=fake DEVELOPER_API=test             # workspace keys live in memory; nothing reaches Secret Manager
PHONE_PICKER=true KYC_PER_CLIENT=true KYC_RETURN_URL=https://app.local.invalid/app/phone/kyc-return
# the fake VoiceLink (scripts/fake_voicelink.py, started below): no real client, number or purchase
VOICELINK_USERNAME=fake VOICELINK_PASSWORD=fake VOICELINK_API_BASE="http://127.0.0.1:${FAKE_VOICELINK_PORT:-8099}" PICKER_CLIENT_ID=1 PICKER_BOT_ID=1
# ---- nothing real is sent: the real send keys read from Secret Manager above are dropped; every provider is a fake ----
BILLING_EMAIL_SENDER=fake OUTBOX_ADAPTER=fake OUTREACH_DIALER=fake META_LEAD_PROVIDER=fake LEAD_FINDER_PLACES_MOCK=true
WEB_SEARCH_PROVIDER=fake PLACES_PROVIDER=fake METALS_PROVIDER=fake INDIAMART_PROVIDER=fake PAYMENTS_PROVIDER=fake CALLS_PROVIDER=fake LEAD_DND_PROVIDER=fake PHONE_NUMBERS_PROVIDER=fake GOOGLE_CALENDAR_FAKE=true
# connectors (fake IndiaMART, payment links, calls) are bound to ONE workspace: the first declared staging work workspace, unless you name another
INTEGRATIONS_TENANT_ID="${INTEGRATIONS_TENANT_ID:-${ASSISTANT_WORK_TENANTS%%;*}}"
# this machine is the public address of the API and the web: the fake Google Calendar sends the browser back to it, payment and call links point at it
PUBLIC_BASE_URL="http://localhost:${PORT:-8000}" PUBLIC_WEB_BASE_URL=http://localhost:3000
EXOTEL_WEBHOOK_TOKEN=local-fake-webhook-token-0123456789   # the fake call bridge still checks one (a made-up local value)
unset RESEND_API_KEY LEAD_RESEND_API_KEY LEAD_RESEND_WEBHOOK_SECRET WHATSAPP_ACCESS_TOKEN META_PAGE_TOKEN PLIVO_AUTH_ID PLIVO_AUTH_TOKEN EXOTEL_API_KEY EXOTEL_API_TOKEN EXOTEL_SID EXOTEL_STREAM_SECRET
# the Razorpay TEST keys (sourced above, if the owner's file exists) keep BILLING_PROVIDER=razorpay in TEST mode; without them it stays the fake
# LOCAL_ENV_OVERRIDES="PAGE_MAX_INFLIGHT=24 CALL_COORDINATION=false" ./run-local-api.sh : settings for this run only (applied last)
for pair in ${LOCAL_ENV_OVERRIDES:-}; do export "$pair"; done
set +a
ROOT="$PWD"
cd services/ai-api
PY="${VENV:-.venv}/bin/python"
FAKE_PID=""; PICKER_RESTORE=""
cleanup() {
  [ -n "$FAKE_PID" ] && kill "$FAKE_PID" 2>/dev/null || true
  if [ "$PICKER_RESTORE" = off ]; then   # put the staging switch back as it was
    ( cd "$ROOT" && supabase db query --linked "update ops.picker_settings set enabled = false" >/dev/null 2>&1 ) && echo "number picker switch on staging put back to off" || echo "COULD NOT put ops.picker_settings.enabled back to false: do it by hand"
  fi
}
trap cleanup EXIT INT TERM
if [ "${FAKE_VOICELINK:-1}" = 1 ]; then   # the fake VoiceLink dies with this script
  "$PY" ../../scripts/fake_voicelink.py "${FAKE_VOICELINK_PORT:-8099}" & FAKE_PID=$!
  # The number picker's platform switch lives in the STAGING database (ops.picker_settings.enabled, off). For this local run it is turned on so the picker can be clicked through, and put back to off when this script ends
  # (Ctrl-C included; a kill -9 leaves it on). The deployed staging API has PHONE_PICKER off and only the fake VoiceLink is reachable from here, so nothing real moves. OPEN_PICKER=0 leaves the switch alone.
  if [ "${OPEN_PICKER:-1}" = 1 ] && [ "$(cat "$ROOT/supabase/.temp/project-ref" 2>/dev/null)" = uiallwgywitryxatcqxf ]; then
    was="$(supabase db query --linked "select enabled from ops.picker_settings" 2>/dev/null || true)"
    case "$was" in   # (not a pipe into grep -q: pipefail would call that a failure)
      *'"enabled": false'*) supabase db query --linked "update ops.picker_settings set enabled = true" >/dev/null 2>&1 && { PICKER_RESTORE=off; echo "number picker switch on staging turned ON for this run (restored when this script ends)"; } ;;
      *'"enabled": true'*) echo "number picker switch on staging was already on: left as it is" ;;
    esac
  fi
fi
"${VENV:-.venv}/bin/uvicorn" app.main:app --no-server-header --port "${PORT:-8000}"
