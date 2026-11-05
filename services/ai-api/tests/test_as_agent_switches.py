"""A switch per helper (C2's sidebar v2 "My AI team"; docs/contracts/agents-switches.md): the Owner switches a helper off for the workspace; the database enforces it where every run starts
(pgTAP 163). The feature helpers without a switch of their own say so (not_built) instead of drawing a fake toggle."""

# ruff: noqa: E501

from __future__ import annotations

from typing import Any

from tests.fakes import TENANT_A, auth, make_client
from tests.today_fakes import FakeTodayRepository

URL = f"/v1/tenants/{TENANT_A.id}/agents"


def world() -> tuple[Any, FakeTodayRepository]:
    repo = FakeTodayRepository()
    repo.switches[TENANT_A.id] = [
        {"agent": "assistant", "enabled": True, "can_switch": True, "reason_locked": None, "running": True, "done_today": 4},
        {"agent": "requirement", "enabled": True, "can_switch": True, "reason_locked": None, "running": True, "done_today": 0},
        {"agent": "research", "enabled": True, "can_switch": True, "reason_locked": None, "running": True, "done_today": 1},
    ]
    client, _ = make_client(today=repo)
    return client, repo


def test_the_helpers_with_their_switches_and_the_ones_without() -> None:
    client, _ = world()
    got = client.get(f"{URL}/switches", headers=auth("a_admin"))
    assert got.status_code == 200, got.text
    items = {i["agent"]: i for i in got.json()}
    assert items["main"] == {"agent": "main", "enabled": True, "can_switch": True, "reason_locked": None, "done_today": 4}
    assert items["researcher"]["done_today"] == 1 and items["requirement_analyst"]["can_switch"] is True
    assert all(items[k]["can_switch"] is False and items[k]["reason_locked"] == "not_built" and items[k]["done_today"] is None for k in ("lead_finder", "quote_writer", "followup_desk", "order_desk"))
    assert client.get(f"{URL}/switches", headers=auth("a_sales")).status_code == 403


def test_the_owner_switches_a_helper_and_nobody_else_does() -> None:
    client, repo = world()
    got = client.put(f"{URL}/researcher/switch", json={"enabled": False}, headers=auth("a_owner"))
    assert got.status_code == 200 and got.json()["enabled"] is False and got.json()["agent"] == "researcher", got.text
    assert ("agent_switch_set" in [c[0] for c in repo.calls])
    assert client.put(f"{URL}/researcher/switch", json={"enabled": True}, headers=auth("a_admin")).status_code == 403
    assert client.put(f"{URL}/followup_desk/switch", json={"enabled": False}, headers=auth("a_owner")).json()["error"]["code"] == "not_switchable"
    assert client.put(f"{URL}/nobody/switch", json={"enabled": False}, headers=auth("a_owner")).status_code == 404
    assert client.put(f"{URL}/main/switch", json={"enabled": "no"}, headers=auth("a_owner")).status_code == 422
