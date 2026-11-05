"""The assistant does the work: Settings -> Activity (docs/contracts/assistant-tools.md section 3). The action log as a list for the Owner and an Admin, newest first, "by the assistant, on X's request",
never the stored undo itself; ONE logged step undone through its route's own undo for 7 days; a plan's Undo afterwards does not undo it twice."""

# ruff: noqa: E501

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from typing import Any

from tests.fakes import auth
from tests.test_aw_files import BASE, cards_of
from tests.test_aw_router import INDIAMART, do, say, world

PAUSE = {"decision": "do", "action": "pause_source", "args": {"source": "IndiaMART"}}


def paused() -> tuple[Any, Any, str]:
    client, _, _, _, sources = world(PAUSE)
    plan_id = cards_of(say(client, "pause IndiaMART"))[0]["plan"]["plan_id"]
    assert do(client, plan_id).json()["status"] == "done"
    return client, sources, plan_id


def test_the_owner_and_an_admin_see_what_the_assistant_changed_and_nobody_else_does() -> None:
    client, sources, plan_id = paused()
    got = client.get(f"{BASE}/actions", headers=auth("a_owner"))
    assert got.status_code == 200, got.text
    (item,) = got.json()["items"]
    assert item["summary"] == "IndiaMART: active -> paused" and item["status"] == "done" and item["undo"] == "available" and item["plan_id"] == plan_id
    assert "undo_until" not in item and not isinstance(item.get("undo"), dict), "never the stored undo itself"
    assert client.get(f"{BASE}/actions", headers=auth("a_admin")).status_code == 200
    assert client.get(f"{BASE}/actions", headers=auth("a_sales")).status_code == 403
    assert client.get(f"{BASE}/actions?since=yesterday", headers=auth("a_owner")).status_code == 422


def test_one_step_is_undone_from_activity_and_the_plans_undo_does_not_do_it_twice() -> None:
    client, sources, plan_id = paused()
    (item,) = client.get(f"{BASE}/actions", headers=auth("a_owner")).json()["items"]
    undone = client.post(f"{BASE}/actions/{item['action_id']}/undo", headers=auth("a_owner"))
    assert undone.status_code == 200 and undone.json()["undo"] == "done" and undone.json()["status"] == "undone", undone.text
    assert sources.sources_[INDIAMART]["status"] == "active"
    again = client.post(f"{BASE}/actions/{item['action_id']}/undo", headers=auth("a_owner"))
    assert again.status_code == 409 and again.json()["error"]["code"] == "nothing_to_undo"
    sources.sources_[INDIAMART]["status"] = "paused"   # paused again by hand since
    plan = client.post(f"{BASE}/plans/{plan_id}/undo", headers=auth("a_owner")).json()
    assert plan["status"] == "undone" and sources.sources_[INDIAMART]["status"] == "paused", "the step undone from Activity is not undone again"


def test_an_undo_past_its_seven_days_is_refused_plainly() -> None:
    client, sources, plan_id = paused()
    store = client.app.state.runtime.assistant_work
    store.actions[0]["undo_until"] = (datetime.now(UTC) - timedelta(minutes=1)).isoformat()
    (item,) = client.get(f"{BASE}/actions", headers=auth("a_owner")).json()["items"]
    assert item["undo"] == "expired"
    refused = client.post(f"{BASE}/actions/{item['action_id']}/undo", headers=auth("a_owner"))
    assert refused.status_code == 409 and refused.json()["error"]["code"] == "undo_expired" and sources.sources_[INDIAMART]["status"] == "paused"


def test_sales_cannot_undo_from_activity() -> None:
    client, _, _ = paused()
    (item,) = client.get(f"{BASE}/actions", headers=auth("a_owner")).json()["items"]
    assert client.post(f"{BASE}/actions/{item['action_id']}/undo", headers=auth("a_sales")).status_code == 403
