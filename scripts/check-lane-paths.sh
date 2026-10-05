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
import os
import re
import subprocess
import sys

lane, base = sys.argv[1:]
lane = {'a': 'A', 'b': 'B', 'c': 'C'}.get(lane, lane)

def git(*args):
    return subprocess.run(['git', *args], check=True, capture_output=True).stdout

try:
    ancestor = git('merge-base', base, 'HEAD').decode().strip()
except subprocess.CalledProcessError:
    sys.exit('Refusing: base cannot be resolved or has no merge base')
# CI uses its target BASE commit; local checks use the merge-base.
policy_commit = base if os.environ.get('LANE_POLICY_FROM_BASE') == '1' else ancestor
try:
    policy = json.loads(git('show', f'{policy_commit}:lanes.json'))['lanes'][lane]
except (subprocess.CalledProcessError, KeyError, ValueError):
    sys.exit('Refusing: unknown lane or no valid base policy; owner must bootstrap locally')

def matches(path, patterns):
    # Next.js [tenantId] is literal; * spans slashes and unusual filename characters.
    return any(re.fullmatch(re.escape(p).replace(r'\*', '.*').replace(r'\?', '.'),
                           path, flags=re.DOTALL) for p in patterns)

# No rename detection: both source deletion and destination creation are checked.
raw = git('diff', '--raw', '--no-renames', '--no-abbrev', '-z', ancestor, 'HEAD', '--')
records = raw.split(b'\0')
bad = []
for index in range(0, len(records) - 1, 2):
    fields = records[index].decode('ascii').split()
    old_mode, new_mode = fields[0][1:], fields[1]
    path = records[index + 1].decode('utf-8', errors='surrogateescape')
    if not matches(path, policy['allow']) or matches(path, policy.get('deny', [])):
        bad.append(f'Outside lane {lane}: {path!r}')
    if lane in ('B', 'C'):
        parts = path.split('/')
        if any(p in ('.gitmodules', '.gitattributes', '.githooks', '.husky') for p in parts):
            bad.append(f'Forbidden Git control path: {path!r}')
        if '120000' in (old_mode, new_mode) or '160000' in (old_mode, new_mode):
            bad.append(f'Symlink or submodule refused: {path!r}')
        elif old_mode != '000000' and new_mode != '000000' and old_mode != new_mode:
            bad.append(f'File-mode change refused: {path!r}')
        elif old_mode == '000000' and new_mode == '100755':
            bad.append(f'New executable refused: {path!r}')
if bad:
    print('\n'.join(bad), file=sys.stderr)
    sys.exit(1)
print(f'Lane {lane}: changed paths allowed under base policy')
PY
