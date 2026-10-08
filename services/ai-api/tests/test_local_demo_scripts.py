"""`make dev-api-local`, `make dev-web-local` and `make demo-code`: local only, public values only, nothing printed."""

from __future__ import annotations

import importlib.util
import os
import re
import stat
import subprocess
import sys
from pathlib import Path
from typing import Any

import pytest

ROOT = Path(__file__).resolve().parents[3]
WRAPPER = ROOT / "scripts" / "with-local-demo-env.sh"
DEMO_CODE = ROOT / "scripts" / "demo_code.py"
sys.path.insert(0, str(ROOT / "scripts"))
spec = importlib.util.spec_from_file_location("demo_code", DEMO_CODE)
assert spec and spec.loader
demo_code: Any = importlib.util.module_from_spec(spec)
spec.loader.exec_module(demo_code)


def fake_supabase(tmp_path: Path, api_url: str) -> dict[str, str]:
    """A `supabase` on the PATH that prints a stack with the given URL (invented keys)."""
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir()
    exe = bin_dir / "supabase"
    exe.write_text(
        "#!/bin/sh\n"
        f"echo 'API_URL=\"{api_url}\"'\n"
        "echo 'PUBLISHABLE_KEY=\"sb_publishable_FAKE_FOR_TEST\"'\n"
        "echo 'ANON_KEY=\"fake-anon\"'\n"
        "echo 'SERVICE_ROLE_KEY=\"fake-service-role-must-never-appear\"'\n"
        "echo 'SECRET_KEY=\"fake-secret-must-never-appear\"'\n"
    )
    exe.chmod(exe.stat().st_mode | stat.S_IEXEC)
    return {**os.environ, "PATH": f"{bin_dir}:{os.environ['PATH']}"}


def run_wrapper(env: dict[str, str], *cmd: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(  # noqa: S603 - fixed argv in a test
        [str(WRAPPER), *cmd], capture_output=True, text=True, env=env, timeout=30, check=False
    )


def test_it_gives_each_app_the_names_it_needs_from_the_local_stack(tmp_path: Path) -> None:
    env = fake_supabase(tmp_path, "http://127.0.0.1:54321")
    names = "SUPABASE_URL SUPABASE_PUBLISHABLE_KEY NEXT_PUBLIC_SUPABASE_URL NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY NEXT_PUBLIC_API_BASE_URL"
    done = run_wrapper(env, "sh", "-c", "".join(f"echo {n}=${n}; " for n in names.split()))
    assert done.returncode == 0, done.stderr
    got = dict(line.split("=", 1) for line in done.stdout.splitlines())
    assert got["SUPABASE_URL"] == got["NEXT_PUBLIC_SUPABASE_URL"] == "http://127.0.0.1:54321"
    assert (
        got["SUPABASE_PUBLISHABLE_KEY"]
        == got["NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"]
        == "sb_publishable_FAKE_FOR_TEST"
    )
    assert got["NEXT_PUBLIC_API_BASE_URL"] == "http://localhost:8000"


def test_no_secret_or_service_role_key_reaches_the_command_or_the_output(tmp_path: Path) -> None:
    env = fake_supabase(tmp_path, "http://localhost:54321")
    done = run_wrapper(env, "sh", "-c", "env")
    assert done.returncode == 0
    assert "must-never-appear" not in done.stdout + done.stderr


@pytest.mark.parametrize(
    "url",
    [
        "https://abcdefgh.supabase.co",
        "http://10.0.0.5:54321",
        "http://127.0.0.1.evil.example:54321",
        "http://localhost.evil.example:1",
    ],
)
def test_it_refuses_to_start_unless_the_supabase_url_is_this_machine(
    tmp_path: Path, url: str
) -> None:
    env = fake_supabase(tmp_path, url)
    done = run_wrapper(env, "sh", "-c", "echo STARTED")
    assert done.returncode != 0 and "STARTED" not in done.stdout
    assert "Refusing to start" in done.stderr
    assert "FAKE_FOR_TEST" not in done.stdout + done.stderr


def test_the_scripts_hold_no_secret_and_the_makefile_leaves_the_old_targets_alone() -> None:
    for path in (WRAPPER, DEMO_CODE):
        assert not re.search(
            r"SERVICE_ROLE|SECRET_KEY|JWT_SECRET|supabase\.co",
            path.read_text().replace("never read", ""),
        )
    makefile = (ROOT / "Makefile").read_text()
    assert (
        "dev-api:\n\tcd $(API) && .venv/bin/uvicorn app.main:app --reload --port 8000\n" in makefile
    )
    assert "dev-web:\n\tcd $(WEB) && npm run dev\n" in makefile
    assert (
        "with-local-demo-env.sh .venv/bin/uvicorn" in makefile
        and "with-local-demo-env.sh npm run dev" in makefile
    )


def test_demo_code_refuses_a_hosted_database_before_touching_docker(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    monkeypatch.setenv("SUPABASE_URL", "https://abcdefgh.supabase.co")
    monkeypatch.setattr(
        demo_code.subprocess, "run", lambda *a, **k: pytest.fail("docker must not run")
    )
    assert demo_code.main() == 1
    assert "Refusing to run" in capsys.readouterr().err


def test_demo_code_prints_six_digits_then_one_line(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    monkeypatch.setenv("SUPABASE_URL", "http://127.0.0.1:54321")
    monkeypatch.setattr(demo_code, "demo_user_id", lambda: "00000000-0000-0000-0000-000000000001")
    monkeypatch.setattr(demo_code, "local_factor_secret", lambda user_id: "JBSWY3DPEHPK3PXP")
    assert demo_code.main() == 0
    lines = capsys.readouterr().out.splitlines()
    assert re.fullmatch(r"\d{6}", lines[0]) and len(lines) == 2 and "local demo code" in lines[1]


def test_demo_code_says_what_to_do_when_the_demo_owner_does_not_exist(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    monkeypatch.setenv("SUPABASE_URL", "http://127.0.0.1:54321")
    monkeypatch.setattr(demo_code.shutil, "which", lambda name: "/usr/bin/docker")
    monkeypatch.setattr(
        demo_code.subprocess,
        "run",
        lambda *a, **k: subprocess.CompletedProcess(a, 0, stdout="", stderr=""),
    )
    assert demo_code.main() == 1
    assert "make seed-demo-manual" in capsys.readouterr().err
