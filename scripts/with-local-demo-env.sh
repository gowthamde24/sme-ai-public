#!/usr/bin/env sh
# Run a command (the API or the web dev server) against the LOCAL Supabase stack, with the names each app needs.
#   scripts/with-local-demo-env.sh <command> [args...]      (used by `make dev-api-local` and `make dev-web-local`)
# The values come from `supabase status` through scripts/with-local-supabase-env.sh (the same way the seed gets them): the local URL and
# the PUBLIC (publishable) key only. The secret and service-role keys are never read. Nothing is printed and nothing is written to a file.
# Refuses to run unless the Supabase URL is this machine.
set -eu
here="$(cd "$(dirname "$0")" && pwd)"
exec "$here/with-local-supabase-env.sh" sh -c '
set -eu
case "${SUPABASE_URL:-}" in
  http://127.0.0.1:*|http://localhost:*|http://\[::1\]:*) ;;
  *) echo "Refusing to start: the Supabase URL is not this machine (127.0.0.1 or localhost). The local demo runs only against a local stack." >&2; exit 2 ;;
esac
if [ -z "${SUPABASE_PUBLISHABLE_KEY:-}" ]; then
  echo "Cannot find the local Supabase public key. Run: make db-start" >&2; exit 2
fi
export NEXT_PUBLIC_SUPABASE_URL="$SUPABASE_URL"
export NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY="$SUPABASE_PUBLISHABLE_KEY"
export NEXT_PUBLIC_API_BASE_URL="${LOCAL_DEMO_API_URL:-http://localhost:8000}"
exec "$@"
' sh "$@"
