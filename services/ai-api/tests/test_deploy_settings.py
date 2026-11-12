# ruff: noqa: E501
"""Settings declared in the repository (owner, 12 Nov 2026; deploy/settings.py): the files, the arguments built from them, the drift check, the round trip from a revision, and the committed staging files."""

from __future__ import annotations

import importlib.util
import os
import re
import subprocess
import sys
from pathlib import Path
from types import ModuleType
from typing import Any

import pytest

ROOT = Path(__file__).resolve().parents[3]
DEPLOY = ROOT / "deploy"


def load(name: str) -> ModuleType:
    if str(DEPLOY) not in sys.path:
        sys.path.insert(0, str(DEPLOY))
    spec = importlib.util.spec_from_file_location(name, DEPLOY / f"{name}.py")
    assert spec is not None and spec.loader is not None
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


settings = load("settings")
guard = settings.flag_guard   # the SAME module object settings.py uses, so a patch here reaches it


def declare(tmp_path: Path, env: str = "", secrets: str = "", scale: str = "min_instances=1\nmax_instances=1\nconcurrency=80\n") -> Path:
    (tmp_path / "api.env").write_text(env)
    (tmp_path / "api.secrets").write_text(secrets)
    (tmp_path / "api.scale").write_text(scale)
    return tmp_path


def revision(env: list[dict[str, Any]], min_scale: str = "1", max_scale: str = "1", concurrency: int = 80) -> dict[str, Any]:
    return {"metadata": {"annotations": {"autoscaling.knative.dev/minScale": min_scale, "autoscaling.knative.dev/maxScale": max_scale}}, "spec": {"containerConcurrency": concurrency, "containers": [{"env": env}]}}


SECRET = {"valueFrom": {"secretKeyRef": {"name": "sme-anthropic-api-key", "key": "latest"}}}


# ------------------------------------------------------------------------------------------------------------------------------- the files
def test_comments_and_blank_lines_are_ignored_and_a_value_may_hold_a_comma_or_an_equals_sign(tmp_path: Path) -> None:
    d = declare(tmp_path, "# a comment\n\nA=1\nB=x,y=z\nEMPTY=\n")
    assert settings.declared_env(d) == {"A": "1", "B": "x,y=z", "EMPTY": ""}
    assert settings.env_arg(d) == "^|^A=1|B=x,y=z|EMPTY=", "the ^|^ form: a comma inside a value survives gcloud"


@pytest.mark.parametrize("text", ["A=1\nA=2\n", "A=x|y\n", "a_lower=1\n", "NOEQUALS\n", "A= padded\n"])
def test_a_bad_line_stops_the_deploy_before_anything_is_built(tmp_path: Path, text: str) -> None:
    with pytest.raises(SystemExit):
        settings.declared_env(declare(tmp_path, text))


def test_secrets_are_references_only_and_default_to_latest(tmp_path: Path) -> None:
    d = declare(tmp_path, secrets="ANTHROPIC_API_KEY=sme-anthropic-api-key\nB_KEY=sme-b:3\n")
    assert settings.refs_arg(d) == "ANTHROPIC_API_KEY=sme-anthropic-api-key:latest,B_KEY=sme-b:3"
    flags = settings.declared_flags(d)
    assert flags["ANTHROPIC_API_KEY"] == "secret:sme-anthropic-api-key:latest" and flags["B_KEY"] == "secret:sme-b:3"


def test_the_scale_file_gives_shell_assignments_and_unknown_keys_are_refused(tmp_path: Path) -> None:
    assert settings.declared_scale(declare(tmp_path)) == {"min_instances": 1, "max_instances": 1, "concurrency": 80}
    out = subprocess.run([sys.executable, str(DEPLOY / "settings.py"), "scale", str(tmp_path)], capture_output=True, text=True, check=True).stdout.strip()  # noqa: S603
    assert out == "MIN_INSTANCES=1 API_MAX_INSTANCES=1 API_CONCURRENCY=80"
    bad = tmp_path / "bad"
    bad.mkdir()
    with pytest.raises(SystemExit):
        settings.declared_scale(declare(bad, scale="warp=9\n"))


def test_a_local_value_comes_from_the_untracked_file_and_is_never_in_the_tracked_one(tmp_path: Path) -> None:
    d = declare(tmp_path, "NUMBER=@local:NUMBER\n")
    with pytest.raises(SystemExit):   # not in git, so a machine without the file refuses instead of deploying an empty value
        settings.declared_env(d)
    (d / "api.local.env").write_text("NUMBER=+91 1\n")
    assert settings.declared_env(d) == {"NUMBER": "+91 1"}
    assert "+91" not in (d / "api.env").read_text()


def test_an_env_value_comes_from_the_deploy_environment_and_a_missing_one_refuses(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    d = declare(tmp_path, "KEY=@env:SOME_PUBLIC_KEY\n")
    monkeypatch.delenv("SOME_PUBLIC_KEY", raising=False)
    with pytest.raises(SystemExit):
        settings.declared_env(d)
    monkeypatch.setenv("SOME_PUBLIC_KEY", "value-from-env")
    assert settings.declared_env(d) == {"KEY": "value-from-env"}
    assert "value-from-env" not in (d / "api.env").read_text()
    settings.write_snapshot(revision([{"name": "KEY", "value": "value-from-env"}]), d, {"KEY": "@env:SOME_PUBLIC_KEY"})
    assert "KEY=@env:SOME_PUBLIC_KEY" in (d / "api.env").read_text(), "a re-snapshot keeps the placeholder"


def test_a_worker_job_value_is_read_at_deploy_time(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(settings, "worker_value", lambda project, region, name: f"from-worker-{name}-{project}-{region}")
    d = declare(tmp_path, "FENCE=@worker-job:FENCE\n")
    assert settings.declared_env(d, "p", "r") == {"FENCE": "from-worker-FENCE-p-r"}


# ------------------------------------------------------------------------------------------------------------------------------- the round trip and the drift check
LIVE = revision([{"name": "A", "value": "1"}, {"name": "EMPTY"}, {"name": "ANTHROPIC_API_KEY", **SECRET}, {"name": "FENCE", "value": "919000000000"}])


def test_a_snapshot_of_a_revision_checks_clean_against_that_revision_including_empty_settings(tmp_path: Path) -> None:
    settings.write_snapshot(LIVE, tmp_path, {})
    assert (tmp_path / "api.env").read_text().splitlines()[1:] == ["A=1", "EMPTY=", "FENCE=919000000000"]
    assert (tmp_path / "api.secrets").read_text().splitlines()[1:] == ["ANTHROPIC_API_KEY=sme-anthropic-api-key"]
    assert settings.declared_flags(tmp_path) == guard.flags_of(LIVE), "what is declared is exactly what runs"


def test_a_snapshot_keeps_the_placeholders_that_were_already_in_the_file(tmp_path: Path) -> None:
    settings.write_snapshot(LIVE, tmp_path, {"FENCE": "@worker-job:FENCE"})
    assert "FENCE=@worker-job:FENCE" in (tmp_path / "api.env").read_text()
    assert "919000000000" not in (tmp_path / "api.env").read_text()


def fake_cloud(monkeypatch: pytest.MonkeyPatch, live: dict[str, Any]) -> None:
    monkeypatch.setattr(guard, "describe", lambda p, r, s: {"status": {"traffic": [{"revisionName": "rev-1", "percent": 100}], "latestCreatedRevisionName": "rev-1"}})
    monkeypatch.setattr(guard, "describe_revision", lambda p, r, n: live)


def run_check(tmp_path: Path, *extra: str) -> int:
    return int(settings.main(["settings.py", "check", "p", "r", "sme-api", str(tmp_path), *extra]))


def test_a_hand_edit_in_the_console_is_found_before_anything_is_built(tmp_path: Path, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]) -> None:
    settings.write_snapshot(LIVE, tmp_path, {"FENCE": "@worker-job:FENCE"})
    monkeypatch.setattr(settings, "worker_value", lambda p, r, n: "919000000000")
    fake_cloud(monkeypatch, LIVE)
    assert run_check(tmp_path) == 0
    edited = revision([{"name": "A", "value": "2"}, {"name": "EMPTY"}, {"name": "ANTHROPIC_API_KEY", **SECRET}, {"name": "FENCE", "value": "919000000000"}, {"name": "NEW_FLAG", "value": "on"}], min_scale="0")
    fake_cloud(monkeypatch, edited)
    assert run_check(tmp_path) == 3
    err = capsys.readouterr().err
    assert "A: 1 -> 2" in err and "NEW_FLAG: <unset> -> on" in err and "@minScale: 1 -> 0" in err


def test_a_change_meant_for_this_deploy_is_named_and_everything_else_still_stops(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    settings.write_snapshot(LIVE, tmp_path, {"FENCE": "@worker-job:FENCE"})
    monkeypatch.setattr(settings, "worker_value", lambda p, r, n: "919000000000")
    (tmp_path / "api.env").write_text((tmp_path / "api.env").read_text().replace("A=1", "A=5"))   # the pull request that changes A
    fake_cloud(monkeypatch, LIVE)
    assert run_check(tmp_path) == 3
    assert run_check(tmp_path, "--allow", "A") == 0
    assert run_check(tmp_path, "--allow", "SOMETHING_ELSE") == 3


# ------------------------------------------------------------------------------------------------------------------------------- the deploy scripts and the committed files
def dry_api(settings_dir: Path, extra: dict[str, str] | None = None) -> str:
    env = {**os.environ, "PROJECT_ID": "sme-test", "REGION": "asia-south1", "SUPABASE_URL": "https://abc.supabase.co", "SUPABASE_PUBLISHABLE_KEY": "pk", "WEB_ORIGIN": "https://web.example.test",
           "AGENTS_ENABLED": "true", "CPU_ALWAYS": "true", "API_SETTINGS_DIR": str(settings_dir), **(extra or {})}
    return subprocess.run(["bash", str(DEPLOY / "cloudrun.sh"), "api"], cwd=ROOT, env=env, capture_output=True, text=True, check=True, timeout=60).stdout  # noqa: S603, S607


def test_the_api_deploy_applies_exactly_the_declared_files(tmp_path: Path) -> None:
    d = declare(tmp_path, "ONLY_THIS=1\nSECOND=a,b\n", "KEY_ONE=sme-one\n", "min_instances=2\nmax_instances=3\nconcurrency=40\n")
    out = dry_api(d, {"EXTRA_ENV": "SHELL_LEAK=1", "TELEPHONY_INBOUND": "1", "NO_TRAFFIC": "1"}).replace("\\", "")   # the dry run prints a command, with a backslash before a comma
    assert "--update-env-vars" in out and "ONLY_THIS=1" in out and "SECOND=a,b" in out
    assert "SHELL_LEAK" not in out and "API_CORS_ORIGINS" not in out, "nothing from the shell of whoever runs the deploy, nothing the files do not say"
    assert "KEY_ONE=sme-one:latest" in out and "SUPPRESSION_HMAC_KEY" not in out
    assert "--min-instances 2" in out and "--max-instances 3" in out and "--concurrency 40" in out and "--no-traffic" in out
    assert "--set-env-vars" not in out and "--set-secrets" not in out


def test_without_a_settings_dir_the_old_composition_still_works_for_production_until_its_files_exist() -> None:
    env = {**os.environ, "PROJECT_ID": "sme-test", "SUPABASE_URL": "https://abc.supabase.co", "SUPABASE_PUBLISHABLE_KEY": "pk", "WEB_ORIGIN": "https://web.example.test", "AGENTS_ENABLED": "true", "CPU_ALWAYS": "true"}
    env.pop("API_SETTINGS_DIR", None)
    out = subprocess.run(["bash", str(DEPLOY / "cloudrun.sh"), "api"], cwd=ROOT, env=env, capture_output=True, text=True, check=True, timeout=60).stdout  # noqa: S603, S607
    assert "API_CORS_ORIGINS=https://web.example.test" in out and "SUPPRESSION_HMAC_KEY=" in out


def test_the_committed_staging_files_parse_and_hold_no_phone_number_and_no_secret_value() -> None:
    folder = DEPLOY / "settings" / "staging"
    env = settings.parse_pairs(folder / "api.env")
    assert env and settings.declared_scale(folder) == {"min_instances": 1, "max_instances": 1, "concurrency": 80}
    for name, value in env.items():
        assert not re.search(r"(?<![\w-])\+?\d{10,13}(?![\w-])", value), f"{name}: a phone number must not be in git (use @local: or @worker-job:)"
        assert not re.search(r"sk[-_](live|test|ant)|sb_(publishable|secret)_|eyJ[A-Za-z0-9_-]{20,}|-----BEGIN", value), f"{name}: looks like a secret"
    secrets = settings.parse_pairs(folder / "api.secrets")
    assert secrets and all(re.fullmatch(r"sme-[a-z0-9-]+(:[a-z0-9]+)?", v) for v in secrets.values()), "api.secrets holds secret NAMES only"
    assert not set(env) & set(secrets), "a name is a plain setting or a secret, never both"


def test_staging_sh_reads_its_api_settings_from_the_files_and_no_script_replaces_an_environment() -> None:
    text = "\n".join(line for line in (DEPLOY / "staging.sh").read_text().splitlines() if not line.lstrip().startswith("#"))
    assert 'API_SETTINGS_DIR="deploy/settings/staging"' in text
    for old in ("TELEPHONY_INBOUND", "LIVE_MODE", "(?<![A-Z_])EXTRA_ENV", "can_read"):
        assert not re.search(old, text), f"{old}: the shell composition of API settings is gone"
