# ruff: noqa: E501
"""Job BG: the hosting scripts (deploy/cloudrun.sh, deploy/backup-db.sh) are dry runs by default, never print or pass a secret on a command line, and the API gets the suppression key it needs. A fake gcloud, docker
and pg_dump on the PATH record what they were asked; nothing real is contacted."""

from __future__ import annotations

import os
import re
import stat
import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[3]
CLOUDRUN = ROOT / "deploy" / "cloudrun.sh"
BACKUP = ROOT / "deploy" / "backup-db.sh"

PASSWORD = "Typed-Hidden-Value-123"


@pytest.fixture
def box(tmp_path: Path) -> dict[str, object]:
    """Fakes for gcloud, docker, git and pg_dump. Each appends its argv to calls.log and, when given stdin, its stdin to stdin.log."""
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir()
    calls = tmp_path / "calls.log"
    stdin = tmp_path / "stdin.log"
    for name in ("gcloud", "docker"):
        exe = bin_dir / name
        exe.write_text(
            "#!/bin/sh\n"
            f'echo "{name} $*" >> "{calls}"\n'
            # `gcloud secrets describe` says "not found" so the script creates; every other call succeeds. A call with --data-file=- stores what it was piped.
            'case "$*" in *"secrets describe"*) exit 1;; esac\n'
            f'case "$*" in *"--data-file=-"*) cat >> "{stdin}"; echo >> "{stdin}";; esac\n'
        )
        exe.chmod(exe.stat().st_mode | stat.S_IEXEC)
    pg = bin_dir / "pg_dump"
    pg.write_text(
        "#!/bin/sh\n"
        'if [ "$1" = "--version" ]; then echo "pg_dump (PostgreSQL) 17.2"; exit 0; fi\n'
        f'echo "pg_dump $*" >> "{calls}"\n'
        f'echo "PGPASSWORD=$PGPASSWORD" >> "{tmp_path}/pgenv.log"\n'
        'while [ $# -gt 0 ]; do if [ "$1" = "-f" ]; then echo "dump" > "$2"; fi; shift; done\n'
    )
    pg.chmod(pg.stat().st_mode | stat.S_IEXEC)
    env = {k: v for k, v in os.environ.items() if k not in ("PROJECT_ID", "SUPABASE_URL", "WEB_ORIGIN", "API_URL", "AGENTS_ENABLED", "CPU_ALWAYS", "BACKUP_DIR")}
    env["PATH"] = f"{bin_dir}:{env['PATH']}"
    env["HOME"] = str(tmp_path)
    return {"env": env, "calls": calls, "stdin": stdin, "tmp": tmp_path}


BASE = {"PROJECT_ID": "sme-test", "SUPABASE_URL": "https://abc.supabase.co", "SUPABASE_PUBLISHABLE_KEY": "pk-public", "WEB_ORIGIN": "https://web.example.run.app"}


def run(script: Path, args: list[str], box: dict[str, object], extra: dict[str, str] | None = None, stdin: str | None = None) -> subprocess.CompletedProcess[str]:
    env = {**box["env"], **(extra or {})}  # type: ignore[dict-item]
    return subprocess.run(["bash", str(script), *args], cwd=ROOT, env=env, input=stdin, capture_output=True, text=True, check=False, timeout=60)  # noqa: S603, S607


def calls(box: dict[str, object]) -> list[str]:
    path = box["calls"]
    assert isinstance(path, Path)
    return path.read_text().splitlines() if path.exists() else []


# ---------------------------------------------------------------------------------------------------------------------------- cloudrun.sh
def test_the_api_is_a_dry_run_by_default_in_mumbai_with_the_suppression_key_as_a_secret(box: dict[str, object]) -> None:
    result = run(CLOUDRUN, ["api"], box, BASE)
    assert result.returncode == 0, result.stderr
    assert calls(box) == [], "nothing runs without --execute"
    out = result.stdout
    assert "asia-south1" in out and "dry run" in out
    assert re.search(r"--set-secrets\s+SUPPRESSION_HMAC_KEY=sme-suppression-hmac-key:latest", out), "the API refuses to start in production without this key"
    assert "SUPABASE_JWT_ALGORITHMS=ES256" in out and "AGENTS_ENABLED=false" in out


def test_execute_runs_the_remote_build_and_the_deploy_in_order(box: dict[str, object]) -> None:
    """Job DC: the default build is Cloud Build (remote), not Docker on the laptop."""
    result = run(CLOUDRUN, ["api", "--execute"], box, {**BASE, "TAG": "t1"})
    assert result.returncode == 0, result.stderr
    kinds = [c.split()[0] + " " + c.split()[1] for c in calls(box)]
    assert kinds == ["gcloud builds", "gcloud run"]
    assert "--config deploy/cloudbuild-api.yaml" in calls(box)[0] and "_IMAGE=asia-south1-docker.pkg.dev/sme-test/sme/api:t1" in calls(box)[0]


def test_execute_with_build_docker_builds_on_this_machine(box: dict[str, object]) -> None:
    result = run(CLOUDRUN, ["api", "--execute"], box, {**BASE, "TAG": "t1", "BUILD": "docker"})
    assert result.returncode == 0, result.stderr
    kinds = [c.split()[0] + " " + c.split()[1] for c in calls(box)]
    assert kinds == ["docker build", "docker push", "gcloud run"]


def test_extra_secrets_are_added_as_references(box: dict[str, object]) -> None:
    out = run(CLOUDRUN, ["api"], box, {**BASE, "EXTRA_SECRETS": "ANTHROPIC_API_KEY=sme-anthropic-api-key:latest"}).stdout.replace("\\", "")  # the dry run prints shell-quoted words
    assert "SUPPRESSION_HMAC_KEY=sme-suppression-hmac-key:latest,ANTHROPIC_API_KEY=sme-anthropic-api-key:latest" in out


@pytest.mark.parametrize(
    ("extra", "message"),
    [
        ({"SUPABASE_URL": "http://abc.supabase.co"}, "non-https"),
        ({"WEB_ORIGIN": "http://web.example"}, "non-https"),
        ({"AGENTS_ENABLED": "true"}, "CPU_ALWAYS"),
    ],
)
def test_the_api_refuses_an_unsafe_setting(box: dict[str, object], extra: dict[str, str], message: str) -> None:
    result = run(CLOUDRUN, ["api", "--execute"], box, {**BASE, **extra})
    assert result.returncode == 2 and message in result.stderr
    assert calls(box) == []


def test_agents_need_the_cpu_always_and_then_a_warm_instance(box: dict[str, object]) -> None:
    out = run(CLOUDRUN, ["api"], box, {**BASE, "AGENTS_ENABLED": "true", "CPU_ALWAYS": "true"}).stdout
    assert "--no-cpu-throttling" in out and "--min-instances 1" in out and "AGENTS_ENABLED=true" in out


def test_the_web_needs_an_https_api_address(box: dict[str, object]) -> None:
    assert run(CLOUDRUN, ["web"], box, BASE).returncode != 0
    assert run(CLOUDRUN, ["web"], box, {**BASE, "API_URL": "http://api.example"}).returncode == 2
    out = run(CLOUDRUN, ["web"], box, {**BASE, "API_URL": "https://api.example.run.app"}).stdout
    assert "_API_URL=https://api.example.run.app" in out and "--config deploy/cloudbuild-web.yaml" in out and "sme-web" in out
    docker = run(CLOUDRUN, ["web"], box, {**BASE, "API_URL": "https://api.example.run.app", "BUILD": "docker"}).stdout
    assert "NEXT_PUBLIC_API_BASE_URL=https://api.example.run.app" in docker


def test_the_worker_is_a_job_started_by_the_scheduler_and_carries_no_password(box: dict[str, object]) -> None:
    extra = {**BASE, "SCHEDULER_EMAIL": "scheduler@example.test", "SCHEDULER_SA": "sa@sme-test.iam.gserviceaccount.com"}
    result = run(CLOUDRUN, ["worker"], box, extra)
    assert result.returncode == 0, result.stderr
    out = result.stdout
    assert calls(box) == []
    assert "run jobs deploy sme-worker" in out and "app.scheduler.worker" in out and "--once" in out
    assert "SCHEDULER_PASSWORD=sme-scheduler-password:latest" in out and "SUPPRESSION_HMAC_KEY=sme-suppression-hmac-key:latest" in out
    assert "OUTBOX_ADAPTER=fake" in out, "no real channel exists"
    assert "scheduler jobs create http sme-worker-tick" in out and "Asia/Kolkata" in out
    assert "--max-retries 0" in out
    for missing in ("SCHEDULER_EMAIL", "SCHEDULER_SA"):
        assert run(CLOUDRUN, ["worker"], box, {k: v for k, v in extra.items() if k != missing}).returncode != 0


def test_the_secrets_command_never_shows_or_passes_a_value(box: dict[str, object]) -> None:
    dry = run(CLOUDRUN, ["secrets"], box, {"PROJECT_ID": "sme-test"})
    assert dry.returncode == 0 and calls(box) == []
    result = run(CLOUDRUN, ["secrets", "--execute"], box, {"PROJECT_ID": "sme-test"}, stdin=PASSWORD + "\n")
    assert result.returncode == 0, result.stderr
    stored = Path(str(box["stdin"])).read_text().split()
    assert len(stored) == 2 and re.fullmatch(r"[0-9a-f]{64}", stored[0]) and stored[1] == PASSWORD
    everything = result.stdout + result.stderr + "\n".join(calls(box))
    assert PASSWORD not in everything, "the typed password must not appear in output or on any command line"
    assert stored[0] not in everything, "the generated key must not appear in output or on any command line"
    assert any("secrets create sme-suppression-hmac-key" in c for c in calls(box)) and any("secrets create sme-scheduler-password" in c for c in calls(box))


def test_an_empty_scheduler_password_stores_nothing(box: dict[str, object]) -> None:
    result = run(CLOUDRUN, ["secrets", "--execute"], box, {"PROJECT_ID": "sme-test"}, stdin="\n")
    assert result.returncode == 2 and "empty password" in result.stderr


def test_the_unknown_target_is_refused(box: dict[str, object]) -> None:
    result = run(CLOUDRUN, ["everything"], box, BASE)
    assert result.returncode == 2 and "usage" in result.stderr


# ---------------------------------------------------------------------------------------------------------------------------- backup-db.sh
BACKUP_ENV = {"BACKUP_DB_HOST": "aws-0-ap-south-1.pooler.supabase.com", "BACKUP_DB_USER": "postgres.abcdef"}


def test_the_backup_is_a_dry_run_by_default(box: dict[str, object]) -> None:
    result = run(BACKUP, [], box, BACKUP_ENV)
    assert result.returncode == 0 and calls(box) == []
    assert "dry run" in result.stdout and "<typed hidden>" in result.stdout


def test_the_backup_takes_the_password_hidden_and_only_through_the_environment_of_pg_dump(box: dict[str, object]) -> None:
    tmp = Path(str(box["tmp"]))
    result = run(BACKUP, ["--execute"], box, {**BACKUP_ENV, "BACKUP_DIR": str(tmp / "backups")}, stdin=PASSWORD + "\n")
    assert result.returncode == 0, result.stderr
    assert PASSWORD not in result.stdout + result.stderr + "\n".join(calls(box)), "never printed, never in argv"
    assert f"PGPASSWORD={PASSWORD}" in (tmp / "pgenv.log").read_text()
    [dump] = list((tmp / "backups").glob("sme-*.dump"))
    assert stat.S_IMODE(dump.stat().st_mode) == 0o600 and stat.S_IMODE(dump.parent.stat().st_mode) == 0o700


def test_the_backup_refuses_a_folder_inside_the_repository_and_odd_names(box: dict[str, object]) -> None:
    assert run(BACKUP, ["--execute"], box, {**BACKUP_ENV, "BACKUP_DIR": str(ROOT / "backups")}).returncode == 2
    assert run(BACKUP, [], box, {**BACKUP_ENV, "BACKUP_DB_HOST": "host; rm -rf /"}).returncode == 2
    assert run(BACKUP, [], box, {"BACKUP_DB_USER": "x"}).returncode != 0


def test_an_empty_backup_password_does_nothing(box: dict[str, object]) -> None:
    tmp = Path(str(box["tmp"]))
    result = run(BACKUP, ["--execute"], box, {**BACKUP_ENV, "BACKUP_DIR": str(tmp / "b2")}, stdin="\n")
    assert result.returncode == 2 and calls(box) == []


# ---------------------------------------------------------------------------------------------------------------------------- the files
def test_the_env_example_holds_names_only() -> None:
    text = (ROOT / "deploy" / "hosting.env.example").read_text()
    for line in text.splitlines():
        if line.startswith("#") or not line.strip():
            continue
        name, _, value = line.partition("=")
        value = value.split("#")[0].strip().strip("'\"")
        assert name.strip() and (value == "" or value in {"asia-south1", "false"} or "*" in value), f"{name} must not carry a value: {value!r}"
    for secret in ("SUPPRESSION_HMAC_KEY", "SCHEDULER_PASSWORD", "ANTHROPIC_API_KEY"):
        assert not re.search(rf"^{secret}=", text, re.M)


def test_the_runbook_points_only_at_things_that_exist() -> None:
    text = (ROOT / "docs" / "runbooks" / "hosting-owner-runbook.md").read_text()
    for path in ("deploy/cloudrun.sh", "deploy/backup-db.sh", "deploy/hosting.env.example", "scripts/verify_hosted.py", "supabase/hosted/verify.sql"):
        assert path in text and (ROOT / path).exists(), path
    for doc in re.findall(r"`([a-z0-9-]+\.md)`", text):
        assert (ROOT / "docs" / "runbooks" / doc).exists() or (ROOT / "docs" / "adr" / doc).exists() or (ROOT / "docs" / doc).exists(), doc
    assert text.count("[OWNER ONLY") >= 8, "the steps only the owner can do are marked"
    assert "Nothing here has been run" in text


def test_the_scripts_are_executable_and_pass_a_syntax_check() -> None:
    for script in (CLOUDRUN, BACKUP):
        assert os.access(script, os.X_OK)
        assert subprocess.run(["bash", "-n", str(script)], capture_output=True, check=False).returncode == 0  # noqa: S603, S607
