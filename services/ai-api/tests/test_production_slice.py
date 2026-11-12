# ruff: noqa: E501
"""PROD_SLICE=waitlist (owner, 12 Nov 2026; docs/runbooks/production-waitlist-slice.md, step 0).

deploy/production.sh runs as a DRY RUN (its default) with a fake `gcloud` and `supabase` on the PATH: nothing real is contacted, nothing is built. What the slice prints is what it would run: the API from the declared files (agents off, telephony off, scale to zero, two secrets), refusing to run without an explicit PRIVACY_VERSION."""

from __future__ import annotations

import os
import stat
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
SLICE_DIR = ROOT / "deploy" / "settings" / "production-waitlist"

ENV_FILE = """PROD_PROJECT_ID=prod-project-test
PROD_PROJECT_NUMBER=111222333
PROD_SUPABASE_REF=prodrefabcdefghij
PROD_WEB_ORIGIN=https://app.example.test
PROD_MAIL_DOMAIN=example.test
PROD_SCHEDULER_EMAIL=scheduler@example.test
"""


def tools(tmp: Path) -> dict[str, str]:
    bin_dir = tmp / "bin"
    bin_dir.mkdir(exist_ok=True)
    # gcloud: the API service does not exist yet (the very first revision); every other call succeeds quietly. supabase: the public key list.
    (bin_dir / "gcloud").write_text('#!/bin/sh\nif [ "$1 $2 $3" = "run services describe" ]; then exit 1; fi\nexit 0\n')
    (bin_dir / "supabase").write_text('#!/bin/sh\necho \'[{"type":"publishable","api_key":"sb_publishable_testkey"}]\'\n')
    for f in bin_dir.iterdir():
        f.chmod(f.stat().st_mode | stat.S_IEXEC)
    (tmp / "env.production").write_text(ENV_FILE)
    env = {k: v for k, v in os.environ.items() if not k.startswith(("PROD_", "PRIVACY_VERSION", "API_SETTINGS_DIR"))}
    env.update(PATH=f"{bin_dir}:{env['PATH']}", PROD_ENV_FILE=str(tmp / "env.production"))
    return env


def run(tmp: Path, *args: str, **extra: str) -> subprocess.CompletedProcess[str]:
    env = tools(tmp)
    env.update(extra)
    return subprocess.run(["bash", str(ROOT / "deploy" / "production.sh"), *args], cwd=ROOT, env=env, capture_output=True, text=True, timeout=120, check=False)  # noqa: S603, S607


def test_the_slice_refuses_to_run_without_an_explicit_privacy_version(tmp_path: Path) -> None:
    done = run(tmp_path, "deploy", "api", PROD_SLICE="waitlist")
    assert done.returncode != 0 and "PRIVACY_VERSION" in done.stderr and "gcloud run deploy" not in done.stdout


def test_the_slice_dry_run_deploys_the_api_from_the_declared_files_only(tmp_path: Path) -> None:
    done = run(tmp_path, "deploy", "api", PROD_SLICE="waitlist", PRIVACY_VERSION="2026-11-v1")
    out = done.stdout
    assert done.returncode == 0, done.stderr + out
    assert "DRY RUN: nothing was changed" in out
    deploy = next(line for line in out.splitlines() if "gcloud run deploy sme-api" in line)
    for must in ("PRIVACY_VERSION=2026-11-v1", "AGENTS_ENABLED=false", "TELEPHONY_MODE=off", "TELEPHONY_OUTBOUND=false", "CAPTCHA_PROVIDER=turnstile", "API_ENV=production",
                 "SUPABASE_URL=https://prodrefabcdefghij.supabase.co", "SUPABASE_PUBLISHABLE_KEY=sb_publishable_testkey", "API_CORS_ORIGINS=https://app.example.test",
                 "SUPPRESSION_HMAC_KEY=sme-suppression-hmac-key:latest", "CAPTCHA_SECRET=sme-turnstile-secret:latest", "--min-instances 0", "--cpu-throttling", "--max-instances 1"):
        assert must in deploy, must
    for never in ("ANTHROPIC", "PLIVO", "EXOTEL", "SARVAM", "CARTESIA", "WHATSAPP", "--no-cpu-throttling", "staging", "TELEPHONY_MODE=sandbox", "TELEPHONY_MODE=live"):
        assert never not in deploy, never
    assert "--no-traffic" in deploy, "a dry run prints the form later deploys use; cloudrun.sh drops it only for the very first revision of a service that does not exist yet (Cloud Run refuses it)"


def test_the_slice_adds_the_public_sites_origin_to_the_cors_fence_when_given(tmp_path: Path) -> None:
    done = run(tmp_path, "deploy", "api", PROD_SLICE="waitlist", PRIVACY_VERSION="2026-11-v1", PROD_SITE_ORIGIN="https://site.example.test")
    deploy = next(line for line in done.stdout.splitlines() if "gcloud run deploy sme-api" in line).replace("\\", "")   # (the printed command shell-quotes commas)
    assert "API_CORS_ORIGINS=https://site.example.test,https://app.example.test" in deploy


def test_the_slice_has_no_app_web_and_an_unknown_slice_is_refused(tmp_path: Path) -> None:
    web = run(tmp_path, "deploy", "web", PROD_SLICE="waitlist", PRIVACY_VERSION="2026-11-v1")
    assert web.returncode != 0 and "does not include the app web" in web.stderr
    every = run(tmp_path, "deploy", "all", PROD_SLICE="waitlist", PRIVACY_VERSION="2026-11-v1")
    assert every.returncode == 0, every.stderr
    assert "gcloud run deploy sme-web" not in every.stdout and "gcloud run deploy sme-api" in every.stdout
    assert run(tmp_path, "preflight", PROD_SLICE="nonsense").returncode != 0


def test_the_slice_worker_carries_the_mail_key_and_no_speech_key(tmp_path: Path) -> None:
    done = run(tmp_path, "deploy", "worker", PROD_SLICE="waitlist", PRIVACY_VERSION="2026-11-v1")
    assert done.returncode == 0, done.stderr
    assert "sme-resend-api-key" in done.stdout and "sarvam" not in done.stdout.lower()


def test_the_declared_slice_files_hold_no_telephony_llm_or_vendor_secret() -> None:
    env = (SLICE_DIR / "api.env").read_text()
    secrets = (SLICE_DIR / "api.secrets").read_text()
    assert "TELEPHONY_MODE=off" in env and "AGENTS_ENABLED=false" in env and "TASKS_DIALER=\n" in env
    names = {line.split("=")[0] for line in secrets.splitlines() if line and not line.startswith("#")}
    assert names == {"SUPPRESSION_HMAC_KEY", "CAPTCHA_SECRET"}
    scale = (SLICE_DIR / "api.scale").read_text()
    assert "min_instances=0" in scale and "max_instances=1" in scale
