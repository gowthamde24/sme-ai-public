"""Run the SQL mutants (T010 part 2). From the repository root, with the local stack running (`make db-start`):

    python3 tools/mutation-followups/run_sql.py                # every mutant against pgTAP 62-65 (63 alone for the question objects, then all four when it survives); resumable
    python3 tools/mutation-followups/run_sql.py --survivors    # re-run the mutants that survived, after the tests were strengthened (a later answer replaces the earlier)
    python3 tools/mutation-followups/run_sql.py --realstack    # re-run the survivors against the REAL-STACK suites: the race tests (locks) and the equivalence + API tests (the request builder)
    python3 tools/mutation-followups/run_sql.py --list         # count the mutants without running anything
    options: --limit N (the first N), --only TEXT (only mutants whose key contains TEXT)

Each mutant re-creates ONE function (or runs ONE statement), runs the tests and restores the original; the pgTAP baseline is re-checked before the first mutant, every 40 mutants and at the end, and the run
stops if it fails. Results: tools/mutation-followups/out/sql.jsonl (git-ignored). If a run is killed half way, `make db-reset` returns the database to the migrations."""

# ruff: noqa: E501, S608

from __future__ import annotations

import subprocess
import sys
import time
from collections.abc import Callable

from common import (
    API,
    append,
    latest_by_key,
    load,
    pgtap,
    run_function_mutant,
    run_statement_mutant,
)
from sql_generate import all_mutants

RACES = ["../../tests/integration/test_followup_races.py"]
EQUIVALENCE = ["../../tests/integration/test_followup_equivalence.py", "../../tests/integration/test_followup_api.py"]
BUILDER = ("followup_build", "followup_state_hash", "followup_result_ok", "followup_blocker", "followup_policy_json", "followup_request_hash")


def integration(files: list[str]) -> Callable[[], tuple[bool, list[str]]]:
    def run() -> tuple[bool, list[str]]:
        cmd = ["../../scripts/with-local-supabase-env.sh", ".venv/bin/pytest", "-c", "pyproject.toml", *files, "-q", "-x", "-p", "no:cacheprovider", "--no-header"]
        r = subprocess.run(cmd, cwd=API, capture_output=True, text=True, timeout=1500, check=False)  # noqa: S603
        out = r.stdout + r.stderr
        return r.returncode == 0, [line.split(" - ")[0].replace("FAILED ", "")[:100] for line in out.splitlines() if line.startswith("FAILED")][:2]

    return run


def suites_for(m: dict) -> list[str] | None:
    if "lock" in m["desc"] or "for update" in m["desc"]:
        return RACES
    if m["fn"].split(".")[-1].startswith(BUILDER):
        return EQUIVALENCE
    return None


def execute(m: dict, *, realstack: bool) -> dict:
    extra = None
    if realstack:
        files = suites_for(m)
        if files is None:
            return {"status": "not applicable", "by": []}
        extra = integration(files)
    if m["kind"] == "fn":
        r = run_function_mutant(m["fn"], m["start"], m["end"], m["new"], m["files"], extra=extra)
        if r["status"] == "survived" and m["files"]:  # a question object: the catalog tests of file 62 also assert facts about it
            r = run_function_mutant(m["fn"], m["start"], m["end"], m["new"], None, extra=extra)
        return r
    r = run_statement_mutant(m["do"], m["undo"], m["files"])
    if r["status"] == "survived" and m["files"]:
        r = run_statement_mutant(m["do"], m["undo"], None)
    return r


def main(argv: list[str]) -> int:
    limit = int(argv[argv.index("--limit") + 1]) if "--limit" in argv else None
    only = argv[argv.index("--only") + 1] if "--only" in argv else None
    mutants = all_mutants()
    if only:
        mutants = [m for m in mutants if only in m["key"]]
    if "--list" in argv:
        print(f"{len(mutants)} SQL mutants")
        return 0
    last = latest_by_key(load("sql.jsonl"))
    if "--survivors" in argv or "--realstack" in argv:
        mutants = [m for m in mutants if last.get(m["key"], {}).get("status") in ("survived", "invalid")]
    else:
        mutants = [m for m in mutants if m["key"] not in last]
    if limit:
        mutants = mutants[:limit]
    ok, failed = pgtap()
    if not ok:
        print("the baseline fails before any mutant:", failed)
        return 2
    print(f"{len(mutants)} mutants to run", flush=True)
    for n, m in enumerate(mutants, 1):
        began = time.time()
        r = execute(m, realstack="--realstack" in argv)
        r.update({"key": m["key"], "desc": m["desc"], "secs": round(time.time() - began, 1), "mode": "realstack" if "--realstack" in argv else "pgtap"})
        append("sql.jsonl", r)
        print(f"{n}/{len(mutants)} {r['status']:9s} {m['key'][:100]}", flush=True)
        if n % 40 == 0 and not pgtap()[0]:
            print("the baseline fails after", n, "mutants: stop and run `make db-reset`")
            return 2
    ok, failed = pgtap()
    print("baseline after the run:", "ok" if ok else failed)
    return 0 if ok else 2


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
