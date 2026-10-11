#!/usr/bin/env sh
# LOCAL DEVELOPMENT ONLY (job AT). Turns the GLOBAL outbox kill switch ON (or OFF with `off`) on the local Supabase stack, by calling app.operator_set_outbox(...) inside the local database
# container. The switch is operator-only (no application role can write it); this uses `docker exec` into the local container, so it cannot reach any other database and uses no key.
# While the switch is OFF (its default) every outgoing message is blocked ('switch_off') and nothing already queued is sent. The only channel adapter that exists is a local fake: nothing
# leaves this machine whatever the switch says.
set -eu

case "${1:-on}" in
  on) value=true ;;
  off) value=false ;;
  *) echo "dev-enable-outbox: say 'on' or 'off'" >&2; exit 2 ;;
esac

. "$(dirname "$0")/stack.sh"   # the agent stack by default (SME_STACK=owner for the owner's; docs/runbooks/two-local-stacks.md)
container="$SME_DB_CONTAINER"
if ! docker inspect "$container" >/dev/null 2>&1; then
  echo "dev-enable-outbox: the local database container '$container' is not running. Run \`make db-start\` first." >&2
  exit 1
fi
docker exec -i "$container" psql -U postgres -d postgres -X -q -v ON_ERROR_STOP=1 -c "select app.operator_set_outbox($value)" >/dev/null
echo "dev-enable-outbox: the outbox kill switch is now $1 (local stack only)"
