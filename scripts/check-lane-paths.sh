#!/usr/bin/env bash
set -euo pipefail
if [[ $# -lt 1 || $# -gt 2 ]]; then
  echo 'Usage: scripts/check-lane-paths.sh <lane> [base] (default: main)' >&2
  exit 2
fi
root=$(git rev-parse --show-toplevel)
cd "$root"
python3 - "$1" "${2:-main}" <<'PY'
import json
import re
import subprocess
import sys
from pathlib import Path

lane, base = sys.argv[1:]
lane = {'a': 'A', 'b': 'B', 'c': 'C'}.get(lane, lane)
try:
    policy = json.loads(Path('lanes.json').read_text())['lanes'][lane]
except (KeyError, ValueError, OSError):
    sys.exit('Refusing: unknown lane or invalid lanes.json')

def matches(path, patterns):
    # Unlike fnmatch, literal Next.js [tenantId] directories stay literal.
    return any(re.fullmatch(re.escape(p).replace(r'\*', '.*').replace(r'\?', '.'), path, flags=re.DOTALL)
               for p in patterns)

# --no-renames reports both old and new paths; NUL delimiting handles unusual names.
try:
    result = subprocess.run(['git', 'diff', '--name-only', '--no-renames', '-z',
                             f'{base}...HEAD', '--'], check=True, capture_output=True)
except subprocess.CalledProcessError:
    sys.exit('Refusing: base cannot be resolved or has no merge base')
paths = result.stdout.decode('utf-8', errors='surrogateescape').split('\0')
bad = [p for p in paths if p and
       (not matches(p, policy['allow']) or matches(p, policy.get('deny', [])))]
if bad:
    for path in bad:
        print(f'Outside lane {lane}: {path!r}', file=sys.stderr)
    sys.exit(1)
print(f'Lane {lane}: changed paths allowed')
PY
