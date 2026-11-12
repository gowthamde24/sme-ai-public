# ruff: noqa: E501
"""12 Nov 2026: a staging API deploy replaced the whole environment (22 telephony settings and the warm instance lost) and the new revision already had all the traffic when the check ran.

Now: settings are only updated (cloudrun.sh), the new revision is made WITHOUT traffic, deploy/flag_guard.py compares it with the revision that serves, and only a clean one gets the traffic (deploy/api_guard.sh).
A fake `gcloud` that answers from a scenario file stands in for Cloud Run; nothing real is contacted."""

from __future__ import annotations

import importlib.util
import json
import os
import stat
import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[3]
CLOUDRUN = ROOT / "deploy" / "cloudrun.sh"

_spec = importlib.util.spec_from_file_location("flag_guard", ROOT / "deploy" / "flag_guard.py")
assert _spec is not None and _spec.loader is not None
guard = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(guard)


def revision(env: dict[str, str], *, min_scale: str = "1") -> dict[str, object]:
    return {"metadata": {"annotations": {"autoscaling.knative.dev/minScale": min_scale, "autoscaling.knative.dev/maxScale": "1"}}, "spec": {"containers": [{"env": [{"name": k, "value": v} for k, v in env.items()]}]}}


def service(serving: str, created: str, template_env: dict[str, str]) -> dict[str, object]:
    return {
        "spec": {"template": {"metadata": {"annotations": {}}, "spec": {"containers": [{"env": [{"name": k, "value": v} for k, v in template_env.items()]}]}}},
        "status": {"traffic": [{"revisionName": serving, "percent": 100}], "latestCreatedRevisionName": created, "latestReadyRevisionName": created},
    }


LIVE = {"TELEPHONY_MODE": "sandbox", "TELEPHONY_OUTBOUND": "true", "PAGE_MAX_INFLIGHT": "12"}


# ------------------------------------------------------------------------------------------------------------------------------- flag_guard
def test_the_settings_checked_are_those_of_the_revision_that_serves_not_the_service_template() -> None:
    """After a rollback the template is still the newest revision's (here: the one that lost the telephony settings); the baseline must be the revision with the traffic."""
    svc = service("sme-api-00157", "sme-api-00158", {"PAGE_MAX_INFLIGHT": "12"})
    assert guard.serving_revision(svc) == "sme-api-00157"
    assert guard.created_revision(svc) == "sme-api-00158"
    assert guard.flags_of(revision(LIVE)) == {**LIVE, "@minScale": "1", "@maxScale": "1"}   # a revision is read like a service


def test_the_largest_share_of_the_traffic_wins_and_a_service_without_a_split_falls_back_to_the_ready_revision() -> None:
    split = {"status": {"traffic": [{"revisionName": "a", "percent": 10}, {"revisionName": "b", "percent": 90}]}}
    assert guard.serving_revision(split) == "b"
    assert guard.serving_revision({"status": {"traffic": [], "latestReadyRevisionName": "z"}}) == "z"


def test_lost_telephony_settings_and_the_warm_instance_are_found_on_the_new_revision() -> None:
    before = guard.flags_of(revision(LIVE))
    after = guard.flags_of(revision({"PAGE_MAX_INFLIGHT": "12"}, min_scale=""))
    found = guard.differences(before, after, set())
    assert "TELEPHONY_MODE: sandbox -> <unset>" in found and "TELEPHONY_OUTBOUND: true -> <unset>" in found and "@minScale: 1 -> <empty>" in found
    assert guard.differences(before, after, {"TELEPHONY_MODE", "TELEPHONY_OUTBOUND", "API_MIN_INSTANCES"}) == []


# ------------------------------------------------------------------------------------------------------------------------------- api_guard.sh
@pytest.fixture
def cloud(tmp_path: Path) -> dict[str, object]:
    """A fake gcloud: `run services describe` and `run revisions describe NAME` answer from scenario.json; every call is logged; update-traffic is just logged."""
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir()
    scenario, log = tmp_path / "scenario.json", tmp_path / "gcloud.log"
    exe = bin_dir / "gcloud"
    exe.write_text(
        "#!/usr/bin/env python3\n"
        "import json, sys\n"
        f"scenario = json.load(open({str(scenario)!r}))\n"
        f"open({str(log)!r}, 'a').write(' '.join(sys.argv[1:]) + '\\n')\n"
        "a = sys.argv[1:]\n"
        "if a[:3] == ['run', 'services', 'describe']:\n"
        "    if scenario.get('service') is None: sys.exit(1)\n"
        "    print(json.dumps(scenario['service']))\n"
        "elif a[:3] == ['run', 'revisions', 'describe']:\n"
        "    print(json.dumps(scenario['revisions'][a[3]]))\n"
        "elif a[:3] == ['run', 'services', 'update-traffic']:\n"
        "    pass\n"
        "else:\n"
        "    sys.exit(0)\n"
    )
    exe.chmod(exe.stat().st_mode | stat.S_IEXEC)
    env = {**os.environ, "PATH": f"{bin_dir}:{os.environ['PATH']}", "HOME": str(tmp_path)}
    return {"env": env, "scenario": scenario, "log": log}


def run_guard(cloud: dict[str, object], scenario: dict[str, object], allow: str = "") -> tuple[subprocess.CompletedProcess[str], list[str]]:
    assert isinstance(cloud["scenario"], Path) and isinstance(cloud["log"], Path)
    cloud["scenario"].write_text(json.dumps(scenario))
    env = {**cloud["env"], "ALLOW_FLAG_CHANGE": allow}  # type: ignore[dict-item]
    done = subprocess.run(["bash", "-c", '. deploy/api_guard.sh; guard_before p r; guard_after p r'], cwd=ROOT, env=env, capture_output=True, text=True, check=False, timeout=60)  # noqa: S603, S607
    calls = cloud["log"].read_text().splitlines() if cloud["log"].exists() else []
    return done, calls


def test_a_new_revision_that_lost_settings_gets_no_traffic(cloud: dict[str, object]) -> None:
    done, calls = run_guard(cloud, {
        "service": service("sme-api-00157", "sme-api-00158", {}),
        "revisions": {"sme-api-00157": revision(LIVE), "sme-api-00158": revision({"PAGE_MAX_INFLIGHT": "12"}, min_scale="")},
    })
    assert done.returncode == 3
    assert "TELEPHONY_MODE: sandbox -> <unset>" in done.stderr and "gets none" in done.stderr
    assert not any("update-traffic" in c for c in calls), "traffic must not move before the check passes"


def test_a_clean_new_revision_gets_all_the_traffic_after_the_check(cloud: dict[str, object]) -> None:
    done, calls = run_guard(cloud, {
        "service": service("sme-api-00157", "sme-api-00158", {}),
        "revisions": {"sme-api-00157": revision(LIVE), "sme-api-00158": revision({**LIVE, "PAGE_QUEUE_WAIT_S": "1.0"})},
    }, allow="PAGE_QUEUE_WAIT_S")
    assert done.returncode == 0, done.stderr
    shift = [c for c in calls if "update-traffic" in c]
    assert len(shift) == 1 and "--to-revisions sme-api-00158=100" in shift[0]
    # the order: the revision was read (compared) before the traffic moved
    assert calls.index(shift[0]) > max(i for i, c in enumerate(calls) if "revisions describe sme-api-00158" in c)


def test_a_change_the_owner_named_is_allowed_and_one_not_named_is_not(cloud: dict[str, object]) -> None:
    scenario = {
        "service": service("sme-api-00157", "sme-api-00158", {}),
        "revisions": {"sme-api-00157": revision(LIVE), "sme-api-00158": revision({**LIVE, "PAGE_QUEUE_WAIT_S": "1.0"})},
    }
    refused, _ = run_guard(cloud, scenario)   # nothing named: the new setting is a change
    assert refused.returncode == 3 and "PAGE_QUEUE_WAIT_S: <unset> -> 1.0" in refused.stderr


def test_the_first_revision_of_a_service_has_nothing_to_compare_with_and_moves_no_traffic_itself(cloud: dict[str, object]) -> None:
    done, calls = run_guard(cloud, {"service": None})
    assert done.returncode == 0
    assert not any("update-traffic" in c for c in calls)


# ------------------------------------------------------------------------------------------------------------------------------- cloudrun.sh
def dry_api(extra: dict[str, str] | None = None) -> str:
    env = {**os.environ, "PROJECT_ID": "sme-test", "SUPABASE_URL": "https://abc.supabase.co", "SUPABASE_PUBLISHABLE_KEY": "pk-public", "WEB_ORIGIN": "https://web.example.run.app", "AGENTS_ENABLED": "true", "CPU_ALWAYS": "true", **(extra or {})}
    return subprocess.run(["bash", str(CLOUDRUN), "api"], cwd=ROOT, env=env, capture_output=True, text=True, check=True, timeout=60).stdout  # noqa: S603, S607


def test_the_api_deploy_only_updates_settings_never_replaces_them() -> None:
    out = dry_api()
    assert "--update-env-vars" in out and "--update-secrets" in out
    assert "--set-env-vars" not in out and "--set-secrets" not in out, "a full replace drops every setting this run does not state"
    assert "--min-instances 1" in out, "the warm instance is always stated"
    assert "--no-traffic" not in out, "traffic is only withheld when the caller asks (it checks the revision and moves the traffic itself)"


def test_the_caller_can_withhold_the_traffic_and_drop_a_setting_on_purpose() -> None:
    out = dry_api({"NO_TRAFFIC": "1", "REMOVE_ENV": "OLD_FLAG", "REMOVE_SECRETS": "OLD_SECRET"})
    assert "--no-traffic" in out and "--remove-env-vars OLD_FLAG" in out and "--remove-secrets OLD_SECRET" in out


def test_the_worker_job_is_updated_too_not_replaced() -> None:
    env = {**os.environ, "PROJECT_ID": "sme-test", "SUPABASE_URL": "https://abc.supabase.co", "SUPABASE_PUBLISHABLE_KEY": "pk-public", "WEB_ORIGIN": "https://web.example.run.app", "SCHEDULER_EMAIL": "s@example.test", "SCHEDULER_SA": "sa@example.test"}
    out = subprocess.run(["bash", str(CLOUDRUN), "worker"], cwd=ROOT, env=env, capture_output=True, text=True, check=True, timeout=60).stdout  # noqa: S603, S607
    assert "--update-env-vars" in out and "--update-secrets" in out and "--set-env-vars" not in out and "--set-secrets" not in out


def test_no_deploy_script_replaces_a_whole_environment() -> None:
    for name in ("cloudrun.sh", "staging.sh", "production.sh", "api_guard.sh"):
        text = (ROOT / "deploy" / name).read_text()
        code = "\n".join(line for line in text.splitlines() if not line.lstrip().startswith("#"))
        assert "--set-env-vars" not in code and "--set-secrets" not in code, f"{name} replaces a whole environment"
