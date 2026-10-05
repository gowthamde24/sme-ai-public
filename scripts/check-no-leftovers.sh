#!/usr/bin/env sh
# Fails when a TRACKED file looks like an editor / patch / `sed -i` leftover (runtime.py-E, x.orig, x.rej, x.bak, x~).
# macOS `sed -i` needs an explicit backup suffix: write `sed -i ''`, and never `sed -i -E` (that creates `<file>-E`).
# Usage: scripts/check-no-leftovers.sh [repo dir]   (default: the current directory)
set -eu
cd "${1:-.}"
found="$(git ls-files | grep -E '(-E|\.orig|\.rej|\.bak|~)$' || true)"
if [ -n "$found" ]; then
  echo "leftover files are tracked by git (remove them with git rm):" >&2
  echo "$found" >&2
  exit 1
fi
