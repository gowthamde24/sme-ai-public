"""`make dev-api-groq` (job AN): local only, the key read hidden and never printed, the address and model checked before anything is changed.

The script is run from a COPY in a temporary folder with a fake `docker` and a fake `with-local-demo-env.sh` beside it, so no test touches Docker, the network or a real server."""

# ruff: noqa: E501

from __future__ import annotations

import os
import shutil
import stat
import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[3]
SCRIPT = ROOT / "scripts" / "dev-api-hosted-free.sh"
KEY = "gsk_made-up-key-for-tests-0123456789"
GROQ = "https://api.groq.com/openai/v1"


def executable(path: Path, text: str) -> None:
    path.write_text(text)
    path.chmod(path.stat().st_mode | stat.S_IEXEC)


class Sandbox:
    def __init__(self, tmp: Path, *, container_running: bool = True, tenant_exists: bool = True):
        self.root = tmp / "repo"
        (self.root / "scripts").mkdir(parents=True)
        (self.root / "supabase").mkdir()
        (self.root / "services" / "ai-api").mkdir(parents=True)
        (self.root / "supabase" / "config.toml").write_text('project_id = "sme-test"\n')
        shutil.copy(SCRIPT, self.root / "scripts" / "dev-api-hosted-free.sh")
        self.log = tmp / "docker.log"
        self.started = tmp / "started.txt"
        bin_dir = tmp / "bin"
        bin_dir.mkdir()
        executable(
            bin_dir / "docker",
            "#!/bin/sh\n"
            f'echo "$*" >> "{self.log}"\n'
            + ('[ "$1" = inspect ] && exit 1\n' if not container_running else "")
            + (
                'case "$*" in *operator_enable_assistant*) exit 1;; esac\n'
                if not tenant_exists
                else ""
            ),
        )
        # the fake of the wrapper that would start the API: it reports names and a yes/no for the key, never the key
        executable(
            self.root / "scripts" / "with-local-demo-env.sh",
            "#!/bin/sh\n"
            f'{{ echo "cmd=$*"; echo "AGENTS_ENABLED=$AGENTS_ENABLED"; echo "API_ENV=$API_ENV"; echo "LLM_PROVIDER=$LLM_PROVIDER";'
            f' echo "LLM_BASE_URL=$LLM_BASE_URL"; echo "LLM_MODEL=$LLM_MODEL"; [ "$LLM_API_KEY" = "{KEY}" ] && echo key_ok; }} > "{self.started}"\n',
        )
        self.env = {"PATH": f"{bin_dir}:/usr/bin:/bin", "HOME": str(tmp)}

    def run(self, **env: str) -> subprocess.CompletedProcess[str]:
        return subprocess.run(  # noqa: S603 - a copy of our own script in a temporary folder
            ["/bin/bash", str(self.root / "scripts" / "dev-api-hosted-free.sh")],
            capture_output=True,
            text=True,
            env={**self.env, **env},
            stdin=subprocess.DEVNULL,
            timeout=30,
            check=False,
        )

    def docker_calls(self) -> list[str]:
        return self.log.read_text().splitlines() if self.log.exists() else []


@pytest.fixture
def box(tmp_path: Path) -> Sandbox:
    return Sandbox(tmp_path)


def test_it_records_the_price_switches_the_assistant_on_and_starts_the_api_with_the_key(
    box: Sandbox,
) -> None:
    done = box.run(LLM_API_KEY=KEY)
    assert done.returncode == 0, done.stderr
    started = {
        name: value
        for name, _, value in (line.partition("=") for line in box.started.read_text().splitlines())
    }
    assert started["AGENTS_ENABLED"] == "true" and started["API_ENV"] == "development"
    assert started["LLM_PROVIDER"] == "openai_compat" and started["LLM_BASE_URL"] == GROQ
    assert started["LLM_MODEL"] == "llama-3.3-70b-versatile" and "key_ok" in started
    assert started["cmd"].endswith("uvicorn app.main:app --port 8000")
    calls = " ".join(box.docker_calls())
    assert "supabase_db_sme-test" in calls
    assert "values ('llama-3.3-70b-versatile', 1, 1) on conflict (model) do nothing" in calls, (
        "the minimum price, and an existing row is kept"
    )
    assert "operator_enable_assistant('demo-synthetic-sme')" in calls


def test_the_key_is_never_printed(box: Sandbox) -> None:
    done = box.run(LLM_API_KEY=f"  {KEY}\n")
    assert KEY not in done.stdout + done.stderr
    assert KEY not in " ".join(box.docker_calls()), "the key is never sent to the database either"


@pytest.mark.parametrize(
    "url",
    [
        "https://api.openai.com/v1",
        "http://api.groq.com/openai/v1",
        "https://api.groq.com/openai/v1/",
        "https://api.groq.com.evil.com/openai/v1",
        "http://localhost:11434/v1",
        "https://example.com",
    ],
)
def test_any_other_address_is_refused_before_anything_is_changed(box: Sandbox, url: str) -> None:
    done = box.run(LLM_API_KEY=KEY, LLM_BASE_URL=url)
    assert done.returncode == 2 and "Nothing was started" in done.stderr
    assert box.docker_calls() == [] and not box.started.exists()
    assert KEY not in done.stdout + done.stderr


@pytest.mark.parametrize(
    "env",
    [
        {"LLM_MODEL": "x'; drop table public.agent_model_prices; --"},
        {"LLM_MODEL": "a b"},
        {"LLM_BASE_URL": "https://openrouter.ai/api/v1", "LLM_MODEL": "openai/gpt-4o"},
        {"DEMO_SLUG": "demo'; --"},
        {"API_PORT": "80;ls"},
    ],
)
def test_a_bad_model_slug_or_port_is_refused_before_anything_is_changed(
    box: Sandbox, env: dict[str, str]
) -> None:
    done = box.run(LLM_API_KEY=KEY, **env)
    assert done.returncode == 2 and "Nothing was started" in done.stderr
    assert box.docker_calls() == [] and not box.started.exists()


def test_a_free_openrouter_model_is_allowed(box: Sandbox) -> None:
    done = box.run(
        LLM_API_KEY=KEY,
        LLM_BASE_URL="https://openrouter.ai/api/v1",
        LLM_MODEL="meta-llama/llama-3.3-70b-instruct:free",
    )
    assert done.returncode == 0, done.stderr
    assert "meta-llama/llama-3.3-70b-instruct:free" in " ".join(box.docker_calls())


@pytest.mark.parametrize("key", ["", "   ", "\n"])
def test_without_a_key_and_without_a_terminal_it_stops(box: Sandbox, key: str) -> None:
    done = box.run(LLM_API_KEY=key)
    assert done.returncode == 2 and "Nothing was started" in done.stderr
    assert box.docker_calls() == [] and not box.started.exists()


def test_without_the_local_database_it_stops_and_says_what_to_run(tmp_path: Path) -> None:
    box = Sandbox(tmp_path, container_running=False)
    done = box.run(LLM_API_KEY=KEY)
    assert done.returncode == 1 and "make db-start" in done.stderr
    assert not box.started.exists()


def test_without_the_demo_workspace_it_stops_and_says_what_to_run(tmp_path: Path) -> None:
    box = Sandbox(tmp_path, tenant_exists=False)
    done = box.run(LLM_API_KEY=KEY)
    assert done.returncode == 1 and "make seed-demo" in done.stderr
    assert not box.started.exists()


def test_the_script_reads_no_env_file_never_traces_and_only_prints_through_stderr() -> None:
    text = SCRIPT.read_text()
    code = "\n".join(line for line in text.splitlines() if not line.lstrip().startswith("#"))
    assert ".env" not in code and "set -x" not in code and "xtrace" not in code
    assert "service_role" not in text.lower() and "SERVICE_ROLE" not in text
    assert os.access(SCRIPT, os.X_OK)
