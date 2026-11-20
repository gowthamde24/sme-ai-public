"""deploy/drift.py (20 Nov 2026): the web service and the worker job are declared like the API; a hand edit, a lost switch or a new unnamed setting is found, a named change is allowed, no value of a secret or a phone
number is ever in the file, and a resource that does not exist yet is not drift."""

# ruff: noqa: E501

from __future__ import annotations

import importlib.util
import sys
from pathlib import Path

import pytest

DEPLOY = Path(__file__).resolve().parents[3] / "deploy"
sys.path.insert(0, str(DEPLOY))   # drift.py imports flag_guard from its own folder
_spec = importlib.util.spec_from_file_location("drift", DEPLOY / "drift.py")
assert _spec is not None and _spec.loader is not None
drift = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(drift)


def job(env: list[dict[str, object]]) -> dict[str, object]:
    return {"spec": {"template": {"spec": {"template": {"spec": {"containers": [{"env": env}]}}}}}}


def test_a_job_is_read_like_a_service_and_a_secret_is_only_a_reference() -> None:
    live = drift.job_flags(job([{"name": "AUTO_REPLY_ENABLED", "value": "true"}, {"name": "RESEND_API_KEY", "valueFrom": {"secretKeyRef": {"name": "sme-resend-api-key", "key": "latest"}}}, {"name": "EMPTY"}]))
    assert live["AUTO_REPLY_ENABLED"] == "true" and live["RESEND_API_KEY"] == "secret:sme-resend-api-key:latest" and live["EMPTY"] == ""


def test_the_declared_file_is_parsed_and_a_broken_line_is_refused() -> None:
    assert drift.parse_declared("# c\n\nA=1\nB=@ignore\nC=secret:s:latest\nD=\n") == {"A": "1", "B": "@ignore", "C": "secret:s:latest", "D": ""}
    with pytest.raises(SystemExit):
        drift.parse_declared("not a setting\n")


def test_no_drift_a_hand_edit_a_lost_switch_and_a_new_unnamed_setting_are_told_apart() -> None:
    declared = {"A": "1", "B": "on", "PHONES": "@ignore", "@minScale": "0"}
    live = {"A": "1", "B": "on", "PHONES": "9195", "@minScale": "0"}
    assert drift.differences(declared, live, set()) == []
    assert drift.differences(declared, {**live, "B": "off"}, set()) == ["B: on -> off"]
    assert drift.differences(declared, {k: v for k, v in live.items() if k != "A"}, set()) == ["A: 1 -> <unset>"]
    assert drift.differences(declared, {**live, "NEW": "x"}, set()) == ["NEW: <not declared> -> x"]
    assert drift.differences(declared, {k: v for k, v in live.items() if k != "PHONES"}, set()) == ["PHONES: declared (value not in git) -> <unset>"]


def test_a_named_change_is_allowed_and_a_job_with_no_instance_limits_is_not_drift() -> None:
    assert drift.differences({"A": "1"}, {"A": "2"}, {"A"}) == []
    assert drift.differences({"A": "1"}, {"A": "1", "@minScale": "", "@maxScale": ""}, set()) == []


def test_a_snapshot_never_writes_a_phone_number_or_a_key_like_value() -> None:
    text = drift.snapshot_text("staging", "worker", {"WHATSAPP_ALLOWED_RECIPIENTS": "919502380998", "SUPABASE_PUBLISHABLE_KEY": "sb_publishable_x", "TOKEN_EXPIRY_CHECK": "true", "@minScale": ""})
    assert "919502380998" not in text and "sb_publishable_x" not in text and "WHATSAPP_ALLOWED_RECIPIENTS=@ignore" in text and "TOKEN_EXPIRY_CHECK=true" in text and "@minScale" not in text


@pytest.mark.parametrize("which", ["web", "worker"])
def test_the_declared_files_of_staging_exist_hold_no_number_and_the_script_checks_them_before_a_deploy(which: str) -> None:
    text = (DEPLOY / "settings" / "staging" / f"{which}.env").read_text(encoding="utf-8")
    parsed = drift.parse_declared(text)
    assert parsed and not any(v.isdigit() and len(v) >= 10 for v in parsed.values()), "no phone number in git"
    assert not any("sb_publishable" in v for v in parsed.values())
    staging = (DEPLOY / "staging.sh").read_text(encoding="utf-8")
    assert "drift.py check staging" in staging and "for resource in web worker" in staging
    assert "drift.py check production web" in (DEPLOY / "production.sh").read_text(encoding="utf-8")


def test_the_web_flag_file_and_the_declared_web_settings_name_the_same_work_tenants() -> None:
    flags = drift.parse_declared((DEPLOY / "staging-web-flags.env").read_text(encoding="utf-8"))
    declared = drift.parse_declared((DEPLOY / "settings" / "staging" / "web.env").read_text(encoding="utf-8"))
    assert set(flags["ASSISTANT_WORK_TENANTS"].split(";")) >= {"b3de0526-239c-4104-a4b8-e82d7bac41d2", "a207d1ff-0380-41bd-8ea3-36ec5250de05", "6cad34c2-6d54-407c-85cc-e3c959e0b45b"}
    assert declared["ASSISTANT_WORK_TENANTS"] != "", "the live web value is declared (it follows the next web deploy)"
