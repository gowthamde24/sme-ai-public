"""Job CB (ADR 0082): the restore-drill script and the load-test script, their pure parts and their refusals. The real drill and the real load test are opt-in (`make restore-drill DRILL=local`, `make loadtest`);
here nothing touches Docker or the network."""

from __future__ import annotations

import importlib.util
import subprocess
import sys
from pathlib import Path
from types import ModuleType
from typing import Any

import pytest

ROOT = Path(__file__).resolve().parents[3]


def load(name: str) -> ModuleType:
    spec = importlib.util.spec_from_file_location(name, ROOT / "scripts" / f"{name}.py")
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


drill = load("restore_drill")
load_test = load("loadtest")

SECRET_URL_A = "postgresql://postgres.abcd:S3cretPassw0rd!@db.prod-project.supabase.co:5432/postgres"
SECRET_URL_B = "postgresql://postgres.efgh:An0therSecr3t@db.drill-project.supabase.co:5432/postgres"


# ---------------------------------------------------------------------------------------------- the restore drill
def test_describe_never_carries_a_password_or_a_user() -> None:
    assert drill.describe(SECRET_URL_A) == "db.prod-project.supabase.co/postgres"
    for text in (drill.describe(SECRET_URL_A), drill.describe("not a url"), drill.describe("")):
        assert "S3cret" not in text and "postgres.abcd" not in text


def test_the_plan_without_connection_strings_is_printed_and_has_no_problem() -> None:
    lines, problems = drill.plan(None, None)
    text = "\n".join(lines)
    assert problems == [] and "pg_dump" in text and "pg_restore" in text and "supabase/hosted/verify.sql" in text and "$TARGET_DATABASE_URL" in text and "nothing is run" in text
    assert "keep owners" in text, "the restore must keep the owners: the definer functions have to belong to postgres"


def test_a_target_that_is_the_source_or_not_a_throwaway_is_refused() -> None:
    _, same = drill.plan(SECRET_URL_A, SECRET_URL_A)
    assert any("same database" in p for p in same)
    _, notaway = drill.plan(SECRET_URL_A, "postgresql://u:p@db.other-project.supabase.co:5432/postgres")
    assert any("throwaway" in p for p in notaway)
    lines, ok = drill.plan(SECRET_URL_A, SECRET_URL_B)
    assert ok == [] and "db.drill-project.supabase.co/postgres" in "\n".join(lines)
    assert "S3cret" not in "\n".join(lines) and "An0ther" not in "\n".join(lines)
    _, forced = drill.plan(SECRET_URL_A, "postgresql://u:p@db.other-project.supabase.co:5432/postgres", target_is_throwaway=True)
    assert forced == []
    _, half = drill.plan(SECRET_URL_A, None)
    assert half


def test_the_dry_run_command_exits_two_on_a_refusal_and_prints_no_secret(tmp_path: Path) -> None:
    env = {"PATH": "/usr/bin:/bin", "SOURCE_DATABASE_URL": SECRET_URL_A, "TARGET_DATABASE_URL": SECRET_URL_A}
    result = subprocess.run([sys.executable, str(ROOT / "scripts" / "restore_drill.py"), "--dry-run"], capture_output=True, text=True, env=env, check=False)  # noqa: S603
    assert result.returncode == 2 and "REFUSED" in result.stderr
    assert "S3cretPassw0rd" not in result.stdout + result.stderr
    clean = subprocess.run([sys.executable, str(ROOT / "scripts" / "restore_drill.py")], capture_output=True, text=True, env={"PATH": "/usr/bin:/bin"}, check=False)  # noqa: S603
    assert clean.returncode == 0 and "HOSTED RESTORE DRILL" in clean.stdout


def test_the_local_drill_refuses_the_owners_container_and_a_stopped_one(monkeypatch: pytest.MonkeyPatch) -> None:
    owner = drill.local_drill("supabase_db_sme-ai")
    assert owner.problems and "AGENT" in owner.problems[0] and owner.steps == []
    monkeypatch.setattr(drill.subprocess, "run", lambda *a, **k: subprocess.CompletedProcess(a, 1, stdout="false\n", stderr=""))
    stopped = drill.local_drill("supabase_db_sme-ai-agent")
    assert stopped.problems and "not running" in stopped.problems[0]


class FakeDrill:
    """The drill's Docker calls, scripted: the order of steps and what is always cleaned up."""

    def __init__(self, *, dump_ok: bool = True, restore_ok: bool = True, counts_same: bool = True, verify_same: bool = True) -> None:
        self.calls: list[str] = []
        self.dump_ok, self.restore_ok, self.counts_same, self.verify_same = dump_ok, restore_ok, counts_same, verify_same

    def run(self, args: list[str], input: str | None = None, **kw: Any) -> subprocess.CompletedProcess[str]:
        joined = " ".join(args)
        self.calls.append(joined)
        if "inspect" in args:
            return subprocess.CompletedProcess(args, 0, stdout="true\n", stderr="")
        if "pg_dump" in args:
            return subprocess.CompletedProcess(args, 0 if self.dump_ok else 1, stdout="", stderr="" if self.dump_ok else "boom")
        if "pg_restore" in args:
            return subprocess.CompletedProcess(args, 0 if self.restore_ok else 1, stdout="", stderr="" if self.restore_ok else "pg_restore: error: could not execute query: ERROR:  boom\n")
        if "stat" in args:
            return subprocess.CompletedProcess(args, 0, stdout="2100000\n", stderr="")
        if "-d" in args and input is not None:
            database = args[args.index("-d") + 1]
            if input != drill.VERIFY_SQL.read_text(encoding="utf-8"):
                return subprocess.CompletedProcess(args, 0, stdout="public.a=1\n" if database == "postgres" or self.counts_same else "public.a=2\n", stderr="")
            return subprocess.CompletedProcess(args, 0, stdout="check|t|x\n" if database == "postgres" or self.verify_same else "check|f|x\n", stderr="")
        return subprocess.CompletedProcess(args, 0, stdout="", stderr="")


def run_with(monkeypatch: pytest.MonkeyPatch, fake: FakeDrill) -> Any:
    monkeypatch.setattr(drill.subprocess, "run", lambda args, **kw: fake.run(args, kw.get("input")))
    return drill.local_drill("supabase_db_sme-ai-agent")


def test_a_clean_drill_passes_and_cleans_up(monkeypatch: pytest.MonkeyPatch) -> None:
    fake = FakeDrill()
    result = run_with(monkeypatch, fake)
    assert result.problems == [] and [s.name for s in result.steps][:2] == ["dump", "restore (the RTO)"] and all(s.ok for s in result.steps)
    assert drill.report(result).startswith("# Local restore drill: PASS")
    assert any("drop database if exists drill_" in c for c in fake.calls) and any("rm -f /tmp/drill_" in c for c in fake.calls)


@pytest.mark.parametrize("flaw", ["dump_ok", "restore_ok", "counts_same", "verify_same"])
def test_every_kind_of_failure_fails_the_drill_and_still_cleans_up(monkeypatch: pytest.MonkeyPatch, flaw: str) -> None:
    fake = FakeDrill(**{flaw: False})
    result = run_with(monkeypatch, fake)
    assert not all(s.ok for s in result.steps) and drill.report(result).startswith("# Local restore drill: FAIL")
    assert any("rm -f /tmp/drill_" in c for c in fake.calls) and any("drop database if exists drill_" in c for c in fake.calls)


# ---------------------------------------------------------------------------------------------- the load test
def test_the_load_test_refuses_anything_that_is_not_local_or_is_the_owners() -> None:
    assert load_test.refuse_unless_local("http://localhost:8001", "http://127.0.0.1:54421") is None
    assert "not on this machine" in load_test.refuse_unless_local("https://api.example.com", "http://127.0.0.1:54421")
    assert "not on this machine" in load_test.refuse_unless_local("http://localhost:8001", "https://abc.supabase.co")
    assert "OWNER" in load_test.refuse_unless_local("http://localhost:8000", "http://127.0.0.1:54421")
    assert "OWNER" in load_test.refuse_unless_local("http://localhost:8001", "http://127.0.0.1:54321")


def test_the_command_refuses_before_doing_anything(tmp_path: Path) -> None:
    base = {"PATH": "/usr/bin:/bin"}
    none = subprocess.run([sys.executable, str(ROOT / "scripts" / "loadtest.py")], capture_output=True, text=True, env=base, check=False)  # noqa: S603
    assert none.returncode == 2 and "SUPABASE_URL" in none.stderr
    env = {**base, "SUPABASE_URL": "http://127.0.0.1:54321", "SUPABASE_PUBLISHABLE_KEY": "public-key-for-tests"}
    owner = subprocess.run([sys.executable, str(ROOT / "scripts" / "loadtest.py"), "--api", "http://localhost:8001"], capture_output=True, text=True, env=env, check=False)  # noqa: S603
    assert owner.returncode == 2 and "OWNER" in owner.stderr and "public-key-for-tests" not in owner.stderr
    too_many = subprocess.run([sys.executable, str(ROOT / "scripts" / "loadtest.py"), "--shops", "500"], capture_output=True, text=True, env={**env, "SUPABASE_URL": "http://127.0.0.1:54421"}, check=False)  # noqa: S603
    assert too_many.returncode == 2 and "--shops" in too_many.stderr


def test_percentiles_and_the_summary() -> None:
    assert load_test.percentile([], 0.5) == 0.0 and load_test.percentile([5.0], 0.99) == 5.0
    assert load_test.percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 0.5) in (5, 6) and load_test.percentile(list(range(101)), 0.95) == 95
    samples = [load_test.Sample("read", 200, float(i)) for i in range(1, 101)] + [load_test.Sample("read", 429, 1.0), load_test.Sample("write", 500, 900.0), load_test.Sample("write", 0, 10.0), load_test.Sample("write", 404, 5.0)]
    summary = load_test.summarise(samples, 10.0)
    assert summary["requests"] == 104 and summary["errors"] == 2 and summary["rate_limited"] == 1 and summary["client_errors"] == 1 and summary["throughput_rps"] == 10.4
    rows = {r["class"]: r for r in summary["classes"]}
    assert rows["write"]["errors"] == 2 and rows["read"]["rate_limited"] == 1 and rows["read"]["p95"] <= 100


def test_the_verdict() -> None:
    ok = load_test.summarise([load_test.Sample("read", 200, 50.0)] * 10, 5.0)
    assert load_test.verdict(ok, 1500, 0.01) == []
    slow = load_test.summarise([load_test.Sample("read", 200, 3000.0)] * 10, 5.0)
    assert any("p95" in f for f in load_test.verdict(slow, 1500, 0.01))
    broken = load_test.summarise([load_test.Sample("read", 500, 10.0)] * 10 + [load_test.Sample("read", 200, 10.0)] * 10, 5.0)
    assert any("error rate" in f for f in load_test.verdict(broken, 1500, 0.01))
    text = load_test.markdown(slow, 5, load_test.verdict(slow, 1500, 0.01), 3.0, {"shops": 5})
    assert "FAIL" in text and "| read |" in text
