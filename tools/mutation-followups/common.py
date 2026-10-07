"""Shared pieces of the follow-up mutation tools (T010 part 2, commit 5; docs/checklist-notes/A.md). Standard library only.

A SQL mutant is the LATEST definition of ONE function with ONE text replacement (or ONE statement and its undo), applied to the LOCAL database, run against the pgTAP files, and restored. A source mutant
(Python, web) is ONE text replacement in ONE file, restored with `git checkout`. Every result is appended to `out/*.jsonl` (git-ignored), keyed by the mutant's description, so a run can resume and the
survivors can be re-run after the tests were strengthened. Only the local stack is ever touched: the database container is the one `supabase/config.toml` names."""

# ruff: noqa: E501, S608

from __future__ import annotations

import json
import re
import shutil
import subprocess
import tomllib
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[2]
HERE = Path(__file__).resolve().parent
OUT = HERE / "out"
MIGRATIONS = sorted((ROOT / "supabase" / "migrations").glob("2026*.sql"))
API = ROOT / "services" / "ai-api"
WEB = ROOT / "apps" / "web"
PGTAP_FILES = ["62_t010_part2_followups", "63_t010_part2_question_drafts", "64_t010_part2_erasure", "65_t010_part2_blocker_order", "66_t010_followup_due_candidates"]
DUE_FILES = ["66_t010_followup_due_candidates"]  # the due-candidates function is first run against its own file only (a survivor is then run against all)
QUESTION_FILES = ["63_t010_part2_question_drafts"]  # the question objects are first run against their own file only (a survivor is then run against all four)


def container() -> str:
    config = tomllib.loads((ROOT / "supabase" / "config.toml").read_text())
    return f"supabase_db_{config['project_id']}"


def _docker() -> str:
    docker = shutil.which("docker")
    if docker is None:
        raise SystemExit("docker is required: the local Supabase stack runs in it")
    return docker


def psql(sql: str) -> tuple[int, str]:
    """Run SQL on the local database as the operator; (exit code, the tail of the output)."""
    cmd = [_docker(), "exec", "-i", container(), "psql", "-U", "postgres", "-d", "postgres", "-X", "-q", "-v", "ON_ERROR_STOP=1"]
    r = subprocess.run(cmd, input=sql, capture_output=True, text=True, timeout=120, check=False)  # noqa: S603
    return r.returncode, (r.stdout + r.stderr)[-400:]


def query(sql: str) -> str:
    cmd = [_docker(), "exec", "-i", container(), "psql", "-U", "postgres", "-d", "postgres", "-X", "-q", "-At", "-c", sql]
    r = subprocess.run(cmd, capture_output=True, text=True, timeout=60, check=False)  # noqa: S603
    if r.returncode != 0:
        raise SystemExit(f"the local database did not answer: {r.stderr[-200:]}")
    return r.stdout.strip()


def pgtap(files: list[str] | None = None) -> tuple[bool, list[str]]:
    """pgTAP files (with the two helper files first). (passed, the first failing test names)."""
    d = "supabase/tests/database"
    args = ["supabase", "test", "db", f"{d}/00000_test_helpers.sql", f"{d}/00001_tenant_table_registry.sql", *[f"{d}/{f}.test.sql" for f in (files or PGTAP_FILES)]]
    r = subprocess.run(args, cwd=ROOT, capture_output=True, text=True, timeout=600, check=False)  # noqa: S603, S607
    out = r.stdout + r.stderr
    failed = re.findall(r"# Failed test \d+: \"([^\"]{0,90})", out)
    ok = "Result: PASS" in out and r.returncode == 0
    if not ok and not failed:  # a file that aborts (an error in the mutated function) is a loud failure too
        errors = [line for line in out.splitlines() if "ERROR" in line or "Dubious" in line][:2]
        failed = ["(file aborted) " + " | ".join(errors)[:120]]
    return ok, failed


def latest_definition(name: str) -> str:
    """The text of the LAST `create [or replace] function <name>(` of the migrations, up to the `$$;` that closes it."""
    found = ""
    for path in MIGRATIONS:
        text = path.read_text()
        for m in re.finditer(rf"create (?:or replace )?function {re.escape(name)}\(", text):
            start = text.index("as $$", m.start()) + 5
            found = text[m.start() : text.index("$$;", start) + 3]
    if not found:
        raise SystemExit(f"no definition of {name} in the migrations")
    return found


def as_replace(sql: str) -> str:
    return sql.replace("create function", "create or replace function", 1)


def run_function_mutant(fn: str, start: int, end: int, new: str, files: list[str] | None = None, *, extra: Any = None) -> dict[str, Any]:
    """Apply, test, restore. `extra` is an optional callable run while the mutant is live (the real-stack suites): (passed, failed names)."""
    original = latest_definition(fn)
    code, message = psql(as_replace(original[:start] + new + original[end:]))
    if code != 0:
        psql(as_replace(original))
        return {"status": "invalid", "why": message.strip()[-160:]}
    try:
        ok, failed = pgtap(files)
        if ok and extra is not None:
            ok, failed = extra()
    finally:
        restored, _ = psql(as_replace(original))
        if restored != 0:
            raise SystemExit("the original function could not be restored: run `make db-reset`")
    return {"status": "survived" if ok else "killed", "by": failed[:3]}


def run_statement_mutant(do_sql: str, undo_sql: str, files: list[str] | None = None) -> dict[str, Any]:
    code, message = psql(do_sql)
    if code != 0:
        psql(undo_sql)
        return {"status": "invalid", "why": message.strip()[-160:]}
    try:
        ok, failed = pgtap(files)
    finally:
        restored, _ = psql(undo_sql)
        if restored != 0:
            raise SystemExit("the statement could not be undone: run `make db-reset`")
    return {"status": "survived" if ok else "killed", "by": failed[:3]}


def append(name: str, row: dict[str, Any]) -> None:
    OUT.mkdir(exist_ok=True)
    with (OUT / name).open("a") as f:
        f.write(json.dumps(row) + "\n")


def load(name: str) -> list[dict[str, Any]]:
    path = OUT / name
    return [json.loads(line) for line in path.read_text().splitlines()] if path.exists() else []


def latest_by_key(rows: list[dict[str, Any]]) -> dict[str, dict[str, Any]]:
    """The last result of every mutant (a re-run replaces the earlier answer)."""
    return {row["key"]: row for row in rows}
