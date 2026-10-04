#!/usr/bin/env sh
# LOCAL DEVELOPMENT ONLY. Enables the selftest agent for ONE named workspace (default: the DEMO workspace) on the local
# Supabase stack, by calling app.operator_enable_selftest(slug) inside the local database container.
#
# Why this is a script and not part of `make seed-demo`'s API calls: the agent switches are operator-only (ADR 0013 decisions 2, 3, 9);
# no application role can write them, so the seed (which acts as the demo USER, with a user token) cannot flip them. This script
# acts as the local database owner, through `docker exec` into the local container: it cannot reach any other database, and it
# uses no key of any kind (no service-role key, no JWT secret).
#
# What it changes: both platform switches ON, the selftest agent allowed for exactly this workspace, this workspace's agents ON.
# It never opens an agent to every workspace. An unknown slug is an error.
set -eu

slug="${1:-demo-synthetic-sme}"
case "$slug" in
  *[!a-z0-9-]* | "") echo "dev-enable-selftest: the workspace slug may only contain a-z, 0-9 and '-'" >&2; exit 2 ;;
esac

project="$(sed -n 's/^project_id *= *"\(.*\)"/\1/p' supabase/config.toml | head -1)"
container="supabase_db_${project}"
if ! docker inspect "$container" >/dev/null 2>&1; then
  echo "dev-enable-selftest: the local database container '$container' is not running. Run \`make db-start\` first." >&2
  exit 1
fi

docker exec -i "$container" psql -U postgres -d postgres -X -q -v ON_ERROR_STOP=1 \
  -c "select app.operator_enable_selftest('$slug')" >/dev/null
echo "dev-enable-selftest: selftest agent enabled for workspace '$slug' (local stack only)"
