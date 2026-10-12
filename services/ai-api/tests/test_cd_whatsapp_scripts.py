"""Job CD: `make dev-api-whatsapp` and `make whatsapp-test`: the real WhatsApp adapter is switched on only by this script, the three secrets are read hidden and never printed or put on a command line, a
token Meta refuses stops the start, and the helper talks only to this machine. A fake `curl` and a fake `docker` stand in for the network and the container: no network, no Docker, no database."""

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
SCRIPT = ROOT / "scripts" / "dev-api-whatsapp.sh"
TOKEN = "EAAFakeTokenForTestsOnly0123456789abcdefABCDEF"  # noqa: S105
SECRET = "fakefakefakefakefakefakefakefake"  # noqa: S105
VERIFY = "a-long-invented-verify-phrase"
GOOD = {"WHATSAPP_ACCESS_TOKEN": TOKEN, "WHATSAPP_APP_SECRET": SECRET, "WHATSAPP_VERIFY_TOKEN": VERIFY, "WHATSAPP_PHONE_NUMBER_ID": "106540352242922"}


def fake_bin(tmp_path: Path, *, curl_status: str, docker_ok: bool) -> dict[str, str]:
    """A PATH with a `curl` that answers an HTTP status and records its arguments, and a `docker` that says whether the container exists."""
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir(exist_ok=True)
    log = tmp_path / "curl-args.txt"
    curl = bin_dir / "curl"
    curl.write_text(f"#!/bin/sh\necho \"$@\" >> '{log}'\ncat > '{tmp_path / 'curl-stdin.txt'}'\nprintf '%s' '{curl_status}'\n")
    docker = bin_dir / "docker"
    docker.write_text(f"#!/bin/sh\n{'exit 0' if docker_ok else 'exit 1'}\n")
    for exe in (curl, docker):
        exe.chmod(exe.stat().st_mode | stat.S_IEXEC)
    return {**{k: v for k, v in os.environ.items() if not k.startswith(("WHATSAPP_", "OUTBOX_", "CHANNEL_"))}, "PATH": f"{bin_dir}:{os.environ['PATH']}"}


def run(env: dict[str, str], **extra: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(  # noqa: S603 - fixed argv in a test
        ["/bin/bash", str(SCRIPT)], capture_output=True, text=True, env={**env, **extra}, timeout=30, check=False, stdin=subprocess.DEVNULL
    )


def nothing_secret(done: subprocess.CompletedProcess[str]) -> None:
    for value in (TOKEN, SECRET, VERIFY):
        assert value not in done.stdout + done.stderr


def test_without_a_terminal_and_without_the_secrets_it_asks_for_nothing_and_starts_nothing(tmp_path: Path) -> None:
    done = run(fake_bin(tmp_path, curl_status="200", docker_ok=True))
    assert done.returncode == 2 and "Nothing was started" in done.stderr and "no terminal" in done.stderr


@pytest.mark.parametrize(
    ("change", "words"),
    [
        ({"WHATSAPP_ACCESS_TOKEN": "short"}, "access token"),
        ({"WHATSAPP_APP_SECRET": "not hex!"}, "app secret"),
        ({"WHATSAPP_VERIFY_TOKEN": "tiny"}, "verify phrase"),
        ({"WHATSAPP_PHONE_NUMBER_ID": "12ab"}, "phone number id"),
        ({"API_PORT": "80;ls"}, "API_PORT"),
        ({"WHATSAPP_GRAPH_VERSION": "latest"}, "WHATSAPP_GRAPH_VERSION"),
    ],
)
def test_a_value_that_is_the_wrong_shape_stops_it_before_anything_is_sent(tmp_path: Path, change: dict[str, str], words: str) -> None:
    done = run(fake_bin(tmp_path, curl_status="200", docker_ok=True), **{**GOOD, **change})
    assert done.returncode == 2 and words in done.stderr and "Nothing was started" in done.stderr
    assert not (tmp_path / "curl-args.txt").exists(), "nothing was sent to Meta"
    nothing_secret(done)


@pytest.mark.parametrize("status", ["400", "401", "403"])
def test_a_token_meta_refuses_stops_the_start(tmp_path: Path, status: str) -> None:
    done = run(fake_bin(tmp_path, curl_status=status, docker_ok=True), **GOOD)
    assert done.returncode == 2 and "Meta refuses this token" in done.stderr and "Nothing was started" in done.stderr
    nothing_secret(done)


def test_the_token_goes_to_meta_on_stdin_never_in_the_arguments(tmp_path: Path) -> None:
    done = run(fake_bin(tmp_path, curl_status="200", docker_ok=False), **GOOD)  # no container: it stops after the check
    assert done.returncode == 1 and "database container" in done.stderr and "Nothing was started" in done.stderr
    args = (tmp_path / "curl-args.txt").read_text()
    assert TOKEN not in args and "graph.facebook.com/v25.0/106540352242922" in args, "the address names the number; the token is not in the process list"
    assert f"Bearer {TOKEN}" in (tmp_path / "curl-stdin.txt").read_text(), "it travelled on stdin, in a curl config"
    nothing_secret(done)


def test_the_script_reads_hidden_and_holds_no_secret_and_only_it_turns_the_real_adapter_on() -> None:
    text = SCRIPT.read_text()
    assert "read -rsp" in text and text.count("read -rsp") == 1, "one hidden reader, used for all three secrets"
    printing = [ln for ln in text.splitlines() if re.search(r"\b(echo|printf)\b[^\n]*\$\{?WHATSAPP_(ACCESS_TOKEN|APP_SECRET|VERIFY_TOKEN)", ln) and "| grep" not in ln and "Authorization: Bearer" not in ln]
    assert printing == [], "a secret is only checked by grep or sent to Meta on stdin; never printed"
    assert not re.search(r"SERVICE_ROLE|SECRET_KEY|\.env\b", text.replace("never reads a .env file", ""))
    assert "OUTBOX_ADAPTER=whatsapp" in text
    others = [p for p in (ROOT / "scripts").glob("*") if p.is_file() and p != SCRIPT and "OUTBOX_ADAPTER=whatsapp" in p.read_text(errors="ignore")]
    assert others == [], "no other script switches the real adapter on"
    makefile = (ROOT / "Makefile").read_text()
    assert "dev-api-whatsapp:\n\tSME_STACK=$(SERVE_STACK) API_PORT=$(API_PORT) ./scripts/dev-api-whatsapp.sh\n" in makefile
    assert "OUTBOX_ADAPTER" not in makefile, "the Makefile never sets the adapter: the fake is the default"
    assert "../../scripts/prepare_channel_agent.py ../../scripts/whatsapp_test_local.py" in makefile, "both scripts are linted"


def load(name: str) -> Any:
    spec = importlib.util.spec_from_file_location(name, ROOT / "scripts" / f"{name}.py")
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    sys.path.insert(0, str(ROOT / "scripts"))
    spec.loader.exec_module(module)
    return module


def test_the_helper_refuses_a_hosted_database_or_api_before_any_call(monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]) -> None:
    helper = load("whatsapp_test_local")
    monkeypatch.setenv("SUPABASE_URL", "https://abcdefgh.supabase.co")
    monkeypatch.setenv("SME_STACK", "agent")
    monkeypatch.setattr(helper.httpx, "Client", lambda *a, **k: pytest.fail("no connection may be made"))
    assert helper.main(["status"]) == 1
    assert "Refusing to run" in capsys.readouterr().err


def test_the_helper_sends_names_never_a_token_and_has_its_own_account() -> None:
    text = (ROOT / "scripts" / "whatsapp_test_local.py").read_text()
    assert '"token_ref": TOKEN_REF' in text and "meta_test" in text
    assert 'os.environ.get("WHATSAPP' not in text and "Bearer" not in text, "the helper never reads or sends a token"
    helper = load("whatsapp_test_local")
    assert helper.TEST_EMAIL != "demo-owner@demo.example.test" and helper.TEST_WORKSPACE_SLUG == "wa-test-local"
    channel = load("prepare_channel_agent")
    assert channel.CHANNEL_EMAIL.endswith("@system.example.test") and "Channel-Only-Local-Password-1!" in SCRIPT.read_text()
