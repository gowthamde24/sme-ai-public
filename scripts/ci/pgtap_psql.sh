#!/usr/bin/env bash
# The database's own tests (pgTAP) without `supabase test db`, for a machine where Docker cannot bind-mount the repository folder (this Mac's /Volumes disk): the SAME files in the SAME order are fed to
# psql inside the local database container. Run it under scripts/db-lock.sh (scripts/ci-local.sh does). It resets the agent stack first (every migration of THIS worktree), then runs every file;
# a "not ok", an error or a plan that did not match fails the run. CI runs the real `supabase test db`.
set -uo pipefail
cd "$(git rev-parse --show-toplevel)" || exit 1
reset() { make --no-print-directory agent-db-reset; }
if ! reset; then
  echo "pgtap: the database reset failed; trying once more"; sleep 20
  reset || exit 1
fi
. ./scripts/stack.sh
c="$SME_DB_CONTAINER"; bad=0; n=0
# what `supabase test db` sets up before the files: the pgTAP extension, and its functions on the search path
docker exec -i "$c" psql -U postgres -X -tA -c "create extension if not exists pgtap with schema extensions" >/dev/null 2>&1 || { echo "pgtap: could not create the pgTAP extension"; exit 1; }
for f in supabase/tests/database/*.sql; do
  n=$((n + 1))
  out=$(docker exec -i -e PGOPTIONS="-c search_path=public,extensions" "$c" psql -U postgres -X -tA < "$f" 2>&1)
  if printf '%s\n' "$out" | grep -qE '^not ok|^ERROR:|^# Looks like you (failed|planned)|^FATAL'; then
    bad=$((bad + 1)); echo "FAIL $f"; printf '%s\n' "$out" | grep -E '^not ok|^ERROR:|^# (Failed|Looks like|have|want)|^#   ' | head -8
  fi
done
echo "pgTAP: $n files, $bad failed"
[ "$bad" -eq 0 ]
