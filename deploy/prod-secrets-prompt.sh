#!/usr/bin/env bash
# The PRODUCTION secrets, one hidden prompt each (runbook section 4). The value is typed (nothing shows), piped to Secret Manager on STDIN and forgotten: it is never printed, never in a file, never on a command line, never in a log.
#   deploy/prod-secrets-prompt.sh --check     lists each secret: exists / missing / who reads it. Asks nothing, changes nothing.
#   deploy/prod-secrets-prompt.sh             asks for every missing secret, in order; Enter on an optional one skips it; a secret that already exists is skipped (never overwritten); keys we can generate ourselves are generated.
# After each secret it grants it to ONLY the service accounts that read it. Production project only; refuses anything else. The owner runs it.
set -euo pipefail
cd "$(dirname "$0")/.."
PROJECT_ID="stack19-production"
CHECK=""; [ "${1:-}" = "--check" ] && CHECK=1
SA() { printf 'serviceAccount:%s@%s.iam.gserviceaccount.com' "$1" "$PROJECT_ID"; }
gcloud projects describe "$PROJECT_ID" >/dev/null 2>&1 || { echo "REFUSED: gcloud cannot read $PROJECT_ID" >&2; exit 2; }
if [ -z "$CHECK" ]; then
  for sa in sme-api-run sme-worker-run; do
    gcloud iam service-accounts describe "$sa@$PROJECT_ID.iam.gserviceaccount.com" --project "$PROJECT_ID" >/dev/null 2>&1 || { echo "REFUSED: the service account $sa does not exist yet: run deploy/prod-google-setup.sh --apply first" >&2; exit 2; }
  done
fi

# name | kind (prompt|generate) | required (req|opt) | readers (api,worker) | what it is (plain words, shown at the prompt)
SECRETS=(
  "sme-suppression-hmac-key|generate|req|api,worker|the key that makes do-not-call numbers unreadable (generated here, nobody ever sees it)"
  "sme-scheduler-password|prompt|req|api,worker|a NEW strong password for the scheduler account (the account address is PROD_SCHEDULER_EMAIL in deploy/.env.production; this script creates that account with it)"
  "sme-resend-api-key|prompt|req|api,worker|Resend: the production SENDING key"
  "sme-anthropic-api-key|prompt|req|api,worker|Anthropic (Claude) key for production"
  "sme-sarvam-api-key|prompt|req|api,worker|Sarvam key (Telugu/Hindi/Kannada speech)"
  "sme-cartesia-api-key|prompt|req|api|Cartesia key (voices)"
  "sme-exotel-stream-secret|generate|req|api|signs each call's media token (generated here)"
  "sme-telephony-sandbox-numbers|prompt|req|api|your OWN test phone numbers, comma separated, e.g. +919XXXXXXXXX (the only numbers calls may reach while telephony is in sandbox)"
  "sme-voicelink-ws-token|generate|req|api|the secret in the address of OUR VoiceLink WebSocket bot (generated here; the address you paste into VoiceLink's bot form is printed by deploy/voicelink-bot-url.sh production, on your terminal only)"
  "sme-voicelink-username|prompt|opt|api,worker|VoiceLink: the REGISTERED username of OUR reseller login (VoiceLink Profile page; NOT your display name; Enter to skip until you have it)"
  "sme-voicelink-password|prompt|opt|api,worker|VoiceLink: the password of that login (hidden; Enter to skip)"
  "sme-plivo-auth-id|prompt|opt|api|Plivo Auth ID (DROPPED 24 Nov: VoiceLink is the only provider; only if the Plivo code is ever revived') (after the top-up and the A2P e-mail; Enter to skip for now)"
  "sme-plivo-auth-token|prompt|opt|api|Plivo Auth Token (Enter to skip for now)"
  "sme-whatsapp-token|prompt|opt|api,worker|WhatsApp (Meta) system-user token of the PRODUCTION Meta app (Enter to skip for now)"
  "sme-whatsapp-app-secret|prompt|opt|api|WhatsApp (Meta) app secret of the production app (Enter to skip for now)"
  "sme-whatsapp-verify-token|generate|opt|api|the webhook verify token (generated here; you will paste it into Meta's webhook page once, we show it only on request)"
  "sme-telephony-shop-numbers|prompt|opt|api|the shop's own mobile number(s), comma separated (Enter to skip until the shop is chosen)"
)

grant() {   # secret, readers
  local s="$1" r
  IFS=',' read -ra who <<< "$2"
  for r in "${who[@]}"; do
    gcloud secrets add-iam-policy-binding "$s" --project "$PROJECT_ID" --member "$(SA "sme-$r-run")" --role roles/secretmanager.secretAccessor --quiet >/dev/null
  done
}

created=0; skipped=0; missing_required=0; SCHED_PW=""
REF="ijmsusgyilwskpjxfauu"; SCHEDULER_EMAIL="$(sed -n 's/^PROD_SCHEDULER_EMAIL=//p' deploy/.env.production 2>/dev/null | head -1 | tr -d '"\r ' || true)"   # the address lives in ONE place (the git-ignored deploy/.env.production), never in a source file
for row in "${SECRETS[@]}"; do
  IFS='|' read -r name kind req readers what <<< "$row"
  if gcloud secrets describe "$name" --project "$PROJECT_ID" >/dev/null 2>&1; then
    echo "exists   $name  (read by: $readers)"; skipped=$((skipped + 1)); continue
  fi
  if [ -n "$CHECK" ]; then
    echo "MISSING  $name  ($req, $kind, read by: $readers)"; [ "$req" = req ] && missing_required=$((missing_required + 1)); continue
  fi
  if [ "$kind" = generate ]; then
    if [ "$name" = sme-whatsapp-verify-token ] && [ "$req" = opt ]; then
      read -rp "$name: $what. Generate it now? [y/N] " yn; [ "$yn" = y ] || { echo "skipped  $name"; continue; }
    fi
    printf '%s' "$(openssl rand -hex 32)" | gcloud secrets create "$name" --project "$PROJECT_ID" --replication-policy=automatic --data-file=- >/dev/null
    grant "$name" "$readers"; echo "created  $name  (generated; read by: $readers)"; created=$((created + 1)); continue
  fi
  while :; do
    printf '\n%s\n  %s\n' "$name" "$what"
    IFS= read -rsp "  value (hidden; $([ "$req" = opt ] && echo 'Enter to skip' || echo 'required')): " V; echo
    if [ -z "$V" ]; then
      [ "$req" = opt ] && { echo "skipped  $name"; break; }
      echo "  this one is required: type it, or press Ctrl-C to stop (nothing half-created is left behind: re-run to continue)"; continue
    fi
    printf '%s' "$V" | gcloud secrets create "$name" --project "$PROJECT_ID" --replication-policy=automatic --data-file=- >/dev/null
    [ "$name" = sme-scheduler-password ] && SCHED_PW="$V"
    unset V
    grant "$name" "$readers"; echo "created  $name  (read by: $readers)"; created=$((created + 1)); break
  done
done
unset V 2>/dev/null || true

# the scheduler's sign-in account (planner decision 23 Nov: pre-confirmed, NO mailbox; the address is PROD_SCHEDULER_EMAIL): created with the password typed above, in this terminal, and registered as the scheduler in the database.
# Needs the main checkout (linked to PRODUCTION: deploy/db_target.sh production must pass) and the Supabase CLI login. Skipped (with the reason) when the password was not typed in this run: run with --scheduler-account to do it from the stored secret.
scheduler_account() {
  local pw="$1" key out
  [ -n "$SCHEDULER_EMAIL" ] || { echo "scheduler account: skipped (PROD_SCHEDULER_EMAIL is empty in deploy/.env.production: set it, then run again with --scheduler-account)"; return 0; }
  ./deploy/db_target.sh production >/dev/null || { echo "scheduler account: skipped (this checkout is not linked to production)"; return 0; }
  key="$(supabase projects api-keys --project-ref "$REF" --agent no -o json 2>/dev/null | python3 -c 'import sys,json; d,_=json.JSONDecoder().raw_decode(sys.stdin.read()); print(next((k["api_key"] for k in d if k.get("type") in ("secret", "service_role") or k.get("name") == "service_role"), ""))' || true)"
  [ -n "$key" ] || { echo "scheduler account: skipped (could not read the project's service key: run `supabase login`)"; return 0; }
  out="$(SCH_REF="$REF" SCH_KEY="$key" SCH_EMAIL="$SCHEDULER_EMAIL" SCH_PW="$pw" python3 deploy/prod_scheduler_account.py --env || true)"
  unset key
  echo "scheduler account $SCHEDULER_EMAIL: $out"
  [ "$out" = created ] || [ "$out" = exists ] || return 0
  supabase db query --linked "select app.operator_register_scheduler('$SCHEDULER_EMAIL')" >/dev/null 2>&1 && echo "scheduler registered in the database" || echo "scheduler registration FAILED: tell the operator (select app.operator_register_scheduler('$SCHEDULER_EMAIL');)"
}
if [ -z "$CHECK" ]; then
  if [ -n "$SCHED_PW" ]; then scheduler_account "$SCHED_PW"; unset SCHED_PW
  elif [ "${1:-}" = "--scheduler-account" ] || [ "${2:-}" = "--scheduler-account" ]; then
    scheduler_account "$(gcloud secrets versions access latest --secret sme-scheduler-password --project "$PROJECT_ID")"
  fi
fi
echo; echo "done: $created created, $skipped already existed$([ -n "$CHECK" ] && echo ", $missing_required required ones missing")"
