#!/usr/bin/env sh
# scripts/db-lock.sh <command...>: run a command that USES the local database one session at a time (docs/runbooks/two-local-stacks.md, "One session at a time").
# The local database of a stack is ONE shared thing: a pgTAP run or `db reset` rebuilds it, an integration test pins its clock, and the real-stack browser runs (make e2e-local, e2e-packs, e2e-new-owner) keep data in it for minutes. Two sessions at once break each other
# (a workspace "gone", a pinned clock, a reset under a running browser). So every such run takes this lock first and waits its turn.
#   - the lock is a folder: ${SME_DB_LOCK_DIR:-$HOME/.cache/sme-ai}/db-<stack>.lock (one per stack: the owner's demo stack is not held up by the agent stack), holding the PID of the holder
#   - waits up to SME_DB_LOCK_WAIT seconds (default 2700 = 45 minutes), looking every 15 seconds; a lock whose holder process is gone is stale and is taken over
#   - re-entrant: a command run inside the lock (SME_DB_LOCK_HELD=1) does not ask again, so `make check` and a script that calls `make` are fine
# It never kills anything. Used by: make agent-db-reset, agent-db-test, db-reset, db-test, test-integration, eval, and scripts/e2e-local.sh.
set -u
if [ "${SME_DB_LOCK_HELD:-}" = 1 ]; then exec "$@"; fi
here="$(cd "$(dirname "$0")" && pwd)"
. "$here/stack.sh"
dir="${SME_DB_LOCK_DIR:-$HOME/.cache/sme-ai}"
lock="$dir/db-$SME_STACK.lock"
wait_s="${SME_DB_LOCK_WAIT:-2700}"
mkdir -p "$dir"
waited=0
while ! mkdir "$lock" 2>/dev/null; do
  holder="$(cat "$lock/pid" 2>/dev/null || true)"
  if [ -n "$holder" ] && ! kill -0 "$holder" 2>/dev/null; then
    echo "db-lock: the holder ($holder) is gone; taking over a stale lock" >&2
    rm -rf "$lock"
    continue
  fi
  if [ "$waited" -ge "$wait_s" ]; then
    echo "db-lock: the $SME_STACK database has been in use by process ${holder:-?} for more than $wait_s seconds; not starting. Try again, or set SME_DB_LOCK_WAIT." >&2
    exit 75
  fi
  [ "$waited" -eq 0 ] && echo "db-lock: the $SME_STACK database is in use by process ${holder:-?}; waiting my turn (up to $wait_s s)" >&2
  sleep 15
  waited=$((waited + 15))
done
echo $$ >"$lock/pid"
release() { rm -rf "$lock"; }
trap 'release' EXIT
trap 'release; exit 130' INT
trap 'release; exit 143' TERM
SME_DB_LOCK_HELD=1 "$@"
