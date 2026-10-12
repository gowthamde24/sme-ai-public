#!/usr/bin/env python3
"""Backup and restore drill (job CB, ADR 0082), the scripted form of docs/runbooks/backup-restore-drill.md.

  scripts/restore_drill.py --dry-run     (the default) The plan for a HOSTED drill: what it checks first and the exact commands, with the connection strings left as $SOURCE_DATABASE_URL and
                                         $TARGET_DATABASE_URL. It connects to nothing and changes nothing. If those two variables are set it also checks that they differ and that the target looks
                                         like a throwaway (its host or database name says drill or throwaway, or you pass --target-is-throwaway). Their values are never printed.
  scripts/restore_drill.py --local       A REAL drill on the AGENT stack's database container (never the owner's): dump the database, restore the dump into a scratch database next to it, compare the
                                         row count of every table, run supabase/hosted/verify.sql on both and compare, time each step (the restore time is the RTO), then drop the scratch database
                                         and the dump. Exit 0 only if the restore had no errors, every count matches and the verify output is identical. --report FILE writes the result as Markdown.

No credential is read from a file, printed or logged. The drill never touches the source except to read it."""

from __future__ import annotations

import os
import re
import shlex
import subprocess
import sys
import time
from dataclasses import dataclass, field
from pathlib import Path
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parents[1]
VERIFY_SQL = ROOT / "supabase" / "hosted" / "verify.sql"
DEFAULT_CONTAINER = "supabase_db_sme-ai-agent"
COUNT_SQL = """
select table_schema || '.' || table_name || '=' ||
       (xpath('/row/cnt/text()', query_to_xml(format('select count(*) as cnt from %I.%I', table_schema, table_name), false, true, '')))[1]::text
  from information_schema.tables
 where table_type = 'BASE TABLE'
   and table_schema in ('public', 'app', 'auth', 'integrations', 'scheduler', 'suppression', 'erasure', 'supabase_migrations')
 order by table_schema, table_name
"""


def describe(url: str) -> str:
    """host/database of a connection string, without user, password or query (those never leave this function)."""
    try:
        parts = urlsplit(url)
        return f"{parts.hostname or '?'}/{(parts.path or '/').lstrip('/') or '?'}"
    except ValueError:
        return "?/?"


def throwaway(url: str) -> bool:
    return bool(re.search(r"drill|throwaway", describe(url), re.IGNORECASE))


def plan(source: str | None, target: str | None, *, target_is_throwaway: bool = False) -> tuple[list[str], list[str]]:
    """(the lines of the plan, the problems found). Problems are refusals: a drill with a problem must not be started."""
    problems: list[str] = []
    if source and target:
        if describe(source) == describe(target):
            problems.append("SOURCE_DATABASE_URL and TARGET_DATABASE_URL name the same database: the drill must restore into a DIFFERENT, throwaway database")
        if not (throwaway(target) or target_is_throwaway):
            problems.append("the target does not look like a throwaway (its host or database name should say drill or throwaway); pass --target-is-throwaway only if you are certain")
    elif source or target:
        problems.append("set both SOURCE_DATABASE_URL and TARGET_DATABASE_URL, or neither (the plan is printed without them)")
    lines = [
        "HOSTED RESTORE DRILL: plan (nothing is run)",
        "",
        "0. Before: a second project for the drill (same region; the free tier is enough), its reference noted; the backup time you restore from written down; the list of erasures executed AFTER that time:",
        "     select id, scope, subject_id, executed_at from public.erasure_requests where status = 'executed' and executed_at > '<backup time>' order by executed_at;",
        "1. Tools present: pg_dump, pg_restore, psql (same major version as the server).",
        "2. Dump (or download the platform backup instead):",
        '     time pg_dump "$SOURCE_DATABASE_URL" --format=custom --no-owner --file drill.dump',
        "3. Restore into the THROWAWAY (this is the RTO; write the time down):",
        '     time pg_restore --dbname "$TARGET_DATABASE_URL" --exit-on-error drill.dump  # keep owners: the definer functions must belong to postgres (verify.sql checks)',
        "4. Verify the restored database is the same SAFE database (every row ok = true):",
        '     psql "$TARGET_DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/hosted/verify.sql',
        "5. Compare row counts of every table, source and target (this script's --local mode does it; for hosted, run the count query on both and diff).",
        "6. Re-apply the erasures newer than the backup (docs/runbooks/backup-restore-drill.md, step 4) and scan the workspace's text columns for the erased person's identifiers.",
        "7. Record: backup time, restore duration, the verify output, the re-applied erasures, the scan. Name it as the gate's restore_drill_ref. Then delete the throwaway's data.",
        "",
        "Never restore over production. If production must be restored for real: stop writes first (close the gate, switch agents off), restore, run steps 4 and 6 on production, then reopen.",
    ]
    if source and target:
        lines += ["", f"Checked: source {describe(source)}; target {describe(target)}."]
    return lines, problems


@dataclass
class Step:
    name: str
    seconds: float
    ok: bool
    detail: str = ""


@dataclass
class Drill:
    container: str
    steps: list[Step] = field(default_factory=list)
    problems: list[str] = field(default_factory=list)

    def run(self, args: list[str], *, stdin: str | None = None) -> subprocess.CompletedProcess[str]:
        return subprocess.run(args, input=stdin, capture_output=True, text=True, check=False)  # noqa: S603

    def psql(self, database: str, sql: str, *, user: str = "postgres") -> str:
        result = self.run(["docker", "exec", "-i", self.container, "psql", "-U", user, "-d", database, "-X", "-q", "-t", "-A", "-v", "ON_ERROR_STOP=1"], stdin=sql)
        if result.returncode != 0:
            raise RuntimeError(f"psql failed on {database}: {result.stderr.strip()[:200]}")
        return result.stdout

    def timed(self, name: str, work: object) -> tuple[Step, object]:
        started = time.perf_counter()
        try:
            detail = work() if callable(work) else ""
            step = Step(name, time.perf_counter() - started, True, str(detail or ""))
        except RuntimeError as exc:
            step = Step(name, time.perf_counter() - started, False, str(exc))
            detail = None
        self.steps.append(step)
        return step, detail


def local_drill(container: str = DEFAULT_CONTAINER) -> Drill:
    drill = Drill(container)
    if not container.endswith("-agent"):
        drill.problems.append("refusing: --local runs only on the AGENT stack's container (its name ends in -agent), never the owner's")
        return drill
    if subprocess.run(["docker", "inspect", "-f", "{{.State.Running}}", container], capture_output=True, text=True, check=False).stdout.strip() != "true":  # noqa: S603, S607
        drill.problems.append(f"container {container} is not running (make agent-db-up)")
        return drill
    stamp = time.strftime("%Y%m%d%H%M%S")
    scratch = f"drill_{stamp}"
    dump = f"/tmp/{scratch}.dump"  # noqa: S108 - inside the throwaway container
    try:
        before = drill.psql("postgres", COUNT_SQL)
        verify_sql = VERIFY_SQL.read_text(encoding="utf-8")
        verify_before = drill.psql("postgres", verify_sql)

        def do_dump() -> str:
            r = drill.run(["docker", "exec", container, "pg_dump", "-U", "supabase_admin", "-Fc", "-d", "postgres", "-f", dump])
            if r.returncode != 0:
                raise RuntimeError("pg_dump failed: " + r.stderr.strip()[:200])
            size = drill.run(["docker", "exec", container, "stat", "-c", "%s", dump]).stdout.strip()
            return f"{int(size) / 1_000_000:.1f} MB" if size.isdigit() else ""

        step, _ = drill.timed("dump", do_dump)
        if not step.ok:
            return drill
        drill.psql("postgres", f"create database {scratch}")
        restore_errors: list[str] = []

        def do_restore() -> str:
            r = drill.run(["docker", "exec", container, "pg_restore", "-U", "supabase_admin", "-d", scratch, dump])
            restore_errors.extend(line for line in r.stderr.splitlines() if line.startswith("pg_restore: error"))
            if r.returncode != 0:
                raise RuntimeError(f"pg_restore reported {len(restore_errors)} error(s): " + " | ".join(e[:120] for e in restore_errors[:3]))
            return "no errors"

        drill.timed("restore (the RTO)", do_restore)
        after = drill.psql(scratch, COUNT_SQL)
        same_counts = before == after
        drill.steps.append(Step("row counts equal in every table", 0.0, same_counts, f"{len(before.splitlines())} tables" if same_counts else _diff(before, after)))
        verify_after = drill.psql(scratch, verify_sql)
        bad_before = [line for line in verify_before.splitlines() if "|f|" in line or line.endswith("|f")]
        bad_after = [line for line in verify_after.splitlines() if "|f|" in line or line.endswith("|f")]
        drill.steps.append(Step("verify.sql: the restored database answers like the source", 0.0, verify_before == verify_after and bad_after == bad_before, f"{len(verify_after.splitlines())} checks; not ok in source {len(bad_before)}, in restore {len(bad_after)}"))
    except RuntimeError as exc:
        drill.steps.append(Step("drill", 0.0, False, str(exc)))
    finally:
        drill.run(["docker", "exec", container, "rm", "-f", dump])
        drill.run(["docker", "exec", container, "psql", "-U", "postgres", "-X", "-q", "-c", f"drop database if exists {scratch}"])
    return drill


def _diff(a: str, b: str) -> str:
    left, right = set(a.splitlines()), set(b.splitlines())
    return "differs: " + ", ".join(sorted(left ^ right)[:6])


def report(drill: Drill) -> str:
    ok = not drill.problems and bool(drill.steps) and all(s.ok for s in drill.steps)
    lines = [f"# Local restore drill: {'PASS' if ok else 'FAIL'}", "", f"Container `{drill.container}` (the agent stack). Dump with `pg_dump -Fc`, restore with `pg_restore` (owners kept) into a scratch database, then compare.", ""]
    lines += [f"* {p}" for p in drill.problems]
    lines += ["| step | seconds | result | detail |", "|---|---|---|---|"]
    lines += [f"| {s.name} | {s.seconds:.1f} | {'ok' if s.ok else 'FAILED'} | {s.detail} |" for s in drill.steps]
    return "\n".join(lines) + "\n"


def main(argv: list[str]) -> int:
    if "--local" in argv:
        container = argv[argv.index("--container") + 1] if "--container" in argv else DEFAULT_CONTAINER
        drill = local_drill(container)
        text = report(drill)
        print(text)
        if "--report" in argv:
            Path(argv[argv.index("--report") + 1]).expanduser().write_text(text, encoding="utf-8")
        return 0 if not drill.problems and drill.steps and all(s.ok for s in drill.steps) else 1
    lines, problems = plan(os.environ.get("SOURCE_DATABASE_URL"), os.environ.get("TARGET_DATABASE_URL"), target_is_throwaway="--target-is-throwaway" in argv)
    print("\n".join(lines))
    if problems:
        print("\nREFUSED:\n" + "\n".join(f"  - {p}" for p in problems), file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
    _ = shlex  # (kept for readers who extend the printed commands)
