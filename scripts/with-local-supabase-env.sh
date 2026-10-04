#!/usr/bin/env sh
# Run a command with SUPABASE_URL / SUPABASE_ANON_KEY taken from the running local Supabase stack.
# Only the public URL and anon key are exported. The service-role key is deliberately filtered out:
# nothing in this repository uses it.
set -eu
vars="$(supabase status -o env | grep -E '^(API_URL|ANON_KEY)=')"
eval "$vars"
export SUPABASE_URL="$API_URL"
export SUPABASE_ANON_KEY="$ANON_KEY"
unset API_URL ANON_KEY
exec "$@"
