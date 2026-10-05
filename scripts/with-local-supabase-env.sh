#!/usr/bin/env sh
# Run a command with SUPABASE_URL and the public key taken from the running local Supabase stack.
# Only the public URL and the two PUBLIC keys are exported: SUPABASE_PUBLISHABLE_KEY (the key the
# code uses) and the legacy SUPABASE_ANON_KEY (kept so the legacy name stays tested). The secret and
# service-role keys are deliberately filtered out: nothing in this repository uses them.
set -eu
vars="$(supabase status -o env | grep -E '^(API_URL|ANON_KEY|PUBLISHABLE_KEY)=')"
eval "$vars"
export SUPABASE_URL="$API_URL"
export SUPABASE_ANON_KEY="$ANON_KEY"
export SUPABASE_PUBLISHABLE_KEY="${PUBLISHABLE_KEY:-$ANON_KEY}"
unset API_URL ANON_KEY PUBLISHABLE_KEY
exec "$@"
