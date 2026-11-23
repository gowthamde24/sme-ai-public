"""deploy/prod-google-setup.sh and deploy/prod-secrets-prompt.sh (21-23 Nov 2026): with a fake `gcloud` that logs every call, the dry run and the --check run change NOTHING and print what they would do; a wrong project or billing off is refused; a real run never puts a secret on a command line. Nothing real is contacted."""

# ruff: noqa: E501

from __future__ import annotations

import os
import stat
import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[3]
CHANGING = ("services enable", "repositories create", "service-accounts create", "add-iam-policy-binding", "buckets create", "secrets create", "budgets create")


def fake_gcloud(tmp: Path, *, number: str = "488341211094", billing: str = "True", existing: str = "") -> tuple[dict[str, str], Path]:
    bin_dir, log = tmp / "bin", tmp / "gcloud.log"
    bin_dir.mkdir()
    (bin_dir / "gcloud").write_text(
        "#!/bin/sh\n"
        f'echo "$*" >> "{log}"\n'
        f'case "$*" in\n'
        f'  *"secrets create"*) cat > /dev/null; exit 0;;\n'
        f'  "projects describe"*) echo {number}; exit 0;;\n'
        f'  "billing projects describe"*) echo {billing}; exit 0;;\n'
        f'  *"{existing}"*) [ -n "{existing}" ] && exit 0;;\n'
        f"esac\n"
        # a "describe" of anything else says: not there yet; every other call succeeds quietly
        'case "$*" in *describe*) exit 1;; esac\nexit 0\n'
    )
    (bin_dir / "gcloud").chmod(0o755 | stat.S_IEXEC)
    env = {k: v for k, v in os.environ.items()}
    env["PATH"] = f"{bin_dir}:{env['PATH']}"
    return env, log


def run(script: str, env: dict[str, str], *args: str, stdin: str = "") -> subprocess.CompletedProcess[str]:
    return subprocess.run(["bash", str(ROOT / "deploy" / script), *args], cwd=ROOT, env=env, input=stdin, capture_output=True, text=True, timeout=120, check=False)  # noqa: S603, S607


def test_the_google_setup_dry_run_prints_every_step_and_changes_nothing(tmp_path: Path) -> None:
    env, log = fake_gcloud(tmp_path)
    r = run("prod-google-setup.sh", env)
    assert r.returncode == 0, r.stderr
    out = r.stdout
    assert "DRY RUN" in out and "stack19-production" in out
    for needle in ("services enable", "artifacts repositories create sme", "sme-api-run", "sme-web-run", "sme-worker-run", "sme-tick", "sme-build", "roles/artifactregistry.writer", "roles/logging.logWriter", "budget-alerts.sh"):
        assert needle in out, needle
    assert "project-2757c07e" not in out, "never the staging project"
    ran = log.read_text()
    assert not any(c in ran for c in CHANGING), "a dry run reads, it never changes"


def test_the_google_setup_apply_runs_the_commands_and_skips_what_exists(tmp_path: Path) -> None:
    env, log = fake_gcloud(tmp_path, existing="sme-api-run@")
    r = run("prod-google-setup.sh", env, "--apply")
    assert r.returncode == 0, r.stderr
    assert "exists: sme-api-run" in r.stdout
    ran = log.read_text()
    assert "iam service-accounts create sme-web-run" in ran and "iam service-accounts create sme-api-run" not in ran


@pytest.mark.parametrize(("kw", "word"), [({"number": "999"}, "cannot read project"), ({"billing": "False"}, "billing is not enabled")])
def test_the_google_setup_refuses_a_wrong_project_or_billing_off(tmp_path: Path, kw: dict[str, str], word: str) -> None:
    env, log = fake_gcloud(tmp_path, **kw)
    r = run("prod-google-setup.sh", env, "--apply")
    assert r.returncode == 2 and word in r.stderr
    assert not any(c in log.read_text() for c in CHANGING)


def test_the_secrets_check_lists_and_asks_nothing(tmp_path: Path) -> None:
    env, log = fake_gcloud(tmp_path)
    r = run("prod-secrets-prompt.sh", env, "--check")
    assert r.returncode == 0, r.stderr
    for name in ("sme-suppression-hmac-key", "sme-scheduler-password", "sme-resend-api-key", "sme-anthropic-api-key", "sme-sarvam-api-key", "sme-cartesia-api-key", "sme-exotel-stream-secret", "sme-telephony-sandbox-numbers", "sme-plivo-auth-token", "sme-whatsapp-token"):
        assert f"MISSING  {name}" in r.stdout, name
    assert "required ones missing" in r.stdout
    assert not any(c in log.read_text() for c in CHANGING)


def test_the_secrets_prompt_generates_its_own_keys_and_a_typed_value_never_reaches_a_command_line(tmp_path: Path) -> None:
    env, log = fake_gcloud(tmp_path, existing="iam service-accounts describe")
    # the typed values and the typed values on stdin: the required prompts get a value, every optional one is skipped with Enter
    typed = "TYPED-SECRET-VALUE-1\nTYPED-SECRET-VALUE-2\nTYPED-SECRET-VALUE-3\nTYPED-SECRET-VALUE-4\nTYPED-SECRET-VALUE-5\n+919000000001\n\n\n\n\nn\n\n"
    r = run("prod-secrets-prompt.sh", env, stdin=typed)
    assert r.returncode == 0, r.stderr
    assert "created  sme-suppression-hmac-key  (generated" in r.stdout and "created  sme-exotel-stream-secret  (generated" in r.stdout
    assert "TYPED-SECRET-VALUE" not in r.stdout + r.stderr + log.read_text(), "a typed secret is never printed, logged or put on a command line"
    assert "skipped  sme-plivo-auth-id" in r.stdout
    ran = log.read_text()
    assert "secrets create sme-scheduler-password" in ran and "secretmanager.secretAccessor" in ran


def test_the_scheduler_account_is_created_pre_confirmed_and_never_leaks_its_values() -> None:
    import importlib.util

    spec = importlib.util.spec_from_file_location("prod_scheduler_account", ROOT / "deploy" / "prod_scheduler_account.py")
    assert spec is not None and spec.loader is not None
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    seen: list[tuple[str, dict[str, str], dict[str, object]]] = []

    def ok(url: str, headers: dict[str, str], body: dict[str, object]) -> tuple[int, str]:
        seen.append((url, headers, body))
        return 200, "{}"

    assert mod.create("ijmsusgyilwskpjxfauu", "KEY", "scheduler@stack19.com", "a-long-password-1", ok) == "created"
    url, headers, body = seen[0]
    assert url == "https://ijmsusgyilwskpjxfauu.supabase.co/auth/v1/admin/users" and body["email_confirm"] is True and body["email"] == "scheduler@stack19.com"
    assert headers["apikey"] == "KEY"
    assert mod.create("ijmsusgyilwskpjxfauu", "KEY", "scheduler@stack19.com", "a-long-password-1", lambda *a: (422, '{"msg":"A user with this email address has already been registered"}')) == "exists"
    assert mod.create("ijmsusgyilwskpjxfauu", "KEY", "scheduler@stack19.com", "a-long-password-1", lambda *a: (401, "no")) == "refused"
    assert mod.create("ijmsusgyilwskpjxfauu", "KEY", "scheduler@stack19.com", "short", ok) == "refused", "a weak password is refused before anything is sent"
    assert mod.create("bad ref!", "KEY", "scheduler@stack19.com", "a-long-password-1", ok) == "refused" and len(seen) == 1
