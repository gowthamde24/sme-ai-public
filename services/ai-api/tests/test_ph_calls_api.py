"""Phone calls, part 6: the Calls page API (list, one call, hang up), who may see what, no internal ids as names."""

# ruff: noqa: E501
from __future__ import annotations

import asyncio
import uuid
from datetime import UTC, datetime, timedelta
from typing import Any

from app.telephony.live import LiveCalls
from app.telephony.repository import CallStateError
from app.telephony.service import CallsService
from tests.fakes import TENANT_A, auth, make_client

NOW = datetime(2026, 11, 3, 6, 0, tzinfo=UTC)
LIVE_ID, DONE_ID, REFUSED_ID = uuid.uuid4(), uuid.uuid4(), uuid.uuid4()


def row(call_id: uuid.UUID, **kw: Any) -> dict[str, Any]:
    base = {"id": str(call_id), "direction": "outbound", "state": "completed", "refuse_reason": None, "purpose": "visit_reminder", "language": "te", "contact_id": str(uuid.uuid4()), "lead_id": str(uuid.uuid4()),
            "task_id": None, "contact_name": "Ravi Kumar", "contact_phone": "+919876543210", "provider": "sandbox", "sandbox": True, "simulated": False, "ai_disclosed": True, "recorded": False,
            "created_at": (NOW - timedelta(minutes=10)).isoformat(), "answered_at": (NOW - timedelta(minutes=9)).isoformat(), "ended_at": (NOW - timedelta(minutes=7)).isoformat(), "duration_s": 120,
            "end_reason": "goodbye", "outcome": "positive", "category": "visit_booked", "callback_at": None, "captured": {"visit_day": "Saturday"}, "summary": "Wants to visit on Saturday. " * 20, "cost_paise": 200}
    base.update(kw)
    return base


class FakeCallsRepo:
    def __init__(self) -> None:
        self.rows = {
            LIVE_ID: row(LIVE_ID, state="in_progress", ended_at=None, duration_s=None, outcome=None, category=None, summary=None, captured=None, cost_paise=0, created_at=(NOW - timedelta(seconds=40)).isoformat(),
                         answered_at=(NOW - timedelta(seconds=30)).isoformat(), end_reason=None, transcript=[{"who": "assistant", "text": "Hello", "t": 0.0}], contact_name="Enquiry 8a297f", contact_phone=None),
            DONE_ID: row(DONE_ID, transcript=[{"who": "assistant", "text": "Hello", "t": 0.0}, {"who": "caller", "text": "Yes", "t": 4.2}]),
            REFUSED_ID: row(REFUSED_ID, state="refused", refuse_reason="dnd", answered_at=None, duration_s=None, outcome=None, category=None, summary=None, captured=None, cost_paise=0, contact_name=None, contact_phone=None),
        }
        self.calls: list[Any] = []

    def list_calls(self, token: str, tenant_id: uuid.UUID, state: str, limit: int, before: datetime | None) -> list[dict[str, Any]]:
        self.calls.append((state, limit, before))
        live = [r for r in self.rows.values() if r["state"] in ("queued", "ringing", "in_progress")]
        done = [r for r in self.rows.values() if r["state"] not in ("queued", "ringing", "in_progress")]
        picked = {"live": live, "finished": done, "all": live + done}[state]
        return [{k: v for k, v in r.items() if k != "transcript"} for r in picked][:limit]

    def get(self, token: str, tenant_id: uuid.UUID, call_id: uuid.UUID) -> dict[str, Any]:
        if call_id not in self.rows:
            raise CallStateError()
        return self.rows[call_id]


def client(repo: FakeCallsRepo | None = None, live: LiveCalls | None = None) -> Any:
    c, _ = make_client(calls=CallsService(repo or FakeCallsRepo(), clock=lambda: NOW), live_calls=live or LiveCalls())
    return c


URL = f"/v1/tenants/{TENANT_A.id}/calls"


def test_the_list_has_live_calls_first_with_seconds_so_far_and_a_real_name_never_an_id() -> None:
    r = client().get(URL, headers=auth("a_owner"))
    assert r.status_code == 200 and r.headers["cache-control"] == "no-store"
    body = r.json()
    assert [i["id"] for i in body["items"]][:1] == [str(LIVE_ID)] and body["poll_after_s"] == 5
    live, done, refused = body["items"]
    assert live["live"] and live["elapsed_s"] == 30 and live["who"] == "New enquiry", "a placeholder made from an id is not a name"
    assert done["who"] == "Ravi Kumar" and done["elapsed_s"] == 120 and len(done["summary_short"]) <= 140 and done["summary_short"].endswith("…")
    assert refused["state"] == "refused" and refused["refuse_reason"] == "dnd" and refused["who"] == "New enquiry"
    assert all(i["recorded"] is False and i["ai_disclosed"] in (True, False) for i in body["items"])


def test_the_state_filter_and_the_page_size_reach_the_database() -> None:
    repo = FakeCallsRepo()
    c = client(repo)
    assert [i["live"] for i in c.get(URL + "?state=live", headers=auth("a_owner")).json()["items"]] == [True]
    assert all(not i["live"] for i in c.get(URL + "?state=finished", headers=auth("a_owner")).json()["items"])
    c.get(URL + "?limit=1", headers=auth("a_owner"))
    assert repo.calls[-1][1] == 2, "one more than asked for, to know whether there is a next page"
    assert c.get(URL + "?state=nonsense", headers=auth("a_owner")).status_code == 422
    assert c.get(URL + "?cursor=garbage", headers=auth("a_owner")).status_code == 422


def test_the_next_page_marker_is_given_only_when_there_is_more() -> None:
    body = client().get(URL + "?limit=2", headers=auth("a_owner")).json()
    assert len(body["items"]) == 2 and body["next_cursor"] is not None
    assert client().get(URL + "?limit=50", headers=auth("a_owner")).json()["next_cursor"] is None


def test_owner_and_admin_read_the_transcript_sales_read_the_call_without_it() -> None:
    for user in ("a_owner", "a_admin"):
        body = client().get(f"{URL}/{DONE_ID}", headers=auth(user)).json()
        assert [t["who"] for t in body["transcript"]] == ["assistant", "caller"] and body["captured"] == {"visit_day": "Saturday"} and body["end_reason"] == "goodbye"
    sales = client().get(f"{URL}/{DONE_ID}", headers=auth("a_sales"))
    assert sales.status_code == 200 and sales.json()["transcript"] is None and sales.json()["who"] == "Ravi Kumar"


def test_a_viewer_and_anyone_outside_the_workspace_see_nothing() -> None:
    c = client()
    assert c.get(URL, headers=auth("a_viewer")).status_code == 403
    assert c.get(URL, headers=auth("b_owner")).status_code in (403, 404)
    assert c.get(URL).status_code == 401
    assert c.get(f"{URL}/not-a-uuid", headers=auth("a_owner")).status_code == 404


def test_hanging_up_ends_a_call_on_this_server_and_says_so_when_it_is_elsewhere() -> None:
    class Line:
        reason = ""

        async def hang_up(self, reason: str) -> None:
            self.reason = reason

    line = Line()
    live = LiveCalls()
    live.add(TENANT_A.id, LIVE_ID, line)  # type: ignore[arg-type]
    c = client(live=live)
    r = c.post(f"{URL}/{LIVE_ID}/hang-up", headers=auth("a_admin"))
    assert r.status_code == 202 and line.reason == "stopped"
    assert c.post(f"{URL}/{DONE_ID}/hang-up", headers=auth("a_owner")).status_code == 409, "not on this server"
    assert c.post(f"{URL}/{LIVE_ID}/hang-up", headers=auth("a_sales")).status_code == 403
    assert c.post(f"{URL}/{uuid.uuid4()}/hang-up", headers=auth("a_owner")).status_code in (404, 409)


def test_the_live_registry_never_reaches_another_workspaces_call() -> None:
    class Line:
        async def hang_up(self, reason: str) -> None:
            raise AssertionError("must not be called")

    live = LiveCalls()
    live.add(TENANT_A.id, LIVE_ID, Line())  # type: ignore[arg-type]
    assert asyncio.run(live.hang_up(uuid.uuid4(), LIVE_ID)) is False and live.count() == 1 and live.count_for(TENANT_A.id) == 1
    live.remove(LIVE_ID)
    assert live.count() == 0
