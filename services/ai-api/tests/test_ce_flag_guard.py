"""deploy/flag_guard.py: flags must not change silently between revisions of the staging API (12 Nov 2026: a deploy without TELEPHONY_OUTBOUND switched test calls off)."""

from __future__ import annotations

import importlib.util
from pathlib import Path

_spec = importlib.util.spec_from_file_location("flag_guard", Path(__file__).resolve().parents[3] / "deploy" / "flag_guard.py")
assert _spec is not None and _spec.loader is not None
guard = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(guard)


def service(env: list[dict[str, object]], *, min_scale: str = "1") -> dict[str, object]:
    return {"spec": {"template": {"metadata": {"annotations": {"autoscaling.knative.dev/minScale": min_scale, "autoscaling.knative.dev/maxScale": "1"}}, "spec": {"containers": [{"env": env}]}}}}


def test_an_empty_setting_a_plain_value_and_a_secret_are_read_without_any_secret_value() -> None:
    flags = guard.flags_of(service([
        {"name": "TELEPHONY_OUTBOUND", "value": "true"},
        {"name": "TASKS_DIALER"},
        {"name": "PLIVO_AUTH_TOKEN", "valueFrom": {"secretKeyRef": {"name": "sme-plivo-auth-token", "key": "latest"}}},
    ]))
    assert flags == {"TELEPHONY_OUTBOUND": "true", "TASKS_DIALER": "", "PLIVO_AUTH_TOKEN": "secret:sme-plivo-auth-token:latest", "@minScale": "1", "@maxScale": "1"}


def test_the_switch_that_went_off_on_12_nov_is_caught_and_a_named_change_is_allowed() -> None:
    before = guard.flags_of(service([{"name": "TELEPHONY_OUTBOUND", "value": "true"}, {"name": "TASKS_DIALER"}]))
    after = guard.flags_of(service([{"name": "TELEPHONY_OUTBOUND", "value": "false"}, {"name": "TASKS_DIALER"}]))
    assert guard.differences(before, after, set()) == ["TELEPHONY_OUTBOUND: true -> false"]
    assert guard.differences(before, after, {"TELEPHONY_OUTBOUND"}) == []
    assert guard.differences(before, before, set()) == []


def test_a_setting_that_appears_or_disappears_and_the_instance_limits_are_changes_too() -> None:
    before = guard.flags_of(service([{"name": "A", "value": "1"}], min_scale="1"))
    after = guard.flags_of(service([{"name": "B", "value": "1"}], min_scale="0"))
    found = guard.differences(before, after, set())
    assert "A: 1 -> <unset>" in found and "B: <unset> -> 1" in found and "@minScale: 1 -> 0" in found
    assert guard.differences(before, after, {"A", "B", "API_MIN_INSTANCES"}) == []
