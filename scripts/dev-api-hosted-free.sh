#!/usr/bin/env bash
# LOCAL DEVELOPMENT ONLY (job AN). Starts the local API with the Main agent on a hosted FREE-tier model (Groq by default), for synthetic data only.
#   scripts/dev-api-hosted-free.sh            (used by `make dev-api-groq`; see docs/runbooks/main-agent-hosted-free.md)
#
# What it does, in order. It stops at the first problem, before anything is changed or started:
#   1. checks the address is one of the three allowed hosted free-tier services and the model id is plain (the API refuses anything else too);
#   2. takes the API key from LLM_API_KEY if it is already in the environment, else READS IT HIDDEN from the terminal (nothing is echoed, written to a file or printed);
#   3. records the model's price in the LOCAL database at the minimum the database allows (1 micro per million tokens), so there is no manual SQL;
#      an existing price row for the model is left as it is;
#   4. switches the Main agent on for the demo workspace (the same operator function as docs/runbooks/main-agent-local.md);
#   5. starts the API with AGENTS_ENABLED=true on the local stack (scripts/with-local-demo-env.sh: it refuses a Supabase URL that is not this machine).
#
# It never reads a .env file, never uses a service-role key, never prints the key, and the key is sent only to the address checked in step 1 (the adapter enforces it again).
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
root="$(cd "$here/.." && pwd)"

base_url="${LLM_BASE_URL:-https://api.groq.com/openai/v1}"
model="${LLM_MODEL:-llama-3.3-70b-versatile}"
slug="${DEMO_SLUG:-demo-synthetic-sme}"
port="${API_PORT:-8000}"

case "$base_url" in
  https://api.groq.com/openai/v1 | https://api.cerebras.ai/v1 | https://openrouter.ai/api/v1) ;;
  *) echo "dev-api-hosted-free: LLM_BASE_URL must be exactly one of https://api.groq.com/openai/v1, https://api.cerebras.ai/v1, https://openrouter.ai/api/v1. Nothing was started." >&2; exit 2 ;;
esac
if ! printf '%s' "$model" | grep -Eq '^[A-Za-z0-9][A-Za-z0-9._:/-]{0,99}$'; then
  echo "dev-api-hosted-free: LLM_MODEL has characters a model id does not have. Nothing was started." >&2; exit 2
fi
case "$base_url" in
  https://openrouter.ai/*) case "$model" in *:free) ;; *) echo "dev-api-hosted-free: an OpenRouter model must be a free one (its id ends in :free). Nothing was started." >&2; exit 2 ;; esac ;;
esac
case "$slug" in
  *[!a-z0-9-]* | "") echo "dev-api-hosted-free: DEMO_SLUG may only contain a-z, 0-9 and '-'. Nothing was started." >&2; exit 2 ;;
esac
case "$port" in
  *[!0-9]* | "") echo "dev-api-hosted-free: API_PORT must be a number. Nothing was started." >&2; exit 2 ;;
esac

# the key: from the environment if it is there already, else typed hidden
key="${LLM_API_KEY:-}"
key="$(printf '%s' "$key" | tr -d '[:space:]')"
if [ -z "$key" ]; then
  if [ ! -t 0 ]; then
    echo "dev-api-hosted-free: LLM_API_KEY is not set and there is no terminal to type it in. Nothing was started." >&2; exit 2
  fi
  read -rsp "Paste the API key (hidden, it is not shown or saved): " key
  echo >&2
fi
key="$(printf '%s' "$key" | tr -d '[:space:]')"
if [ -z "$key" ]; then
  echo "dev-api-hosted-free: no key was given. Nothing was started." >&2; exit 2
fi

# the local database container (the same way scripts/dev-enable-selftest.sh finds it)
project="$(sed -n 's/^project_id *= *"\(.*\)"/\1/p' "$root/supabase/config.toml" | head -1)"
container="supabase_db_${project}"
if ! docker inspect "$container" >/dev/null 2>&1; then
  echo "dev-api-hosted-free: the local database container '$container' is not running. Run \`make db-start\` first. Nothing was started." >&2; exit 1
fi

# 3. the price: the minimum the table allows (a zero price is refused by it); kept if the model already has a row
docker exec -i "$container" psql -U postgres -d postgres -X -q -v ON_ERROR_STOP=1 \
  -c "insert into public.agent_model_prices (model, input_micros_per_mtok, output_micros_per_mtok) values ('$model', 1, 1) on conflict (model) do nothing" >/dev/null
echo "dev-api-hosted-free: price for '$model' recorded at the minimum (1 micro per million tokens; an existing row is kept)." >&2

# 4. the Main agent on for the demo workspace
if ! docker exec -i "$container" psql -U postgres -d postgres -X -q -v ON_ERROR_STOP=1 \
  -c "select app.operator_enable_assistant('$slug')" >/dev/null 2>&1; then
  echo "dev-api-hosted-free: the workspace '$slug' was not found in the local database, so the assistant was not switched on. Run \`make seed-demo\` (then this again). Nothing was started." >&2; exit 1
fi
echo "dev-api-hosted-free: the assistant is on for '$slug' (local stack only)." >&2

# 5. the API
export AGENTS_ENABLED=true API_ENV=development LLM_PROVIDER=openai_compat LLM_BASE_URL="$base_url" LLM_MODEL="$model" LLM_API_KEY="$key"
echo "dev-api-hosted-free: starting the API on port $port with $model (free tier; synthetic data only). Stop it with Ctrl-C." >&2
cd "$root/services/ai-api"
exec "$here/with-local-demo-env.sh" .venv/bin/uvicorn app.main:app --port "$port"
