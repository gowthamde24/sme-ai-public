#!/usr/bin/env bash
# `make ci-local`: run on THIS machine what CI runs for the lanes this change touches (owner rule 18 Nov 2026: CI must pass on the FIRST attempt, never "rerun and hope").
#
#   scripts/ci-local.sh [--base REF] [--only lane,lane] [--integration auto|full|skip] [--jobs N]
#
# What is run is decided by scripts/ci/lanes.sh, THE same script the workflow's `changes` job calls (so the rules cannot drift), on the files that differ from the merge base with origin/main.
# Lanes (the same commands as .github/workflows/ci.yml; the version of every tool is the repo's own: .nvmrc, pyproject, the Supabase CLI from PATH):
#   hygiene       scripts/check-no-leftovers.sh, scripts/test-lanes.py, make test-packages                       (always)
#   api-static    ruff check . + mypy                                                                            (unit lane)
#   api-tests     ALL unit test files: pytest -n (not serial), then the serial ones, as the four CI parts do      (unit lane)
#   web-static    eslint, typecheck, the contracts tsc, next build, audit:route-js (the route-JS ceilings)       (web tests lane)
#   web-tests     vitest run                                                                                     (web tests lane)
#   db-pgtap      supabase test db on the agent stack, rebuilt from THIS worktree's migrations                    (pgtap lane)
#   db-integration  the integration tests on that stack                                                           (integration lane; see --integration)
#   visual        NOT run here: its pictures are Linux baselines (CI only); the lane that runs it is printed
# Lanes that touch no file of the change are skipped and the summary says so. The light static lanes run together, the heavy ones (API tests, web tests, database) one after another, each with the whole machine: overlapping them only makes tests time out.
# When EVERY lane passes, the TREE hash is stamped in <git common dir>/ci-local/passed/<tree>; scripts/hooks/pre-push (opt-in: `make ci-hooks`) refuses a push of a tree that has no stamp.
# The working tree must be clean (a stamp is for a commit, not for what is on disk). Logs: <git dir of this worktree>/ci-local/logs/<lane>.log
#
# --integration auto (default): the integration lane runs when supabase/, tests/integration/, the local-stack scripts, the CI files or services/ai-api/pyproject.toml changed, which are the
# changes the unit lane cannot see; for an API-only change CI's integration shards run the same files as the unit lane plus the real database, and `--integration full` runs them here too (about 15+ min).
set -uo pipefail

ROOT=$(git rev-parse --show-toplevel)
cd "$ROOT" || exit 1
BASE_REF=origin/main
ONLY=""
INTEGRATION=auto
JOBS=$(sysctl -n hw.ncpu 2>/dev/null || nproc 2>/dev/null || echo 4)
while [ $# -gt 0 ]; do
  case "$1" in
    --base) BASE_REF=$2; shift 2 ;;
    --only) ONLY=$2; shift 2 ;;
    --integration) INTEGRATION=$2; shift 2 ;;
    --jobs) JOBS=$2; shift 2 ;;
    -h|--help) sed -n 2,28p "$0"; exit 0 ;;
    *) echo "ci-local: unknown option $1"; exit 2 ;;
  esac
done

if [ -n "$(git status --porcelain --untracked-files=no)" ]; then
  echo "ci-local: the working tree has uncommitted changes: commit (or stash) first; a pass is stamped for a commit, not for what is on disk"; exit 2
fi
git fetch -q origin main 2>/dev/null || echo "ci-local: could not fetch origin/main (offline?): using what is here"
BASE=$(git merge-base HEAD "$BASE_REF" 2>/dev/null || true)
if [ -z "$BASE" ]; then echo "ci-local: no merge base with $BASE_REF: running every lane"; FILES="$(git ls-files)"; else FILES=$(git diff --name-only --no-renames "$BASE" HEAD); fi
TREE=$(git rev-parse 'HEAD^{tree}')
eval "$(printf '%s\n' "$FILES" | scripts/ci/lanes.sh)"   # unit integration pgtap web webtests

# which python / node tools: the worktree's own venv, SME_VENV, or the shared one; the pre-push hook looks in the same places
PYBIN=""
for cand in "${SME_VENV:-}" "$ROOT/services/ai-api/.venv" "$ROOT/../sme-ai-public/services/ai-api/.venv" "$ROOT/../venv313"; do
  if [ -n "$cand" ] && [ -x "$cand/bin/pytest" ] && [ -x "$cand/bin/ruff" ]; then PYBIN="$cand/bin"; break; fi
done
PYJOBS=$(( JOBS > 4 ? JOBS - 2 : JOBS ))   # leave room for the web lanes and the database container
STATE="$(git rev-parse --git-common-dir)/ci-local"
LOGS="$(git rev-parse --git-dir)/ci-local/logs"; mkdir -p "$LOGS" "$STATE/passed"   # logs per worktree, stamps (by tree) shared; rm -f "$LOGS"/*.log "$LOGS"/*.rc

declare -a LANES=()
want() { [ -z "$ONLY" ] || printf ',%s,' "$ONLY" | grep -q ",$1,"; }
add() { want "$1" && LANES+=("$1"); }
add hygiene
[ "$unit" = true ] && add api-static
[ "$unit" = true ] && add api-tests
[ "$webtests" = true ] && add web-static
[ "$webtests" = true ] && add web-tests
db_ok=false
case "$INTEGRATION" in full) integ=true ;; skip) integ=false ;; *) integ=$(printf '%s\n' "$FILES" | grep -qE '^(supabase/|tests/integration/|scripts/with-local-supabase-env.sh|scripts/sb|\.github/|scripts/ci/|services/ai-api/pyproject.toml)' && echo true || echo false) ;; esac
[ "$integration" = true ] || integ=false
[ "$pgtap" = true ] && add db-pgtap
[ "$integ" = true ] && add db-integration

need_py() { [ -n "$PYBIN" ] || { echo "no Python environment with pytest and ruff (make install, or set SME_VENV)"; return 1; }; }
need_web() {
  [ -d apps/web/node_modules ] || { echo "apps/web/node_modules is missing (cd apps/web && npm ci)"; return 1; }
  # next build refuses a node_modules that is a link to somewhere outside this worktree (it cannot find its own root): a real install is needed for the web lanes
  [ ! -L apps/web/node_modules ] || { echo "apps/web/node_modules is a symlink: next build cannot run. Fix once per worktree: rm apps/web/node_modules && (cd apps/web && npm ci)"; return 1; }
}

lane_hygiene() { ./scripts/check-no-leftovers.sh && python3 scripts/test-lanes.py && python3 scripts/test-packages.py; }
lane_api_static() { need_py && (cd services/ai-api && "$PYBIN/ruff" check . && PYTHONPATH=$PWD "$PYBIN/mypy"); }
lane_api_tests() {
  need_py || return 1
  cd services/ai-api || return 1
  files=($(python3 ../../scripts/ci/shard_tests.py 1 1))   # one part of one = every test file, exactly what the four CI parts add up to
  "$PYBIN/pytest" -q -n "$PYJOBS" -m "not serial" -p no:cacheprovider "${files[@]}" || return 1
  "$PYBIN/pytest" -q -p no:xdist -m serial -p no:cacheprovider "${files[@]}"; rc=$?
  [ "$rc" -eq 0 ] || [ "$rc" -eq 5 ]
}
lane_web_static() { need_web && (cd apps/web && npx eslint . --cache --cache-location .eslintcache && npm run -s typecheck && npx tsc --noEmit -p ../../packages/contracts/tsconfig.json && npm run -s build && npm run -s audit:route-js); }
lane_web_tests() { need_web && (cd apps/web && npx vitest run); }
db_reset() {   # the container sometimes misses its health check while the machine is busy: ONE more try (a real migration error fails both times)
  ./scripts/db-lock.sh make --no-print-directory agent-db-reset && return 0
  echo "ci-local: the database reset failed; trying once more"; sleep 20
  ./scripts/db-lock.sh make --no-print-directory agent-db-reset
}
lane_db_pgtap() { db_reset && ./scripts/db-lock.sh make --no-print-directory agent-db-test; }
lane_db_integration() {
  need_py || return 1
  db_reset || return 1
  (cd services/ai-api && files=($(python3 ../../scripts/ci/shard_integration.py 1 1)) && ../../scripts/db-lock.sh ../../scripts/with-local-supabase-env.sh "$PYBIN/pytest" -c pyproject.toml "${files[@]}" -q -p no:cacheprovider)
}

echo "ci-local: base $(printf '%.8s' "${BASE:-none}"), $(printf '%s\n' "$FILES" | grep -c . || true) changed files; lanes: unit=$unit integration=${integration} (${INTEGRATION} -> ${integ}) pgtap=$pgtap web=$web webtests=$webtests"
T0=$SECONDS
# ONE machine, not a fleet: the lanes that need every core (the API tests, the web tests, the database) run one after another; only the light static lanes run together. (A first version ran them all at
# once: the web tests then timed out at 20 s because the API tests had the cores. CI runs each lane on its own runner; here the same work needs the same CPU, so overlapping it only adds timeouts.)
runlane() { local l=$1; local fn=lane_${l//-/_}; ( set -o pipefail; $fn ) > "$LOGS/$l.log" 2>&1; echo $? > "$LOGS/$l.rc"; echo "ci-local: $l $([ "$(cat "$LOGS/$l.rc")" = 0 ] && echo ok || echo FAILED) ($((SECONDS - T0)) s)"; }
inwave() { case "$1" in hygiene|api-static|web-static) return 0 ;; *) return 1 ;; esac; }
for l in "${LANES[@]}"; do inwave "$l" && { runlane "$l" & }; done
wait
for l in api-tests web-tests db-pgtap db-integration; do
  for x in "${LANES[@]}"; do [ "$x" = "$l" ] && runlane "$l"; done
done

FAILED=()
printf '\n%-16s %s\n' "lane" "result"
for l in "${LANES[@]}"; do
  rc=$(cat "$LOGS/$l.rc" 2>/dev/null || echo 99)
  if [ "$rc" = 0 ]; then printf '%-16s ok\n' "$l"; else printf '%-16s FAILED (log: %s)\n' "$l" "$LOGS/$l.log"; FAILED+=("$l"); fi
done
[ "$unit" = true ] || echo "api-static / api-tests  skipped: no change can affect them"
[ "$webtests" = true ] || echo "web-static / web-tests  skipped: only docs, the API, the database or *.md changed"
[ "$pgtap" = true ] || echo "db-pgtap                skipped: nothing under supabase/ or the CI files changed"
[ "$integ" = true ] || echo "db-integration          not run here (${INTEGRATION}; CI runs its 7 shards if the lane says so: integration=$integration)"
[ "$web" = true ] && echo "visual                  NOT run here: Linux baselines, CI only (apps/web changed: CI will compare the pictures)"
echo "ci-local: $((SECONDS - T0)) s"
if [ ${#FAILED[@]} -gt 0 ]; then
  echo "ci-local: RED: ${FAILED[*]}. A red lane is a bug to fix now, never to rerun."
  for l in "${FAILED[@]}"; do echo "---- $l (last lines)"; tail -n 25 "$LOGS/$l.log"; done
  rm -f "$STATE/passed/$TREE"; exit 1
fi
if [ -n "$ONLY" ]; then echo "ci-local: green for --only $ONLY (no stamp: only a full run stamps)"; exit 0; fi
printf '%s\n' "$(date -u +%FT%TZ)" > "$STATE/passed/$TREE"
echo "ci-local: GREEN, stamped for tree ${TREE:0:12} (the pre-push hook lets this tree through)"
