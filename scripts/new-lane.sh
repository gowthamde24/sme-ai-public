#!/usr/bin/env bash
# Owner-operated; local main is never fetched or modified.
set -euo pipefail
if [[ $# != 1 || ! $1 =~ ^[a-z][a-z0-9-]*$ ]]; then
  echo 'Usage: scripts/new-lane.sh <name> (lowercase letters, digits, hyphens)' >&2
  exit 2
fi
root=$(git rev-parse --show-toplevel)
cd "$root"
if [[ -n $(git status --porcelain --untracked-files=all) ]]; then
  echo 'Refusing: current worktree is dirty.' >&2
  exit 1
fi
name=$1
target="$(dirname "$root")/sme-ai-$name"
if [[ -e $target || -L $target ]]; then
  echo 'Refusing: destination already exists.' >&2
  exit 1
fi
git show-ref --verify --quiet refs/heads/main || { echo 'Refusing: local main is missing.' >&2; exit 1; }
git worktree add -b "lane/$name" "$target" refs/heads/main
printf 'Created %s on lane/%s from local main.\n' "$target" "$name"
printf '%s\n' 'One agent per worktree. Read AGENTS.md and docs/lanes.md; stay in your lane.' 'No secrets, deployment or pushes. B/C: no stack, reserved ports or make check.' 'A alone owns one local stack and reserved ports; make check once before each commit. Commit often.'
