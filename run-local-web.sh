#!/bin/bash
# Run the Stack19 WEB on http://localhost:3000 with EVERY new screen switched on, next to run-local-api.sh (which serves http://localhost:8000 against the STAGING database).
#   Terminal 1:  ./run-local-api.sh        Terminal 2:  ./run-local-web.sh        Then open http://localhost:3000
# Local only: nothing here is read by staging or production. Stop with Ctrl-C.
#
# What it does: starts from the staging web flags (deploy/staging-web-flags.env), then switches on what the owner wants to click. A part whose API is not ready or needs a paid provider runs in `mock` (fake data kept in a cookie
# of the browser; nothing is sent, bought or rung). The list of what is on, and what to click, is in reports/local-run.md.
#   WEB_MODE=api   ./run-local-web.sh   : ask the local API for every part that has a route (default for lists, credits, webhooks, Lead sources); mock only where a provider is paid (numbers, business verification, lines).
#   WEB_MODE=mock  ./run-local-web.sh   : mock every part that can be mocked (works with no API running; the sign-in itself still needs the API).
#   PORT=3001 ./run-local-web.sh        : another port.   WEB_OVERRIDES="CREDITS_SCREENS=0 JOBS=0" ./run-local-web.sh : change single switches for this run.
#   SKIP_INSTALL=1 skips `npm ci` when node_modules is missing; BUILD=1 runs a production build and `next start` (faster pages, slower start) instead of `next dev`.
set -euo pipefail
cd "$(dirname "$0")"
ROOT="$PWD"
cd apps/web
[ -d node_modules ] || { [ "${SKIP_INSTALL:-0}" = 1 ] && echo "node_modules is missing" >&2 && exit 1; npm ci; }

# 1. the staging flags (plain KEY=VALUE lines; bash 3.2 cannot `source <(...)`)
while IFS= read -r line; do
  case "$line" in ''|'#'*) ;; *=*) export "$line" ;; esac
done < "$ROOT/deploy/staging-web-flags.env"

MODE="${WEB_MODE:-api}"
ON=1; [ "$MODE" = mock ] && ON=mock   # for a part that has a mock mode

# 2. where the web finds the API and the sign-in (the staging project's public key, from the Supabase CLI, as run-local-api.sh does)
export NEXT_PUBLIC_API_BASE_URL="http://localhost:${API_PORT:-8000}"
export NEXT_PUBLIC_SUPABASE_URL="https://uiallwgywitryxatcqxf.supabase.co"
if [ -z "${NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:-}" ]; then
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY="$(supabase projects api-keys --project-ref uiallwgywitryxatcqxf --agent no -o json | python3 -c 'import sys,json; print(next(k["api_key"] for k in json.load(sys.stdin) if k.get("type")=="publishable"))')"
  export NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
fi
export NEXT_PUBLIC_SITE_URL="http://localhost:${PORT:-3000}" NEXT_PUBLIC_SITE_LIVE=1 NEXT_PUBLIC_SIGNUP_OPEN=1
unset EARLY_ACCESS SITE_MODE   # early access hides billing, credits and top-ups; website mode hides the app

# 3. the screens, one line each
export JOBS=1 DESIGN_V6=1 APP_V4=1 TODAY_V5=1 PREVIEW_JOBS=1                           # Jobs, the new look; /app/preview picks a made-up business for full mock data
export WHAT_YOU_SELL_LISTS=1                                                              # What you sell: lists and type tiles (API: WHAT_YOU_SELL_LISTS, on in run-local-api.sh)
export CALLS_PANEL=1 BROWSER_VOICE=1 TEST_CALL_SCREENS=1 TEST_CALL_TONE=1                 # Calls: "Before you start calling", "Hear it yourself", "How calls are billed"
export PHONE_NUMBER_SCREENS=1 PHONE_PICKER=mock KYC_PER_CLIENT=mock PHONE_LINES_SCREENS=mock   # Phone numbers: picker, Verify your business, Calls at once (the providers are paid: made-up here)
export CREDITS_SCREENS=1 BILLING_V2=$ON BALANCE_SCREENS=1 RAZORPAY_CHECKOUT=1            # Credits and billing: Add credits, statement, invoices, low-balance, debt notice
export LEADS_SCREENS=1 OUTREACH_SCREENS=1 SOURCE_CARDS_SCREENS=1 SWEEP_SCREENS=mock       # Lead sources, guides, Lead Finder
export DEVELOPER_KEYS_SCREENS=1                                                           # Developers: keys, Webhooks and Activity tabs (API: DEVELOPER_API=test, WEBHOOKS_OUT=on, WORKSPACE_SECRETS=fake)
export TELL_SCREENS=$ON                                                                   # Jobs: "Tell your assistant what to do" (mock = a made-up reading, no model cost)
export CRM_PUSH_SCREENS=$ON                                                               # Connectors: CRM and sheet cards (API: CRM_PUSH=on) with the stores, team-chat, calendar and lead-form cards below them (API: COMMERCE, NOTIFY_OUT, CALENDAR_IN, LEAD_FORM_TEMPLATES)
export EXTRA_LINES=mock                                                                   # Phone numbers: "Add a line" (Rs 149 a month, the price first), the lines bought, cancel and keep; mock like "Calls at once" above
export STAFF_CONSOLE=mock                                                                 # the staff console at /staff (a sample; ?role=owner|support|finance)
export LEGAL_DRAFT_PAGES=1 INDUSTRY_PAGES=1 WAITLIST=mock                                 # public pages: pricing, help, status, use policy, refunds, Talk to us (the form is answered with a made-up reference)
export FIRST_RUN_TYPE=1 FIRST_DAY_OPEN=1 TODAY_OPEN=1 SETTINGS_OPEN=1 TEMPLATES_PLAIN=1 MY_ASSISTANT_OPEN=1 CALLS_OPEN=1 LEADS_OPEN=1 REPORTS_OPEN=1 FILTERS_OPEN=1   # the plain-field screens, as production has them

# 4. single changes for this run: WEB_OVERRIDES="NAME=value NAME=value"
for pair in ${WEB_OVERRIDES:-}; do export "$pair"; done

echo "Stack19 web on http://localhost:${PORT:-3000} (mode: $MODE; the API is expected on $NEXT_PUBLIC_API_BASE_URL: start ./run-local-api.sh in another terminal)"
if [ "${BUILD:-0}" = 1 ]; then
  npm run build && exec npx next start -p "${PORT:-3000}"
fi
exec npx next dev --webpack -p "${PORT:-3000}"
