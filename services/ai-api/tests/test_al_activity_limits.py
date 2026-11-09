"""Everything it did and Limits over HTTP (docs/contracts/activity-limits.md; pgTAP 172 pins the database: who reads, paging, the undo state, every tightening and every refusal).
Here: roles, the page marker, the links, the strict body of PUT /limits (only tighter shapes pass), the error mapping, and that nothing but the database decides."""

# ruff: noqa: E501

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from typing import Any

import pytest

from app.activity.routes import decode_cursor, encode_cursor
from tests.fakes import TENANT_A, auth, make_client

BASE = f"/v1/tenants/{TENANT_A.id}"
NOW = datetime(2026, 11, 9, 12, 0, tzinfo=UTC)


class FakeActivity:
    def __init__(self) -> None:
        self.calls: list[tuple[str, Any]] = []
        self.answer: dict[str, Any] = {"ok": True, "limits": {"workspace": {"on": False}, "kinds": [], "caps": [], "quiet_hours": {}}}
        self.page: dict[str, Any] = {"items": [], "next": None}

    def activity(self, token: str, tenant_id: uuid.UUID, *, limit: int, before_at: datetime | None, before_key: str | None, kind: str | None) -> dict[str, Any]:
        self.calls.append(("activity", (limit, before_at, before_key, kind)))
        return self.page

    def limits(self, token: str, tenant_id: uuid.UUID) -> dict[str, Any]:
        self.calls.append(("limits", None))
        return {"workspace": {"on": True}, "kinds": [], "caps": [], "quiet_hours": {}}

    def tighten(self, token: str, tenant_id: uuid.UUID, changes: dict[str, Any]) -> dict[str, Any]:
        self.calls.append(("tighten", changes))
        return self.answer


def world() -> tuple[Any, FakeActivity]:
    fake = FakeActivity()
    client, _ = make_client(activity=fake)
    return client, fake


def test_only_the_owner_and_an_admin_read_the_timeline_and_the_limits() -> None:
    client, _ = world()
    for path in ("/activity-log", "/limits"):
        assert client.get(BASE + path, headers=auth("a_owner")).status_code == 200
        assert client.get(BASE + path, headers=auth("a_admin")).status_code == 200
        for who in ("a_sales", "a_viewer", "b_owner"):
            assert client.get(BASE + path, headers=auth(who)).status_code in (403, 404), (path, who)


def test_only_the_owner_tightens() -> None:
    client, fake = world()
    for who in ("a_admin", "a_sales", "a_viewer", "b_owner"):
        assert client.put(BASE + "/limits", headers=auth(who), json={"messages_alone": False}).status_code in (403, 404), who
    assert not any(c[0] == "tighten" for c in fake.calls)
    assert client.put(BASE + "/limits", headers=auth("a_owner"), json={"messages_alone": False}).status_code == 200


def test_a_page_marker_round_trips_and_a_bad_one_is_refused() -> None:
    cursor = encode_cursor({"before_at": NOW.isoformat(), "before_key": f"call:{uuid.uuid4()}"})
    assert cursor is not None
    at, key = decode_cursor(cursor)
    assert at == NOW and key.startswith("call:")
    client, fake = world()
    assert client.get(BASE + "/activity-log?cursor=not-a-marker", headers=auth("a_owner")).status_code == 422
    r = client.get(BASE + f"/activity-log?cursor={cursor}&limit=7&kind=message", headers=auth("a_owner"))
    assert r.status_code == 200 and fake.calls[-1] == ("activity", (7, NOW, key, "message"))
    assert client.get(BASE + "/activity-log?kind=nonsense", headers=auth("a_owner")).status_code == 422
    assert client.get(BASE + "/activity-log?limit=101", headers=auth("a_owner")).status_code == 422


def test_items_get_a_link_and_the_next_marker_is_opaque() -> None:
    client, fake = world()
    call_id, lead_id = uuid.uuid4(), uuid.uuid4()
    fake.page = {"items": [{"key": f"call:{call_id}", "kind": "call", "id": str(call_id), "undo": {"state": "none"}},
                           {"key": "message:x", "kind": "message", "id": str(uuid.uuid4()), "lead_id": str(lead_id), "undo": {"state": "none"}},
                           {"key": "action:y", "kind": "action", "id": str(uuid.uuid4()), "undo": {"state": "available"}}],
                 "next": {"before_at": NOW.isoformat(), "before_key": f"call:{call_id}"}}
    got = client.get(BASE + "/activity-log", headers=auth("a_owner")).json()
    assert got["items"][0]["href"] == f"/app/tenants/{TENANT_A.id}/office/live?call={call_id}"
    assert got["items"][1]["href"] == f"/app/tenants/{TENANT_A.id}/leads/{lead_id}" and got["items"][2]["href"] is None
    assert got["next_cursor"] and "call:" not in got["next_cursor"]
    fake.page = {"items": [], "next": None}
    assert client.get(BASE + "/activity-log", headers=auth("a_owner")).json()["next_cursor"] is None


@pytest.mark.parametrize("body", [
    {"messages_alone": True}, {"workspace_on": True}, {"call_prices": True}, {"call_dues": "no"},
    {"message_daily_limit": 21}, {"message_daily_limit": 0}, {"message_daily_limit": "2"}, {"message_daily_limit": 2.5}, {"message_daily_limit": True},
    {"message_quiet_hours": {"start_hour": 18}}, {"message_quiet_hours": {"end_hour": 11}}, {"message_quiet_hours": {"start": 20}},
    {"call_discount_percent": 51}, {"call_big_order_paise": 0},
    {"call_hours": {"days": [0]}}, {"call_hours": {"days": []}}, {"call_hours": {"from_minute": 545}}, {"call_hours": {"from_minute": 500}},
    {"something_else": 1}, {},
])
def test_a_body_that_cannot_be_a_tightening_never_reaches_the_database(body: dict[str, Any]) -> None:
    client, fake = world()
    r = client.put(BASE + "/limits", headers=auth("a_owner"), json=body)
    assert r.status_code == 422, body
    assert not any(c[0] == "tighten" for c in fake.calls)


def test_a_good_body_is_passed_through_as_given_and_returns_the_new_limits() -> None:
    client, fake = world()
    body = {"messages_alone": False, "message_daily_limit": 2, "message_quiet_hours": {"start_hour": 20}, "call_prices": False, "call_hours": {"days": [1, 2], "from_minute": 600}, "call_big_order_paise": 1_000_000}
    r = client.put(BASE + "/limits", headers=auth("a_owner"), json=body)
    assert r.status_code == 200 and r.json()["workspace"] == {"on": False}
    assert fake.calls[-1] == ("tighten", body)


@pytest.mark.parametrize(("reason", "status"), [("would_loosen", 422), ("invalid", 422), ("unknown_field", 422), ("not_saved", 409), ("limits_elsewhere", 409), ("anything_new", 422)])
def test_the_database_s_refusals_are_mapped_and_name_the_field(reason: str, status: int) -> None:
    client, fake = world()
    fake.answer = {"ok": False, "reason": reason, "field": "message_daily_limit"}
    r = client.put(BASE + "/limits", headers=auth("a_owner"), json={"message_daily_limit": 2})
    assert r.status_code == status
    err = r.json()["error"]
    assert err["field"] == "message_daily_limit" and err["message"]
    assert err["code"] == (reason if reason != "anything_new" else "invalid")
