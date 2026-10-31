#!/usr/bin/env bash
# Reads an osv-scanner JSON report (scan source --format json) and prints what the Security workflow needs.
#   osv-report.sh table  report.json   every advisory as a Markdown table (dev-only ones are marked), or a one-line "clean"
#   osv-report.sh block  report.json   one line per HIGH or CRITICAL advisory (CVSS 7.0 or more) in a package that is NOT dev-only; empty = nothing to block on
#   osv-report.sh count  report.json   the number of advisories (all of them)
# A package counts as dev-only when osv-scanner lists its dependency group as "dev" (a lock file's dev flag). Anything else, and anything with an unknown group, is treated as production.
set -euo pipefail
mode="${1:?mode}"; file="${2:?report.json}"
case "$mode" in
  table)
    n=$(jq '[.results[]?.packages[]?.groups[]?] | length' "$file")
    if [ "$n" = "0" ]; then echo "No known advisories in any dependency."; exit 0; fi
    echo "| Scope | Package | Advisory | CVSS |"
    echo "|---|---|---|---|"
    jq -r '.results[]? | .source.path as $s | .packages[]? | .package as $p | ((.dependency_groups // []) | if index("dev") then "dev only" else "production" end) as $scope | .groups[]? | "| \($scope) | \($p.name)@\($p.version) (\($s | sub("^/src/"; ""))) | \(.ids | join(", ")) | \(.max_severity // "?") |"' "$file"
    ;;
  block)
    jq -r '.results[]? | .source.path as $s | .packages[]? | select((.dependency_groups // []) | index("dev") | not) | .package as $p | .groups[]? | select(((.max_severity // "0") | tostring) as $m | ((($m | tonumber?) // 0) >= 7) or ($m | test("HIGH|CRITICAL"; "i"))) | "\($p.name)@\($p.version) (\($s | sub("^/src/"; ""))): \(.ids | join(", ")), CVSS \(.max_severity)"' "$file"
    ;;
  count)
    jq '[.results[]?.packages[]?.groups[]?] | length' "$file"
    ;;
  *) echo "unknown mode $mode" >&2; exit 2 ;;
esac
