"""Run the Python or the web mutants (T010 part 2). From the repository root:

    python3 tools/mutation-followups/run_source.py py             # the API mutants against tests/test_followups_*.py (about 10 s each)
    python3 tools/mutation-followups/run_source.py web            # the screen mutants against the follow-up vitest files (about 10 s each)
    python3 tools/mutation-followups/run_source.py py --survivors # re-run the survivors after the tests were strengthened
    options: --list, --limit N

A mutant is ONE text replacement in ONE source file. The file must be clean in git before the mutant (the run refuses otherwise) and is restored with `git checkout`, never from memory. Results:
tools/mutation-followups/out/py.jsonl and web.jsonl (git-ignored)."""

# ruff: noqa: E501, S608

from __future__ import annotations

import os
import subprocess
import sys
import time
from typing import Any

from common import API, ROOT, WEB, append, latest_by_key, load
from py_mutants import P
from web_mutants import W

PY_TESTS = ["tests/test_followups_builder.py", "tests/test_followups_cadence_port.py", "tests/test_followups_repository.py", "tests/test_followups_routes.py", "tests/test_followups_gate_first.py", "tests/test_followups_web_pins.py"]  # fmt: skip
T = "app/app/tenants/[tenantId]"
WEB_TESTS = [f"{T}/followups", "lib/api/followup-text.test.ts", "lib/api/followups.test.ts", f"{T}/page.test.tsx", f"{T}/leads/[leadId]/page.test.tsx"]


def _git(*args: str) -> str:
    return subprocess.run(["git", *args], cwd=ROOT, capture_output=True, text=True, check=False).stdout  # noqa: S603, S607


def mutate(base: str, relative: str, old: str, new: str, nth: int, command: list[str], cwd: str) -> dict[str, Any]:
    pathspec = f":(literal){base}/{relative}"  # a literal pathspec: the web paths contain [brackets]
    if _git("status", "--porcelain", "--", pathspec).strip():
        raise SystemExit(f"{relative} is not clean in git: commit or stash first")
    full = ROOT / base / relative
    source = full.read_text()
    position = -1
    for _ in range(nth + 1):
        position = source.index(old, position + 1)  # a snippet that is gone is a loud error: the source moved, update the list
    full.write_text(source[:position] + new + source[position + len(old) :])
    try:
        r = subprocess.run(command, cwd=cwd, capture_output=True, text=True, timeout=900, env=dict(os.environ, PYTHONDONTWRITEBYTECODE="1"), check=False)  # noqa: S603
    finally:
        _git("checkout", "--", pathspec)
    if r.returncode == 0:
        return {"status": "survived", "by": []}
    out = r.stdout + r.stderr
    failed = [line.split(" - ")[0].replace("FAILED ", "")[:110] for line in out.splitlines() if line.startswith("FAILED")][:2] or [line.strip()[:110] for line in out.splitlines() if line.strip().startswith(("×", "FAIL"))][:2]
    return {"status": "killed", "by": failed}


def main(argv: list[str]) -> int:
    if not argv or argv[0] not in ("py", "web"):
        print(__doc__)
        return 2
    which = argv[0]
    items = P if which == "py" else W
    limit = int(argv[argv.index("--limit") + 1]) if "--limit" in argv else None
    if "--list" in argv:
        print(f"{len(items)} {which} mutants")
        return 0
    last = latest_by_key(load(f"{which}.jsonl"))
    todo = [(f, old, new, desc, nth) for f, old, new, desc, nth in items if (last.get(desc, {}).get("status") == "survived" if "--survivors" in argv else desc not in last)]
    for n, (f, old, new, desc, nth) in enumerate(todo[:limit], 1):
        began = time.time()
        if which == "py":
            r = mutate("services/ai-api", f, old, new, nth, [".venv/bin/pytest", "-q", "-p", "no:cacheprovider", "-x", "--no-header", *PY_TESTS], str(API))
        else:
            r = mutate("apps/web", f, old, new, nth, ["npx", "vitest", "run", "--bail", "1", *WEB_TESTS], str(WEB))
        r.update({"key": desc, "file": f.split("/")[-1], "desc": desc, "secs": round(time.time() - began, 1)})
        append(f"{which}.jsonl", r)
        print(f"{n}/{len(todo[:limit])} {r['status']:9s} {f.split('/')[-1]}: {desc}", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
