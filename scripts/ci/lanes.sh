#!/usr/bin/env bash
# THE lane rules, in ONE place (owner rule 18 Nov 2026: CI must pass on the first attempt). Reads the changed file names on stdin (one per line) and prints
#   unit=… integration=… pgtap=… web=… webtests=…       (true or false, one per line)
# .github/workflows/ci.yml (job `changes`) and scripts/ci-local.sh both call this script, so what runs on your machine and what runs in CI cannot drift.
# Fail closed: a path on no list runs everything it could affect.
set -euo pipefail
files=$(cat)
# the visual job: the pictures can change only with the web app, the visual tests or the workflows that run them
web=false
while IFS= read -r f; do
  case "$f" in
    apps/web/*|e2e/visual/*|.github/workflows/ci.yml|.github/workflows/visual.yml) web=true; break ;;
  esac
done <<< "$files"
# the web's own tests (the fast lane, owner 6 Nov 2026): skipped ONLY when every changed file is under docs/, services/ai-api/, supabase/ or tests/, or is a *.md file (none of
# which the web is built from); anything else, including a path on no list, runs them (fail closed)
webtests=false
while IFS= read -r f; do
  [ -n "$f" ] || continue
  case "$f" in
    docs/*|services/ai-api/*|supabase/*|tests/*|*.md) ;;
    *) webtests=true; break ;;
  esac
done <<< "$files"
# THE TEST LANES (owner 12 Nov 2026: only what a change can affect; every lane runs on main and in the merge queue). `unit` = the API unit tests, `integration` = the integration tests against
# real local Supabase, `pgtap` = the database's own tests. Fail closed: a path on no list, or a change to the CI itself, runs everything. Docs run the unit lane (some unit tests read docs/ and
# deploy/), never the database lanes; only supabase/ runs pgTAP.
unit=false; integration=false; pgtap=false
while IFS= read -r f; do
  [ -n "$f" ] || continue
  case "$f" in
    .github/*|scripts/ci/*|services/ai-api/pyproject.toml) unit=true; integration=true; pgtap=true ;;
    supabase/*) unit=true; integration=true; pgtap=true ;;
    services/ai-api/*|packages/*) unit=true; integration=true ;;
    docs/runbooks/agents-kill-switch.md) unit=true; integration=true ;;
    tests/integration/*|scripts/with-local-supabase-env.sh|scripts/sb) integration=true ;;
    deploy/*|tools/*|tests/*|docs/*|scripts/*) unit=true ;;
    apps/web/*|e2e/*|*.md) ;;
    *) unit=true; integration=true; pgtap=true ;;
  esac
done <<< "$files"
echo "unit=$unit"
echo "integration=$integration"
echo "pgtap=$pgtap"
echo "web=$web"
echo "webtests=$webtests"
