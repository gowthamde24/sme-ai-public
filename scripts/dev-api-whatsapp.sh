#!/usr/bin/env bash
# LOCAL DEVELOPMENT ONLY (job CD). Starts the local API with the REAL WhatsApp Cloud API adapter, for Meta's free TEST number (docs/runbooks/whatsapp-test-number.md). Synthetic data only; the fake stays the default
# everywhere else (OUTBOX_ADAPTER=fake): this script is the only place that turns the real adapter on, and only for the process it starts.
#   scripts/dev-api-whatsapp.sh            (used by `make dev-api-whatsapp`)
#
# It stops at the first problem, before anything is started:
#   1. READS THREE SECRETS HIDDEN (read -rs: nothing is echoed, written to a file, put in the process list or printed), unless the variable is already in the environment:
#        WHATSAPP_ACCESS_TOKEN   the temporary access token from Meta's API Setup page (about a day) or a System User token
#        WHATSAPP_APP_SECRET     App settings > Basic > App secret (Meta signs every webhook with it)
#        WHATSAPP_VERIFY_TOKEN   any long phrase you invent now; you type the same phrase into Meta's webhook page
#      and the phone number id (not a secret; shown) so that the token can be checked;
#   2. asks Meta's Graph API whether that token can see that number (one GET; the token goes to graph.facebook.com only, in a curl config on stdin, never on a command line) and refuses a token Meta refuses;
#   3. prepares the channel account in the LOCAL database (scripts/prepare_channel_agent.py);
#   4. starts the API on API_PORT (default 8000 = the owner's stack; any other port = the agents') with OUTBOX_ADAPTER=whatsapp.
# It never reads a .env file, never uses a service-role key and never prints a secret.
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
root="$(cd "$here/.." && pwd)"
port="${API_PORT:-8000}"
version="${WHATSAPP_GRAPH_VERSION:-v25.0}"
base="https://graph.facebook.com"

case "$port" in *[!0-9]* | "") echo "dev-api-whatsapp: API_PORT must be a number. Nothing was started." >&2; exit 2 ;; esac
case "$version" in v[0-9]*.[0-9]*) ;; *) echo "dev-api-whatsapp: WHATSAPP_GRAPH_VERSION must look like v25.0. Nothing was started." >&2; exit 2 ;; esac

ask_secret() { # name, prompt
  local name="$1" prompt="$2" value="${!1:-}"
  value="$(printf '%s' "$value" | tr -d '[:space:]')"
  if [ -z "$value" ]; then
    if [ ! -t 0 ]; then echo "dev-api-whatsapp: $name is not set and there is no terminal to type it in. Nothing was started." >&2; exit 2; fi
    read -rsp "$prompt (hidden, it is not shown or saved): " value
    echo >&2
    value="$(printf '%s' "$value" | tr -d '[:space:]')"
  fi
  if [ -z "$value" ]; then echo "dev-api-whatsapp: no $name was given. Nothing was started." >&2; exit 2; fi
  printf -v "$name" '%s' "$value"
}

ask_secret WHATSAPP_ACCESS_TOKEN "Paste the WhatsApp access token"
ask_secret WHATSAPP_APP_SECRET "Paste the app secret"
ask_secret WHATSAPP_VERIFY_TOKEN "Invent a verify phrase (letters, digits, - . _ ~; at least 12)"

# (the lengths are checked in the shell: macOS grep refuses a repeat count above 255)
if [ "${#WHATSAPP_ACCESS_TOKEN}" -lt 20 ] || [ "${#WHATSAPP_ACCESS_TOKEN}" -gt 600 ] || ! printf '%s' "$WHATSAPP_ACCESS_TOKEN" | grep -Eq '^[A-Za-z0-9._~+/=-]+$'; then
  echo "dev-api-whatsapp: that does not look like an access token (unexpected characters, or too short). Nothing was started." >&2; exit 2
fi
if [ "${#WHATSAPP_APP_SECRET}" -lt 16 ] || [ "${#WHATSAPP_APP_SECRET}" -gt 64 ] || ! printf '%s' "$WHATSAPP_APP_SECRET" | grep -Eq '^[A-Za-z0-9]+$'; then
  echo "dev-api-whatsapp: that does not look like an app secret (Meta's are 32 letters and digits). Nothing was started." >&2; exit 2
fi
if [ "${#WHATSAPP_VERIFY_TOKEN}" -lt 12 ] || [ "${#WHATSAPP_VERIFY_TOKEN}" -gt 100 ] || ! printf '%s' "$WHATSAPP_VERIFY_TOKEN" | grep -Eq '^[A-Za-z0-9._~-]+$'; then
  echo "dev-api-whatsapp: the verify phrase may only hold letters, digits, - . _ ~ and must be 12 to 100 long. Nothing was started." >&2; exit 2
fi

number_id="${WHATSAPP_PHONE_NUMBER_ID:-}"
if [ -z "$number_id" ]; then
  if [ ! -t 0 ]; then echo "dev-api-whatsapp: WHATSAPP_PHONE_NUMBER_ID is not set and there is no terminal. Nothing was started." >&2; exit 2; fi
  read -rp "Phone number ID (from Meta's API Setup page; not a secret): " number_id
fi
if [ "${#number_id}" -lt 5 ] || [ "${#number_id}" -gt 30 ] || ! printf '%s' "$number_id" | grep -Eq '^[0-9]+$'; then
  echo "dev-api-whatsapp: the phone number id is digits only. Nothing was started." >&2; exit 2
fi

# 2. does Meta know this token and this number?
status="$(printf 'header = "Authorization: Bearer %s"\n' "$WHATSAPP_ACCESS_TOKEN" | curl -sS --config - --max-time 20 -o /dev/null -w '%{http_code}' "$base/$version/$number_id?fields=id" 2>/dev/null || true)"
case "$status" in
  200) echo "dev-api-whatsapp: Meta accepts this token for that number." >&2 ;;
  400 | 401 | 403) echo "dev-api-whatsapp: Meta refuses this token for that number (HTTP $status): it may have expired (a temporary token lasts about a day), or the number id is not this app's. Nothing was started." >&2; exit 2 ;;
  *) echo "dev-api-whatsapp: could not check the token with Meta (HTTP ${status:-none}); going on, the first message will show if it is wrong." >&2 ;;
esac

# 3. the channel account, in the local database of the stack in use
if [ "$port" = 8000 ] && [ -z "${SME_STACK:-}" ]; then SME_STACK=owner; fi   # the default port is the owner's API (the Makefile's rule)
. "$root/scripts/stack.sh"   # SME_STACK, else the agent stack (docs/runbooks/two-local-stacks.md)
container="$SME_DB_CONTAINER"
if ! docker inspect "$container" >/dev/null 2>&1; then
  echo "dev-api-whatsapp: the local database container '$container' is not running. Run \`make db-start\` first. Nothing was started." >&2; exit 1
fi
cd "$root/services/ai-api"
"$here/with-local-supabase-env.sh" .venv/bin/python "$here/prepare_channel_agent.py"

# 4. the API
export OUTBOX_ADAPTER=whatsapp WHATSAPP_API_BASE="$base" WHATSAPP_GRAPH_VERSION="$version" WHATSAPP_ACCESS_TOKEN WHATSAPP_APP_SECRET WHATSAPP_VERIFY_TOKEN
export CHANNEL_AGENT_EMAIL="channel@system.example.test" CHANNEL_AGENT_PASSWORD="Channel-Only-Local-Password-1!"
echo "dev-api-whatsapp: starting the API on port $port with the REAL WhatsApp adapter (the test number; synthetic data only). Stop it with Ctrl-C." >&2
exec "$here/with-local-demo-env.sh" .venv/bin/uvicorn app.main:app --no-server-header --port "$port"
