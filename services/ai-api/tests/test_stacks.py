# ruff: noqa: E501
"""Job BG: two separate local Supabase stacks (docs/runbooks/two-local-stacks.md). The owner's demo keeps the default stack; agents work on their own, and nothing an agent runs can reset, stop or pin the
clock of the owner's database without OWNER_OK=1. These tests need no Docker and no Supabase: a fake `supabase` on the PATH records what it was asked."""

from __future__ import annotations

import importlib.util
import os
import re
import shutil
import stat
import subprocess
import sys
import tomllib
from pathlib import Path
from typing import Any

import pytest

ROOT = Path(__file__).resolve().parents[3]
SCRIPTS = ROOT / "scripts"
sys.path.insert(0, str(SCRIPTS))
import gen_agent_stack as gen  # noqa: E402
import stack_env  # noqa: E402

OWNER_CONFIG = ROOT / "supabase" / "config.toml"
AGENT_CONFIG = ROOT / "stacks" / "sme-ai-agent" / "supabase" / "config.toml"
OWNER_REFUSAL = "OWNER's stack"


def flatten(data: dict[str, Any], prefix: str = "") -> dict[str, Any]:
    out: dict[str, Any] = {}
    for key, value in data.items():
        name = f"{prefix}.{key}" if prefix else key
        if isinstance(value, dict):
            out.update(flatten(value, name))
        else:
            out[name] = value
    return out


# ------------------------------------------------------------------------------------------------------------ the generated config
def test_the_committed_agent_config_is_in_sync_with_the_owners() -> None:
    assert gen.main(["--check"]) == 0, "run: python3 scripts/gen_agent_stack.py"


def test_the_agent_config_differs_from_the_owners_only_where_the_generator_says() -> None:
    owner = flatten(tomllib.loads(OWNER_CONFIG.read_text()))
    agent = flatten(tomllib.loads(AGENT_CONFIG.read_text()))
    assert owner.keys() == agent.keys()
    differing = {key for key in owner if owner[key] != agent[key]}
    expected = {f"{section}.{key}" if section else key for section, key in gen.CHANGES}
    assert differing == expected, "a setting that is not in the generator's list differs between the two stacks"


def test_the_two_stacks_share_no_project_id_and_no_port() -> None:
    owner = flatten(tomllib.loads(OWNER_CONFIG.read_text()))
    agent = flatten(tomllib.loads(AGENT_CONFIG.read_text()))
    assert owner["project_id"] != agent["project_id"]
    assert agent["project_id"] == stack_env.AGENT.project_id and owner["project_id"] == stack_env.OWNER.project_id
    def ports(cfg: dict[str, Any]) -> set[int]:
        return {v for k, v in cfg.items() if k.endswith("port") and isinstance(v, int)}

    assert ports(owner) and ports(agent)
    assert not ports(owner) & ports(agent), "the two stacks must not bind the same port"
    assert agent["api.port"] == stack_env.AGENT.api_port and agent["db.port"] == stack_env.AGENT.db_port
    assert agent["local_smtp.port"] == stack_env.AGENT.mail_port and owner["local_smtp.port"] == stack_env.OWNER.mail_port, "the mail catcher's port is the stack's (the sign-up tests read it)"
    assert owner["api.port"] == stack_env.OWNER.api_port and owner["db.port"] == stack_env.OWNER.db_port


def test_the_agent_stack_folder_is_named_like_its_project() -> None:
    # the Supabase CLI names some containers and its network by the folder
    assert AGENT_CONFIG.parents[1].name == stack_env.AGENT.project_id


def test_copies_in_the_agent_folder_are_not_tracked() -> None:
    ignore = (ROOT / "stacks" / "sme-ai-agent" / ".gitignore").read_text()
    for name in gen.SYNCED:
        assert re.search(rf"^/?supabase/{name}/?$", ignore, re.M), f"{name} (a copy) must be git-ignored"


# ------------------------------------------------------------------------------------------------------------ the resolver
CASES = [
    {},
    {"SME_STACK": "agent"},
    {"SME_STACK": "owner"},
    {"SUPABASE_URL": "http://127.0.0.1:54321"},
    {"SUPABASE_URL": "http://127.0.0.1:54421"},
    {"SUPABASE_URL": "http://localhost:54321/"},
    {"SUPABASE_URL": "http://localhost:9"},
    {"SME_STACK": "agent", "SUPABASE_URL": "http://127.0.0.1:54321"},
    {"SME_STACK": "owner", "SUPABASE_URL": "http://127.0.0.1:54421"},
    {"SME_STACK": "owner", "SME_DB_CONTAINER": "supabase_db_sme-fake"},
]


def shell_view(extra: dict[str, str]) -> dict[str, str]:
    env = {"PATH": os.environ["PATH"], "HOME": os.environ.get("HOME", "/"), **extra}
    out = subprocess.run(  # noqa: S603 - fixed argv
        ["/bin/sh", "-c", ". ./scripts/stack.sh && echo \"$SME_STACK $SME_PROJECT_ID $SME_WORKDIR $SME_API_PORT $SME_DB_PORT $SME_MAIL_PORT $SME_DB_CONTAINER\""],
        cwd=ROOT, env=env, capture_output=True, text=True, check=True,
    ).stdout.split()
    return dict(zip(["stack", "project", "workdir", "api", "db", "mail", "container"], out, strict=True))


@pytest.mark.parametrize("extra", CASES)
def test_the_python_and_shell_resolvers_agree(extra: dict[str, str]) -> None:
    sh = shell_view(extra)
    stack = stack_env.current(extra)
    assert sh["stack"] == stack.name
    assert sh["project"] == stack.project_id
    assert sh["workdir"] == stack.workdir
    assert (int(sh["api"]), int(sh["db"]), int(sh["mail"])) == (stack.api_port, stack.db_port, stack.mail_port)
    assert sh["container"] == stack_env.db_container(extra)


def test_the_default_is_the_agent_stack() -> None:
    assert stack_env.current({}) is stack_env.AGENT
    assert stack_env.db_container({}) == "supabase_db_sme-ai-agent"


def test_an_unknown_stack_name_is_refused() -> None:
    with pytest.raises(stack_env.StackError):
        stack_env.current({"SME_STACK": "prod"})
    result = subprocess.run(  # noqa: S603
        ["/bin/sh", "-c", ". ./scripts/stack.sh"], cwd=ROOT, env={"PATH": os.environ["PATH"], "SME_STACK": "prod"}, capture_output=True, text=True, check=False,
    )
    assert result.returncode != 0


def test_a_container_override_must_look_like_a_supabase_database() -> None:
    with pytest.raises(stack_env.StackError):
        stack_env.db_container({"SME_DB_CONTAINER": "postgres; rm -rf /"})


def test_the_owner_guard_python() -> None:
    stack_env.require_owner_ok("reset", {})  # the agent stack: allowed
    with pytest.raises(stack_env.StackError, match="OWNER's stack"):
        stack_env.require_owner_ok("reset", {"SME_STACK": "owner"})
    with pytest.raises(stack_env.StackError, match="OWNER's stack"):
        stack_env.require_owner_ok("reset", {"SUPABASE_URL": "http://127.0.0.1:54321", "OWNER_OK": "yes"})
    stack_env.require_owner_ok("reset", {"SME_STACK": "owner", "OWNER_OK": "1"})


def load(name: str) -> Any:
    spec = importlib.util.spec_from_file_location(name, SCRIPTS / f"{name}.py")
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module  # a dataclass in the module looks itself up here
    spec.loader.exec_module(module)
    return module


def test_the_helpers_find_the_agent_container_by_default(monkeypatch: pytest.MonkeyPatch) -> None:
    for name in ("SME_STACK", "SME_DB_CONTAINER", "SUPABASE_URL"):
        monkeypatch.delenv(name, raising=False)
    assert load("local_confirm").container() == "supabase_db_sme-ai-agent"
    monkeypatch.setenv("SME_STACK", "owner")
    assert load("local_confirm").container() == "supabase_db_sme-ai"


def test_the_seed_defaults_to_the_agent_stack_and_never_takes_the_owners_api_from_a_file() -> None:
    seed = load("seed_demo")
    agent = seed.load_config({})
    assert agent.supabase_url == "http://127.0.0.1:54421" and agent.api_url == "http://localhost:8001"
    # an address in the environment still wins, on the agent stack
    assert seed.load_config({"SEED_API_URL": "http://localhost:8002/"}).api_url == "http://localhost:8002"
    # the owner's stack keeps the owner's addresses (and its legacy chain)
    owner = seed.load_config({"SME_STACK": "owner"})
    assert owner.supabase_url == "http://127.0.0.1:54321" or owner.supabase_url.startswith("http")
    assert seed.load_config({"SME_STACK": "owner", "SEED_API_URL": "http://localhost:8000"}).api_url == "http://localhost:8000"


# ------------------------------------------------------------------------------------------------------------ the CLI wrapper and the Makefile
@pytest.fixture
def fake_cli(tmp_path: Path) -> tuple[dict[str, str], Path]:
    """A `supabase` on the PATH that only records its arguments (and the folder it was run from)."""
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir()
    log = tmp_path / "supabase.log"
    exe = bin_dir / "supabase"
    exe.write_text(f'#!/bin/sh\necho "$PWD :: $*" >> "{log}"\n')
    exe.chmod(exe.stat().st_mode | stat.S_IEXEC)
    env = {k: v for k, v in os.environ.items() if k not in ("SME_STACK", "SME_DB_CONTAINER", "OWNER_OK", "STACK", "SUPABASE_URL")}
    env["PATH"] = f"{bin_dir}:{env['PATH']}"
    return env, log


def calls(log: Path) -> list[str]:
    return log.read_text().splitlines() if log.exists() else []


def run(cmd: list[str], env: dict[str, str], **extra: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(cmd, cwd=ROOT, env={**env, **extra}, capture_output=True, text=True, check=False)  # noqa: S603


DESTRUCTIVE = [["db", "reset"], ["stop"], ["test", "db"], ["db", "push"], ["db", "pull"], ["stop", "--no-backup"]]


@pytest.mark.parametrize("args", DESTRUCTIVE)
def test_sb_refuses_a_destructive_action_on_the_owners_stack(fake_cli: tuple[dict[str, str], Path], args: list[str]) -> None:
    env, log = fake_cli
    result = run([str(SCRIPTS / "sb"), *args], env, SME_STACK="owner")
    assert result.returncode == 3 and OWNER_REFUSAL in result.stderr and "OWNER_OK=1" in result.stderr
    assert calls(log) == [], "the refusal must come before the Supabase CLI is run"


@pytest.mark.parametrize("flag", ["0", "true", "yes", ""])
def test_only_the_exact_value_one_releases_the_guard(fake_cli: tuple[dict[str, str], Path], flag: str) -> None:
    env, log = fake_cli
    result = run([str(SCRIPTS / "sb"), "db", "reset"], env, SME_STACK="owner", OWNER_OK=flag)
    assert result.returncode == 3 and calls(log) == []


def test_sb_lets_the_owner_through_with_owner_ok(fake_cli: tuple[dict[str, str], Path]) -> None:
    env, log = fake_cli
    result = run([str(SCRIPTS / "sb"), "db", "reset"], env, SME_STACK="owner", OWNER_OK="1")
    assert result.returncode == 0, result.stderr
    [call] = calls(log)
    assert call == f"{ROOT} :: db reset", "the owner's stack runs from the repository root, with no --workdir"


def test_sb_starting_the_owners_stack_is_not_destructive(fake_cli: tuple[dict[str, str], Path]) -> None:
    env, log = fake_cli
    for args in (["start"], ["status", "-o", "env"]):
        assert run([str(SCRIPTS / "sb"), *args], env, SME_STACK="owner").returncode == 0
    assert len(calls(log)) == 2


def test_sb_on_the_agent_stack_works_in_the_agent_folder_and_needs_no_owner_ok(fake_cli: tuple[dict[str, str], Path]) -> None:
    env, log = fake_cli
    for args in (["db", "reset"], ["test", "db"], ["stop"]):
        result = run([str(SCRIPTS / "sb"), *args], env)
        assert result.returncode == 0, result.stderr
    workdir = f"--workdir {ROOT}/stacks/sme-ai-agent"
    assert calls(log) == [f"{ROOT} :: db reset {workdir}", f"{ROOT} :: test db {workdir}", f"{ROOT} :: stop {workdir}"]
    # the agent stack's migrations and pgTAP files are the owner's, copied
    synced = ROOT / "stacks" / "sme-ai-agent" / "supabase"
    assert sorted(p.name for p in (synced / "migrations").glob("*.sql")) == sorted(p.name for p in (ROOT / "supabase" / "migrations").glob("*.sql"))
    assert sorted(p.name for p in (synced / "tests").rglob("*.sql")) == sorted(p.name for p in (ROOT / "supabase" / "tests").rglob("*.sql"))


def test_two_syncs_at_once_do_not_trample_each_other() -> None:
    # the API and the web of one e2e run both start through the wrapper at the same moment
    procs = [subprocess.Popen([sys.executable, str(SCRIPTS / "gen_agent_stack.py"), "--sync"], stderr=subprocess.PIPE, text=True) for _ in range(6)]  # noqa: S603
    results = [(p.wait(timeout=120), (p.stderr.read() if p.stderr else "")) for p in procs]
    assert all(code == 0 for code, _ in results), results
    synced = ROOT / "stacks" / "sme-ai-agent" / "supabase"
    assert sorted(f.name for f in (synced / "migrations").glob("*.sql")) == sorted(f.name for f in (ROOT / "supabase" / "migrations").glob("*.sql"))
    assert not list(synced.parent.glob(".*.new")), "no staging folder is left behind"


def test_sb_status_on_the_agent_stack_copies_nothing(fake_cli: tuple[dict[str, str], Path]) -> None:
    env, log = fake_cli
    marker = ROOT / "stacks" / "sme-ai-agent" / "supabase" / "migrations"
    before = marker.stat().st_mtime_ns
    assert run([str(SCRIPTS / "sb"), "status", "-o", "env"], env).returncode == 0
    assert marker.stat().st_mtime_ns == before, "a status call (made by every app start) must not rewrite the copies"
    assert calls(log) == [f"{ROOT} :: status -o env --workdir {ROOT}/stacks/sme-ai-agent"]


needs_make = pytest.mark.skipif(shutil.which("make") is None, reason="make is not installed")


@needs_make
@pytest.mark.parametrize("target", ["db-reset", "db-test", "db-stop"])
def test_make_refuses_the_owner_stack_without_owner_ok(fake_cli: tuple[dict[str, str], Path], target: str) -> None:
    env, log = fake_cli
    result = run(["make", target, "STACK=owner"], env)
    assert result.returncode != 0 and OWNER_REFUSAL in result.stderr
    assert calls(log) == []


@needs_make
def test_make_db_stop_is_the_owners_stack_and_is_refused_by_default(fake_cli: tuple[dict[str, str], Path]) -> None:
    env, log = fake_cli
    result = run(["make", "db-stop"], env)
    assert result.returncode != 0 and OWNER_REFUSAL in result.stderr and calls(log) == []


@needs_make
def test_make_defaults_to_the_agent_stack(fake_cli: tuple[dict[str, str], Path]) -> None:
    env, log = fake_cli
    for target in ("db-reset", "db-test", "agent-db-up", "agent-db-reset", "agent-db-test"):
        result = run(["make", target], env)
        assert result.returncode == 0, result.stderr
    assert all(call.endswith("--workdir " + str(ROOT / "stacks" / "sme-ai-agent")) for call in calls(log)) and len(calls(log)) == 5


@needs_make
def test_make_with_owner_ok_resets_the_owners_stack(fake_cli: tuple[dict[str, str], Path]) -> None:
    env, log = fake_cli
    assert run(["make", "db-reset", "STACK=owner"], env, OWNER_OK="1").returncode == 0
    assert calls(log) == [f"{ROOT} :: db reset"]


@needs_make
@pytest.mark.parametrize(
    ("args", "stack"),
    [([], "owner"), (["API_PORT=8001"], "agent"), (["API_PORT=8002"], "agent"), (["API_PORT=8001", "STACK=owner"], "owner"), (["STACK=agent"], "agent")],
)
def test_the_serving_targets_follow_the_port(args: list[str], stack: str) -> None:
    for target in ("dev-api-local", "dev-web-local", "dev-worker-local", "demo-code"):
        plan = subprocess.run(["make", "-n", target, *args], cwd=ROOT, capture_output=True, text=True, check=True).stdout  # noqa: S603, S607
        assert f"SME_STACK={stack} " in plan, (target, args, plan)


@needs_make
def test_the_checks_and_seeds_run_on_the_agent_stack_by_default() -> None:
    plan = subprocess.run(["make", "-n", "check"], cwd=ROOT, capture_output=True, text=True, check=True).stdout  # noqa: S603, S607
    assert "./scripts/sb db reset" in plan and "./scripts/sb test db" in plan and "SME_STACK=owner" not in plan
    # a recipe runs with SME_STACK exported: make exports it for every recipe
    makefile = (ROOT / "Makefile").read_text()
    assert re.search(r"^export SME_STACK := \$\(STACK\)$", makefile, re.M)
    assert re.search(r"^STACK := agent$", makefile, re.M)


# ------------------------------------------------------------------------------------------------------------ the integration tests refuse the owner's stack
def collect(env: dict[str, str]) -> subprocess.CompletedProcess[str]:
    base = {k: v for k, v in os.environ.items() if k not in ("SME_STACK", "SME_DB_CONTAINER", "OWNER_OK", "SUPABASE_URL")}
    return subprocess.run(  # noqa: S603
        [sys.executable, "-m", "pytest", "-c", "pyproject.toml", "../../tests/integration/test_api_end_to_end.py", "--collect-only", "-q"],
        cwd=ROOT / "services" / "ai-api", env={**base, "SUPABASE_PUBLISHABLE_KEY": "not-a-real-key", **env}, capture_output=True, text=True, check=False, timeout=180,
    )


def test_integration_tests_refuse_to_start_on_the_owners_stack_without_owner_ok() -> None:
    for env in ({"SUPABASE_URL": "http://127.0.0.1:54321"}, {"SME_STACK": "owner"}):
        result = collect(env)
        assert result.returncode != 0, result.stdout + result.stderr  # pytest reports an exit from a conftest as a usage error
        assert "refused to start" in result.stdout + result.stderr and "OWNER's" in result.stdout + result.stderr


def test_integration_tests_refuse_a_url_that_is_not_the_selected_stack() -> None:
    result = collect({"SME_STACK": "owner", "OWNER_OK": "1", "SUPABASE_URL": "http://127.0.0.1:54421"})
    assert result.returncode != 0 and "would talk to one database" in result.stdout + result.stderr


def test_integration_tests_start_on_the_agent_stack_and_on_the_owners_with_owner_ok() -> None:
    assert collect({"SUPABASE_URL": "http://127.0.0.1:54421"}).returncode == 0
    assert collect({"SUPABASE_URL": "http://127.0.0.1:54321", "OWNER_OK": "1"}).returncode == 0


# ------------------------------------------------------------------------------------------------------------ nothing else reads the owner's project id
def test_nothing_but_the_stack_files_reads_a_project_id() -> None:
    allowed = {"gen_agent_stack.py", "stack_env.py", "stack.sh", "test_stacks.py"}
    hits = []
    for folder, suffixes in (("scripts", {".py", ".sh", ""}), ("tests", {".py"}), ("tools", {".py", ".sh"}), ("e2e", {".mjs"}), ("services/ai-api/seeds", {".py"})):
        for path in (ROOT / folder).rglob("*"):
            if not path.is_file() or "node_modules" in path.parts or "__pycache__" in path.parts or path.suffix not in suffixes or path.name in allowed:
                continue
            text = path.read_text(errors="ignore")
            if re.search(r"project_id|supabase_db_\$\{?project", text):
                hits.append(str(path.relative_to(ROOT)))
    assert not hits, f"these read the owner's config or project id directly instead of scripts/stack_env.py / stack.sh: {hits}"


def test_ci_runs_its_one_stack_as_the_owner_stack_and_releases_the_guard() -> None:
    ci = (ROOT / ".github" / "workflows" / "ci.yml").read_text()
    assert re.search(r"^  SME_STACK: owner$", ci, re.M) and re.search(r'^  OWNER_OK: "1"$', ci, re.M)
