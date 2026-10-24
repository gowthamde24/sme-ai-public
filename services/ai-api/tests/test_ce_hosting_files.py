"""Job CE: the hosting files say what the code needs. The env-and-secrets runbook lists every setting of app/config.py with the right kind; the Dockerfiles run as a non-root user, stop on SIGTERM and carry no secret; the
deploy script's dry run sets what the API needs and refuses the unsafe combinations; the runbooks point only at files and make targets that exist. No Docker, no network."""

from __future__ import annotations

import os
import re
import subprocess
from pathlib import Path

import pytest

from app.config import Settings

ROOT = Path(__file__).resolve().parents[3]
DEPLOY = ROOT / "deploy"
ENV_DOC = ROOT / "docs" / "runbooks" / "hosting-env-and-secrets.md"
REHEARSAL = ROOT / "docs" / "runbooks" / "hosting-rehearsal-owner.md"
SCRIPT = DEPLOY / "cloudrun.sh"
ROW = re.compile(r"^\| `([A-Z][A-Z0-9_]+)` \| (secret|plain) \|", re.M)


def doc_rows(section: str) -> dict[str, str]:
    """name -> kind for the rows between the heading that starts with `section` and the next '## ' heading."""
    text = ENV_DOC.read_text()
    start = text.index(section)
    end = text.find("\n## ", start + 5)
    return {m.group(1): m.group(2) for m in ROW.finditer(text[start : end if end != -1 else len(text)])}


def api_rows() -> dict[str, str]:
    text = ENV_DOC.read_text()
    web = text.index("## The web (Cloud Run or Vercel)")
    return {m.group(1): m.group(2) for m in ROW.finditer(text[:web])}


# ------------------------------------------------------------------------------------------------------------------------ the env and secrets list
def test_every_setting_of_the_api_is_in_the_list_and_nothing_else() -> None:
    fields = {name.upper(): f for name, f in Settings.model_fields.items()}
    listed = api_rows()
    assert set(listed) - set(fields) == set(), "the list names a setting the code does not have"
    assert set(fields) - set(listed) == set(), "a setting of app/config.py is missing from hosting-env-and-secrets.md"


def test_a_secret_in_the_code_is_a_secret_in_the_list_and_only_those() -> None:
    secrets_in_code = {name.upper() for name, f in Settings.model_fields.items() if "SecretStr" in str(f.annotation)}
    secrets_listed = {n for n, kind in api_rows().items() if kind == "secret"}
    assert secrets_listed == secrets_in_code


def test_every_variable_the_web_reads_at_build_or_run_time_is_in_the_list() -> None:
    names = set()
    for path in (ROOT / "apps" / "web").rglob("*"):
        if path.suffix not in (".ts", ".tsx") or "node_modules" in path.parts or ".next" in path.parts or ".test." in path.name:
            continue
        if "test" in path.parts or "scripts" in path.parts or "e2e" in path.parts:
            continue
        names |= set(re.findall(r"process\.env\.([A-Z][A-Z0-9_]+)", path.read_text(errors="ignore")))
    web = doc_rows("## The web (Cloud Run or Vercel)")
    assert names - {"UPDATE_GOLDEN"} <= set(web), sorted(names - set(web))
    assert set(web) - names <= {"PUBLIC_LAUNCH_REQUIRES_REVIEWED", "NEXT_PUBLIC_SUPABASE_ANON_KEY", "TZ"}  # read by a build script, by name in a loop, and the optional zone
    assert all(kind == "plain" for kind in web.values()), "the web has no server secret"


def test_the_list_holds_no_value_that_looks_like_a_key() -> None:
    text = ENV_DOC.read_text() + (DEPLOY / "hosting.env.example").read_text()
    assert not re.search(r"(sk-[A-Za-z0-9]{20,}|eyJ[A-Za-z0-9_-]{20,}\.|AIza[0-9A-Za-z_-]{30,}|sb_secret_[A-Za-z0-9]+|-----BEGIN)", text)


def test_the_example_env_file_names_only_known_settings_and_gives_no_secret_a_value() -> None:
    known = {n.upper() for n in Settings.model_fields} | set(doc_rows("## The web (Cloud Run or Vercel)"))
    deploy_vars = {"PROJECT_ID", "REGION", "WEB_ORIGIN", "API_URL", "CPU_ALWAYS", "RUN_SA", "SITE_LIVE", "SCHEDULER_SA", "WORKER_EVERY_MINUTES", "BACKUP_DB_HOST", "BACKUP_DB_USER", "SECRET_SUPPRESSION", "SECRET_SCHEDULER", "EXTRA_SECRETS", "HOSTED_SUPABASE_URL"}
    for line in (DEPLOY / "hosting.env.example").read_text().splitlines():
        m = re.match(r"^([A-Z][A-Z0-9_]+)=(.*)$", line)
        if not m:
            continue
        name = m.group(1)
        assert name in known | deploy_vars, f"{name} is not a setting of the API, the web or the deploy script"
        if name in {n.upper() for n, f in Settings.model_fields.items() if "SecretStr" in str(f.annotation)}:
            assert m.group(2).split("#")[0].strip() == "", f"{name} is a secret and has a value in the example"


# ------------------------------------------------------------------------------------------------------------------------ the images
def test_the_api_image_runs_as_a_numeric_non_root_user_and_stops_cleanly() -> None:
    text = (DEPLOY / "Dockerfile.api").read_text()
    assert re.search(r"^USER 10001$", text, re.M)
    assert "--uid 10001" in text and "nologin" in text
    cmd = re.search(r"^CMD (.*)$", text, re.M).group(1)  # type: ignore[union-attr]
    assert "exec uvicorn" in cmd, "uvicorn must be process 1 to get SIGTERM"
    graceful = int(re.search(r"--timeout-graceful-shutdown (\d+)", cmd).group(1))  # type: ignore[union-attr]
    assert 1 <= graceful < 10, "Cloud Run waits 10 seconds after SIGTERM"
    assert "--no-proxy-headers" in cmd and "--forwarded-allow-ips" not in cmd, "a forged X-Forwarded-For must not change the caller (the API reads the header itself, as far as TRUSTED_PROXY_HOPS says)"
    assert "HEALTHCHECK" in text and "/health" in text
    assert "python -m app.scheduler.worker" in text, "the same image must be documented as the worker's"


def test_no_image_bakes_in_a_secret_or_an_env_file() -> None:
    for name in ("Dockerfile.api", "Dockerfile.web"):
        text = (DEPLOY / name).read_text()
        env_lines = [line for line in text.splitlines() if re.match(r"^\s*(ENV|ARG)\b", line) or re.match(r"^\s+[A-Z_]+=", line)]
        for line in env_lines:
            assert not re.search(r"(SECRET|PASSWORD|PRIVATE|SERVICE_ROLE|HMAC|TOKEN|API_KEY)\w*=", line), f"{name}: {line.strip()}"
        assert not re.search(r"COPY .*\.env", text)
    ignore = (ROOT / ".dockerignore").read_text()
    assert "**/.env" in ignore and "!**/.env.example" in ignore


def test_the_web_image_takes_every_public_build_value_and_has_no_secret_argument() -> None:
    text = (DEPLOY / "Dockerfile.web").read_text()
    args = set(re.findall(r"^ARG (\w+)$", text, re.M))
    needed = {n for n in doc_rows("## The web (Cloud Run or Vercel)") if n.startswith("NEXT_PUBLIC_")}
    assert needed <= args, sorted(needed - args)
    assert all(a.startswith("NEXT_PUBLIC_") for a in args), "a build argument is visible in the image history: only public values may be one"
    # job DE: the final stage runs the traced standalone server as the unprivileged user, as process 1 (exec form), listening on every address (HOSTNAME=0.0.0.0, not Docker's container id)
    assert re.search(r"^USER node$", text, re.M) and 'CMD ["node", "apps/web/server.js"]' in text
    assert "NEXT_OUTPUT=standalone" in text and "HOSTNAME=0.0.0.0" in text and ".next/standalone" in text and ".next/static" in text


def test_the_dockerignore_keeps_the_context_small_and_free_of_local_files() -> None:
    ignore = (ROOT / ".dockerignore").read_text().split()
    for entry in ("**/node_modules", "**/.venv", "**/.git", "supabase", "tests", ".claude"):
        assert entry in ignore


# ------------------------------------------------------------------------------------------------------------------------ the deploy script (dry run: it prints, runs nothing)
BASE_ENV = {
    "PATH": os.environ.get("PATH", ""),
    "PROJECT_ID": "sme-test-1",
    "SUPABASE_URL": "https://abc.supabase.co",
    "SUPABASE_PUBLISHABLE_KEY": "publishable-for-tests",
    "WEB_ORIGIN": "https://app.example.test",
    "API_URL": "https://api.example.test",
    "SCHEDULER_EMAIL": "scheduler@example.test",
    "SCHEDULER_SA": "tick@sme-test-1.iam.gserviceaccount.com",
}


def dry(what: str, **env: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(["bash", str(SCRIPT), what], env={**BASE_ENV, **env}, capture_output=True, text=True, timeout=60, check=False)  # noqa: S603, S607


def flat(out: str) -> str:
    return out.replace("\\,", ",")


def test_the_api_deploy_sets_what_the_hosted_api_needs_and_runs_nothing() -> None:
    r = dry("api", RUN_SA="run@sme-test-1.iam.gserviceaccount.com")
    assert r.returncode == 0 and "dry run: nothing was run" in r.stdout
    out = flat(r.stdout)
    for needed in ("API_ENV=production", "LOG_FORMAT=json", "TRUSTED_PROXY_HOPS=1", "API_CORS_ORIGINS=https://app.example.test", "AGENTS_ENABLED=false", "SUPABASE_JWT_ALGORITHMS=ES256", "--service-account run@sme-test-1.iam.gserviceaccount.com", "--startup-probe=httpGet.path=/health", "--set-secrets SUPPRESSION_HMAC_KEY=sme-suppression-hmac-key:latest"):
        assert needed in out, needed
    assert "publishable-for-tests" in out  # the public key is passed as a plain value ...
    assert not re.search(r"(PASSWORD|SECRET|SERVICE_ROLE)\w*=[^ ]", out.replace("SUPPRESSION_HMAC_KEY=sme-suppression", ""))  # ... and nothing secret is


def test_the_api_deploy_refuses_agents_without_cpu_always_and_a_non_https_origin() -> None:
    assert dry("api", AGENTS_ENABLED="true").returncode == 2
    assert dry("api", WEB_ORIGIN="http://app.example.test").returncode == 2
    assert dry("api", SUPABASE_URL="http://abc.supabase.co").returncode == 2


def test_the_worker_schedule_and_the_workers_interval_are_one_setting() -> None:
    default = flat(dry("worker").stdout)
    assert "SCHEDULER_INTERVAL_SECONDS=300" in default
    assert re.search(r"--schedule \\?\*/5\\? ", dry("worker").stdout)
    two = dry("worker", WORKER_EVERY_MINUTES="2")
    assert "SCHEDULER_INTERVAL_SECONDS=120" in flat(two.stdout) and re.search(r"--schedule \\?\*/2\\? ", two.stdout)
    for bad in ("0", "60", "x", "1.5", "-1"):
        assert dry("worker", WORKER_EVERY_MINUTES=bad).returncode == 2, bad
    worker = flat(dry("worker").stdout)
    assert "OUTBOX_ADAPTER=fake" in worker and "--set-secrets SCHEDULER_PASSWORD=sme-scheduler-password:latest,SUPPRESSION_HMAC_KEY=sme-suppression-hmac-key:latest" in worker
    assert "AGENTS_ENABLED" not in worker and "API_CORS_ORIGINS" not in worker, "the worker gets no more than it needs"


def test_the_web_build_gets_the_public_values_and_the_site_address() -> None:
    out = flat(dry("web").stdout)
    # the default build is Cloud Build (job DC): the public values travel as substitutions into deploy/cloudbuild-web.yaml, which passes them as the same build arguments
    for needed in ("_API_URL=https://api.example.test", "_SUPABASE_URL=https://abc.supabase.co", "_SITE_URL=https://app.example.test", "--startup-probe=httpGet.path=/login"):
        assert needed in out, needed
    built = (ROOT / "deploy" / "cloudbuild-web.yaml").read_text()
    for arg in ("NEXT_PUBLIC_API_BASE_URL=${_API_URL}", "NEXT_PUBLIC_SUPABASE_URL=${_SUPABASE_URL}", "NEXT_PUBLIC_SITE_URL=${_SITE_URL}", "NEXT_PUBLIC_SITE_LIVE=0"):
        assert arg in built, arg
    local = flat(dry("web", BUILD="docker").stdout)
    for needed in ("NEXT_PUBLIC_API_BASE_URL=https://api.example.test", "NEXT_PUBLIC_SUPABASE_URL=https://abc.supabase.co", "NEXT_PUBLIC_SITE_URL=https://app.example.test", "NEXT_PUBLIC_SITE_LIVE=0"):
        assert needed in local, needed


def test_the_secrets_step_never_prints_or_takes_a_value_on_a_command_line() -> None:
    r = dry("secrets")
    assert r.returncode == 0
    assert "--data-file=-" in r.stdout and "value on stdin" in r.stdout
    assert not re.search(r"--data[^-]|--value|echo ", r.stdout)


# ------------------------------------------------------------------------------------------------------------------------ the runbooks point at things that exist
@pytest.mark.parametrize("doc", [REHEARSAL, ENV_DOC, ROOT / "docs" / "runbooks" / "hosting-owner-runbook.md"])
def test_a_runbook_names_only_files_and_make_targets_that_exist(doc: Path) -> None:
    text = doc.read_text()
    for ref in set(re.findall(r"`((?:deploy|scripts|docs|supabase|services|apps)/[A-Za-z0-9_./-]+\.[A-Za-z0-9]+)`", text)):
        if any(ch in ref for ch in "<>*"):
            continue
        assert (ROOT / ref).exists(), f"{doc.name}: {ref}"
    makefile = (ROOT / "Makefile").read_text()
    for target in set(re.findall(r"(?:`|^|\$ )make ([a-z][a-z-]+)", text, re.M)):
        assert re.search(rf"^{re.escape(target)}:", makefile, re.M), f"{doc.name}: make {target}"
    for link in set(re.findall(r"\]\(([A-Za-z0-9_./-]+\.md)(?:#[^)]*)?\)", text)):
        assert (doc.parent / link).exists(), f"{doc.name}: link {link}"


def test_the_rehearsal_runbook_starts_with_the_budget_alert_and_marks_cards_and_teardown() -> None:
    text = REHEARSAL.read_text()
    assert text.index("SET THE BUDGET ALERT NOW") < text.index("gcloud projects create") < text.index("Part 9. Tear it all down")
    assert "10 EUR" in text and "[CARD]" in text and "[NO CARD]" in text and "[COMPANY?]" in text
    assert "SYNTHETIC" in text and "gcloud projects delete" in text and "make hosted-smoke" in text
    assert "Never copy the `service_role` or secret key anywhere" in text
