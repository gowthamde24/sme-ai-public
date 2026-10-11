"""Job AS (ADR 0067) on the real stack: store visits through OUR API with real JWT verification, real PostgREST and the real database functions, the outbox's LOCAL FAKE adapter as the only
channel. The opening hours, the slots and their places, booking and its refusals, the steps, Today's list, the confirmation and reminder through the outbox, "offer a store visit" on a call
request, and the order a "bought" visit starts. NOTHING reaches a real channel.

Time: every visit rule is India time by the database's clock, app.visit_now() -> app.outbox_now(). These tests NEVER lean on the real time: the `vbox` fixture runs the whole module twice, with
that clock pinned (for the module, restored afterwards) to 14:00 IST on a day three weeks ago ("day") and to 23:30 IST on the days after ("night"), each run on its own dates so the two never
compete for the same places. A separate test pins the minutes around midnight. The clock itself is also tested at explicit instants in pgTAP 77."""

# ruff: noqa: E501, S608

from __future__ import annotations

import uuid
from collections.abc import Iterator
from datetime import UTC, date, datetime, time, timedelta, timezone
from typing import Any

import operator_sql
import pytest
from conftest import bearer
from crm_support import World
from fastapi.testclient import TestClient
from followup_support import FollowWorld, Lead
from order_support import OrderWorld
from quote_support import QuoteWorld
from test_outbox_api import restore_clock

from app.outbox.adapter import LocalFakeAdapter
from app.visits import texts


def sf(dispatched: dict[str, Any]) -> dict[str, int]:
    """Just what the channel did (sent, failed): the dispatch answer also carries counts of what is still waiting (job BB)."""
    return {"sent": dispatched["sent"], "failed": dispatched["failed"]}

IST = timezone(timedelta(hours=5, minutes=30))
# the day-run is pinned to this India date, the night-run to the date three days later
FIRST_DAY = datetime.now(IST).date() - timedelta(days=21)
PINS = {"day": (FIRST_DAY, time(14, 0)), "night": (FIRST_DAY + timedelta(days=3), time(23, 30))}
OPEN_ALL_WEEK = {d: {"open": "10:00", "close": "20:30"} for d in ("mon", "tue", "wed", "thu", "fri", "sat", "sun")}


def pin_to(day: date, at: time) -> datetime:
    """Pin the clock of the whole local database to `at` India time on `day` (until restore_clock)."""
    instant = datetime.combine(day, at, tzinfo=IST)
    operator_sql.sql(
        "create or replace function app.outbox_now() returns timestamptz language sql stable security definer set search_path = '' "
        f"as $b$ select timestamptz '{instant.isoformat()}' $b$"
    )
    return instant


class VisitBox:
    def __init__(self, client: TestClient, world: World, day: date, at: time, kind: str) -> None:
        self.client, self.w = client, world
        self.fw = FollowWorld(client, world, world.a)
        self.fb = FollowWorld(client, world, world.b)
        self.tenant = world.a.id
        self.today, self.at, self.kind = day, at, kind
        runtime = client.app.state.runtime  # type: ignore[attr-defined]
        self.adapter: LocalFakeAdapter = runtime.outbox_adapter
        assert isinstance(self.adapter, LocalFakeAdapter)

    @property
    def night(self) -> bool:
        return self.kind == "night"

    def d(self, offset: int) -> str:
        return (self.today + timedelta(days=offset)).isoformat()

    def url(self, path: str, tenant: str | None = None) -> str:
        return f"/v1/tenants/{tenant or self.tenant}{path}"

    def call(self, user: str, method: str, path: str, body: Any = None, *, box: str = "a") -> Any:
        users = (self.w.a if box == "a" else self.w.b).users
        return self.client.request(method, self.url(path, self.w.b.id if box == "b" else None), json=body, headers=bearer(users[user]))

    def lead(self, **kw: Any) -> Lead:
        return self.fw.lead(**kw)

    def book(self, lead: str, offset: int, slot: str, user: str = "owner", **extra: Any) -> Any:
        return self.call(
            user,
            "POST",
            "/visits",
            {"visit_id": str(uuid.uuid4()), "lead_id": lead, "date": self.d(offset), "slot_start": slot, **extra},
        )


@pytest.fixture(scope="module", params=sorted(PINS))
def vbox(request: pytest.FixtureRequest, client: TestClient, eval_world: World) -> Iterator[VisitBox]:
    day, at = PINS[request.param]
    pin_to(day, at)
    operator_sql.sql("update public.platform_flags set enabled = true where key = 'outbox_enabled'")
    box = VisitBox(client, eval_world, day, at, request.param)
    r = box.call("owner", "PUT", "/outbox/settings", {"auto_send_enabled": True, "per_customer_daily_limit": 5})
    assert r.status_code == 200, r.text
    r = box.call("owner", "PUT", "/visits/settings", {"weekly_hours": OPEN_ALL_WEEK, "closed_dates": [box.d(9)], "slot_minutes": 30, "max_parallel": 2})
    assert r.status_code == 200, r.text
    try:
        yield box
    finally:
        operator_sql.sql("update public.platform_flags set enabled = false where key = 'outbox_enabled'")
        restore_clock()


def ok(r: Any, code: int = 200) -> Any:
    assert r.status_code == code, (r.status_code, r.text)
    return r.json()


def err(r: Any) -> str:
    return str(r.json()["error"]["code"])


# ---------------------------------------------------------------------------------------------- hours and slots
def test_the_hours_are_edited_by_owner_and_admin_and_read_by_every_member(vbox: VisitBox) -> None:
    week = {**OPEN_ALL_WEEK, "sun": None}
    body = {"weekly_hours": week, "closed_dates": [vbox.d(9), vbox.d(5), vbox.d(9)], "slot_minutes": 30, "max_parallel": 2}
    assert vbox.call("sales", "PUT", "/visits/settings", body).status_code == 403
    assert vbox.call("viewer", "PUT", "/visits/settings", body).status_code == 403
    assert vbox.call("owner", "PUT", "/visits/settings", {**body, "slot_minutes": 25}).status_code == 422
    saved = ok(vbox.call("admin", "PUT", "/visits/settings", body))
    assert saved["is_default"] is False and saved["weekly_hours"]["sun"] is None
    assert saved["closed_dates"] == sorted({vbox.d(9), vbox.d(5)})
    for who in ("owner", "admin", "sales", "viewer"):
        got = ok(vbox.call(who, "GET", "/visits/settings"))
        assert got == saved, who
    # put the week back (every day open) so the other tests do not depend on the weekday of the pinned date
    ok(vbox.call("owner", "PUT", "/visits/settings", {"weekly_hours": OPEN_ALL_WEEK, "closed_dates": [vbox.d(9)], "slot_minutes": 30, "max_parallel": 2}))


def test_another_business_has_its_own_hours_and_cannot_see_these(vbox: VisitBox) -> None:
    other = ok(vbox.call("owner", "GET", "/visits/settings", box="b"))
    assert other["is_default"] is True and other["closed_dates"] == []


def test_slots_show_the_places_left_and_which_are_behind_us(vbox: VisitBox) -> None:
    lead = vbox.lead()
    day = ok(vbox.call("sales", "GET", f"/visits/slots?date={vbox.d(0)}"))
    assert day["open"] is True and day["reason"] is None and len(day["slots"]) == 21
    assert day["slots"][0]["start"] == "10:00" and day["slots"][-1]["start"] == "20:00"
    assert all(s["capacity"] == 2 for s in day["slots"])
    # at 14:00 the morning is behind us and the evening is not; at 23:30 every slot of the day is
    flags = [s["past"] for s in day["slots"]]
    assert flags[0] is True
    assert (all(flags) if vbox.night else (flags[-1] is False and flags[12] is False)), "16:00 is still ahead at 14:00"
    free_before = day["slots"][14]["free"]  # 17:00
    ok(vbox.book(lead.id, 0, "17:00"))
    after = ok(vbox.call("sales", "GET", f"/visits/slots?date={vbox.d(0)}"))
    assert after["slots"][14]["free"] == free_before - 1
    assert ok(vbox.call("viewer", "GET", f"/visits/slots?date={vbox.d(0)}"))["slots"][14]["free"] == free_before - 1
    closed = ok(vbox.call("owner", "GET", f"/visits/slots?date={vbox.d(9)}"))
    assert closed["open"] is False and closed["reason"] == "closed_date" and closed["slots"] == []
    yesterday = ok(vbox.call("owner", "GET", f"/visits/slots?date={vbox.d(-1)}"))
    assert yesterday["open"] is False and yesterday["reason"] == "past"
    assert vbox.call("owner", "GET", "/visits/slots?date=soon").status_code == 422
    assert vbox.call("owner", "GET", f"/visits/slots?date={vbox.d(0)}", box="b").json()["slot_minutes"] == 30


# ---------------------------------------------------------------------------------------------- booking
def test_a_visit_is_booked_in_india_time_and_a_retry_replays(vbox: VisitBox) -> None:
    lead = vbox.lead()
    vid = str(uuid.uuid4())
    body = {"visit_id": vid, "lead_id": lead.id, "date": vbox.d(1), "slot_start": "11:00", "party_size": 3, "purpose": "Bridal sarees", "note": "Coming with her mother"}
    made = ok(vbox.call("sales", "POST", "/visits", body))
    visit = made["visit"]
    assert made["replayed"] is False and visit["status"] == "booked" and visit["source"] == "staff"
    assert visit["date"] == vbox.d(1) and visit["party_size"] == 3 and visit["purpose"] == "Bridal sarees"
    assert visit["starts_at"].startswith((datetime.fromisoformat(f"{vbox.d(1)}T11:00:00+05:30").astimezone(UTC)).strftime("%Y-%m-%dT%H:%M")), "11:00 is India time"
    assert visit["advance_requested"] is False and visit["advance_paise"] is None, "no advance unless asked for"
    assert visit["who"].startswith("Person") and visit["order_id"] is None
    again = ok(vbox.call("sales", "POST", "/visits", body))
    assert again["replayed"] is True and again["visit"]["id"] == vid
    other = vbox.call("sales", "POST", "/visits", {**body, "slot_start": "11:30"})
    assert other.status_code == 409, "the same id with another slot is refused"
    got = ok(vbox.call("viewer", "GET", f"/visits/{vid}"))
    assert got["id"] == vid and got["lead_id"] == lead.id
    assert vbox.call("owner", "GET", f"/visits/{vid}", box="b").status_code == 404


def test_every_refusal_is_one_fixed_answer(vbox: VisitBox) -> None:
    a, b, c = vbox.lead(), vbox.lead(), vbox.lead()
    assert err(vbox.book(a.id, 9, "11:00")) == "shop_closed"
    assert err(vbox.book(a.id, 1, "10:15")) == "slot_invalid"
    assert err(vbox.book(a.id, 1, "21:00")) == "slot_invalid"
    assert err(vbox.book(a.id, -1, "11:00")) == "date_past"
    assert vbox.book(a.id, 200, "11:00").status_code == 422
    ok(vbox.book(a.id, 2, "12:00"))
    assert err(vbox.book(a.id, 2, "12:00")) == "visit_state", "the same customer cannot hold two visits at the same moment"
    ok(vbox.book(b.id, 2, "12:00"))
    assert err(vbox.book(c.id, 2, "12:00")) == "slot_full", "two places, both taken"
    assert vbox.book(c.id, 2, "12:30").status_code == 200, "the next slot is free"
    foreign = vbox.fb.lead()
    assert vbox.book(foreign.id, 2, "13:00").status_code in (404, 422), "a lead of another business"
    assert vbox.book(c.id, 2, "13:00", user="viewer").status_code == 403
    assert vbox.client.post(vbox.url("/visits"), json={}, headers={}).status_code == 401
    assert vbox.call("owner", "POST", "/visits", {"visit_id": str(uuid.uuid4()), "lead_id": c.id, "date": vbox.d(2), "slot_start": "13:00", "status": "completed"}).status_code == 422


def test_a_customer_whose_record_was_erased_cannot_be_booked(vbox: VisitBox) -> None:
    lead = vbox.lead()
    operator_sql.sql("set session_replication_role = replica; " f"update public.contacts set erased_at = now(), archived_at = now() where id = '{lead.contact_id}'; set session_replication_role = origin")
    assert err(vbox.book(lead.id, 2, "14:00")) == "customer_erased"


def test_the_advance_is_optional_and_never_blocks(vbox: VisitBox) -> None:
    lead = vbox.lead()
    plain = ok(vbox.book(lead.id, 3, "10:00"))["visit"]
    assert plain["advance_requested"] is False
    asked = ok(vbox.book(vbox.lead().id, 3, "10:30", advance_paise=50000))["visit"]
    assert asked["advance_requested"] is True and asked["advance_paise"] == 50000 and asked["status"] == "booked"
    assert vbox.book(vbox.lead().id, 3, "11:00", advance_paise=0).status_code == 422
    changed = ok(vbox.call("owner", "POST", f"/visits/{plain['id']}/change", {"advance_paise": 30000}))
    assert changed["visit"]["advance_paise"] == 30000 and changed["moved"] is False
    cleared = ok(vbox.call("owner", "POST", f"/visits/{plain['id']}/change", {"clear_advance": True}))
    assert cleared["visit"]["advance_requested"] is False and cleared["visit"]["advance_paise"] is None


def test_a_visit_can_be_moved_and_goes_back_to_booked(vbox: VisitBox) -> None:
    lead = vbox.lead()
    vid = ok(vbox.book(lead.id, 4, "15:00"))["visit"]["id"]
    ok(vbox.call("owner", "POST", f"/visits/{vid}/confirm"))
    moved = ok(vbox.call("sales", "POST", f"/visits/{vid}/change", {"date": vbox.d(4), "slot_start": "15:30", "party_size": 5}))
    assert moved["moved"] is True and moved["visit"]["status"] == "booked" and moved["visit"]["confirmed_at"] is None and moved["visit"]["party_size"] == 5
    assert vbox.call("sales", "POST", f"/visits/{vid}/change", {"date": vbox.d(4)}).status_code == 422
    assert err(vbox.call("sales", "POST", f"/visits/{vid}/change", {"date": vbox.d(-2), "slot_start": "15:30"})) == "date_past"
    assert err(vbox.call("sales", "POST", f"/visits/{vid}/change", {"date": vbox.d(9), "slot_start": "15:30"})) == "shop_closed"


# ---------------------------------------------------------------------------------------------- the steps
def test_the_steps_run_in_order_and_each_refusal_is_fixed(vbox: VisitBox) -> None:
    lead = vbox.lead()
    vid = ok(vbox.book(lead.id, 0, "10:00"))["visit"]["id"]
    assert ok(vbox.call("sales", "POST", f"/visits/{vid}/confirm"))["visit"]["status"] == "confirmed"
    assert ok(vbox.call("sales", "POST", f"/visits/{vid}/confirm"))["replayed"] is True
    assert err(vbox.call("sales", "POST", f"/visits/{vid}/complete", {"outcome": "will_return"})) == "visit_state", "not arrived yet"
    assert ok(vbox.call("sales", "POST", f"/visits/{vid}/arrive"))["visit"]["status"] == "arrived"
    assert err(vbox.call("sales", "POST", f"/visits/{vid}/cancel")) == "visit_state", "someone who is here is not cancelled"
    done = ok(vbox.call("sales", "POST", f"/visits/{vid}/complete", {"outcome": "will_return"}))
    assert done["visit"]["status"] == "completed" and done["visit"]["outcome"] == "will_return" and done["order_id"] is None
    assert ok(vbox.call("sales", "POST", f"/visits/{vid}/complete", {"outcome": "will_return"}))["replayed"] is True
    assert err(vbox.call("sales", "POST", f"/visits/{vid}/complete", {"outcome": "bought"})) == "visit_state"
    for step in ("confirm", "arrive", "no-show", "cancel"):
        assert vbox.call("viewer", "POST", f"/visits/{vid}/{step}").status_code == 403
        assert vbox.call("owner", "POST", f"/visits/{vid}/{step}", box="b").status_code == 404


def test_arriving_is_only_for_today_and_a_no_show_only_once_the_time_has_come(vbox: VisitBox) -> None:
    tomorrow = ok(vbox.book(vbox.lead().id, 1, "10:00"))["visit"]["id"]
    assert err(vbox.call("owner", "POST", f"/visits/{tomorrow}/arrive")) == "visit_state"
    assert err(vbox.call("owner", "POST", f"/visits/{tomorrow}/no-show")) == "visit_state"
    earlier = ok(vbox.book(vbox.lead().id, 0, "10:30"))["visit"]["id"]
    assert ok(vbox.call("owner", "POST", f"/visits/{earlier}/no-show"))["visit"]["status"] == "no_show", "10:30 has passed at both 14:00 and 23:30"
    later = ok(vbox.book(vbox.lead().id, 0, "20:00"))["visit"]["id"]
    r = vbox.call("owner", "POST", f"/visits/{later}/no-show")
    assert (r.status_code == 200) if vbox.night else (r.status_code == 409 and err(r) == "visit_state"), "20:00 is behind us at 23:30 but ahead at 14:00"


def test_a_cancelled_visit_keeps_its_reason_and_frees_the_place(vbox: VisitBox) -> None:
    a, b, c = vbox.lead(), vbox.lead(), vbox.lead()
    ok(vbox.book(a.id, 5, "16:00"))
    vb = ok(vbox.book(b.id, 5, "16:00"))["visit"]["id"]
    assert err(vbox.book(c.id, 5, "16:00")) == "slot_full"
    cancelled = ok(vbox.call("sales", "POST", f"/visits/{vb}/cancel", {"reason": "The customer called to cancel"}))["visit"]
    assert cancelled["status"] == "cancelled" and cancelled["cancel_reason"] == "The customer called to cancel" and cancelled["closed_at"] is not None
    ok(vbox.book(c.id, 5, "16:00"))
    assert vbox.call("sales", "POST", f"/visits/{vb}/cancel", {"reason": "x" * 201}).status_code == 422


# ---------------------------------------------------------------------------------------------- today and the list
def test_today_lists_what_is_still_to_come_in_time_order(vbox: VisitBox) -> None:
    a, b, c, d = (vbox.lead() for _ in range(4))
    t1 = ok(vbox.book(a.id, 0, "18:00", party_size=3, purpose="Bridal sarees"))["visit"]["id"]
    t2 = ok(vbox.book(b.id, 0, "17:30"))["visit"]["id"]
    ok(vbox.call("owner", "POST", f"/visits/{t2}/confirm"))
    t3 = ok(vbox.book(c.id, 0, "19:00"))["visit"]["id"]
    ok(vbox.call("owner", "POST", f"/visits/{t3}/arrive"))
    t4 = ok(vbox.book(d.id, 0, "19:30"))["visit"]["id"]
    ok(vbox.call("owner", "POST", f"/visits/{t4}/cancel"))
    tomorrow = ok(vbox.book(a.id, 1, "10:00"))["visit"]["id"]
    for who in ("owner", "admin", "sales", "viewer"):
        body = ok(vbox.call(who, "GET", "/visits/today"))
        assert body["date"] == vbox.d(0), who
        ids = [i["id"] for i in body["items"]]
        assert t1 in ids and t2 in ids and t3 in ids, who
        assert t4 not in ids, "a cancelled visit is not at the store today"
        assert tomorrow not in ids, "tomorrow is not today"
        starts = [i["starts_at"] for i in body["items"]]
        assert starts == sorted(starts), "time order"
    items = {i["id"]: i for i in ok(vbox.call("viewer", "GET", "/visits/today"))["items"]}
    assert items[t1]["status"] == "requested" and items[t1]["extra"] == 2 and items[t1]["topic"] == "Bridal sarees"
    assert items[t2]["status"] == "confirmed" and items[t3]["visit_status"] == "arrived" and items[t3]["status"] == "confirmed"
    assert set(items[t1]) == {"id", "lead_id", "starts_at", "who", "extra", "topic", "status", "visit_status"}
    assert items[t1]["who"].startswith("Person")
    assert ok(vbox.call("owner", "GET", "/visits/today", box="b"))["items"] == [], "another business sees none of it"


def test_the_list_filters_by_range_status_and_lead(vbox: VisitBox) -> None:
    lead = vbox.lead()
    v1 = ok(vbox.book(lead.id, 6, "10:00"))["visit"]["id"]
    v2 = ok(vbox.book(lead.id, 7, "10:00"))["visit"]["id"]
    ok(vbox.call("owner", "POST", f"/visits/{v2}/cancel"))
    got = ok(vbox.call("viewer", "GET", f"/visits?from={vbox.d(6)}&to={vbox.d(7)}&lead_id={lead.id}"))
    assert got["from"] == vbox.d(6) and got["to"] == vbox.d(7) and [i["id"] for i in got["items"]] == [v1, v2]
    assert [i["id"] for i in ok(vbox.call("viewer", "GET", f"/visits?from={vbox.d(6)}&to={vbox.d(7)}&lead_id={lead.id}&status=cancelled"))["items"]] == [v2]
    assert [i["id"] for i in ok(vbox.call("viewer", "GET", f"/visits?from={vbox.d(6)}&to={vbox.d(7)}&lead_id={lead.id}&open_only=true"))["items"]] == [v1]
    assert vbox.call("viewer", "GET", f"/visits?from={vbox.d(6)}&to={vbox.d(100)}").status_code == 422, "at most 62 days"
    assert vbox.call("viewer", "GET", f"/visits?from={vbox.d(7)}&to={vbox.d(6)}").status_code == 422
    assert ok(vbox.call("owner", "GET", f"/visits?from={vbox.d(6)}&to={vbox.d(7)}", box="b"))["items"] == []


# ---------------------------------------------------------------------------------------------- across midnight
def test_around_midnight_a_slot_belongs_to_the_india_day_it_starts_on(vbox: VisitBox) -> None:
    """Hours to midnight and from midnight; the pin moves from 23:50 to 00:10. The last slot (23:30 to 24:00) is the evening's, the 00:30 slot the next morning's, whatever the UTC date says."""
    midnight_week = {d: {"open": "00:00", "close": "24:00"} for d in OPEN_ALL_WEEK}
    ok(vbox.call("owner", "PUT", "/visits/settings", {"weekly_hours": midnight_week, "closed_dates": [], "slot_minutes": 30, "max_parallel": 2}))
    try:
        a, b = vbox.lead(), vbox.lead()
        evening_day = vbox.today + timedelta(days=11)
        pin_to(evening_day, time(23, 50))
        evening = ok(vbox.call("owner", "POST", "/visits", {"visit_id": str(uuid.uuid4()), "lead_id": a.id, "date": evening_day.isoformat(), "slot_start": "23:30"}))["visit"]
        assert evening["date"] == evening_day.isoformat()
        assert datetime.fromisoformat(evening["ends_at"]).astimezone(IST) == datetime.combine(evening_day + timedelta(days=1), time(0, 0), tzinfo=IST), "it ends exactly at midnight India time"
        morning_day = evening_day + timedelta(days=1)
        morning = ok(vbox.call("owner", "POST", "/visits", {"visit_id": str(uuid.uuid4()), "lead_id": b.id, "date": morning_day.isoformat(), "slot_start": "00:30"}))["visit"]
        assert morning["date"] == morning_day.isoformat()
        assert datetime.fromisoformat(morning["starts_at"]).astimezone(UTC).date() == evening_day, "00:30 India time is still the evening's UTC date"
        at_2350 = ok(vbox.call("viewer", "GET", "/visits/today"))
        assert at_2350["date"] == evening_day.isoformat()
        assert evening["id"] in [i["id"] for i in at_2350["items"]] and morning["id"] not in [i["id"] for i in at_2350["items"]]
        pin_to(morning_day, time(0, 10))
        at_0010 = ok(vbox.call("viewer", "GET", "/visits/today"))
        assert at_0010["date"] == morning_day.isoformat()
        assert morning["id"] in [i["id"] for i in at_0010["items"]] and evening["id"] not in [i["id"] for i in at_0010["items"]]
        assert err(vbox.call("owner", "POST", "/visits", {"visit_id": str(uuid.uuid4()), "lead_id": a.id, "date": evening_day.isoformat(), "slot_start": "20:00"})) == "date_past", "ten minutes after midnight the evening's date has passed"
        assert ok(vbox.call("owner", "POST", f"/visits/{morning['id']}/arrive"))["visit"]["status"] == "arrived", "an early customer, dated today"
        assert ok(vbox.call("owner", "POST", f"/visits/{evening['id']}/no-show"))["visit"]["status"] == "no_show", "the 23:30 visit that never came"
    finally:
        pin_to(*PINS[vbox.kind])
        ok(vbox.call("owner", "PUT", "/visits/settings", {"weekly_hours": OPEN_ALL_WEEK, "closed_dates": [vbox.d(9)], "slot_minutes": 30, "max_parallel": 2}))


# ---------------------------------------------------------------------------------------------- messages through the outbox
def confirmed_visit(box: VisitBox, lead: Lead, offset: int, slot: str, **extra: Any) -> str:
    vid = ok(box.book(lead.id, offset, slot, **extra))["visit"]["id"]
    ok(box.call("owner", "POST", f"/visits/{vid}/confirm"))
    return str(vid)


def test_a_confirmation_goes_through_the_outbox_by_day_and_waits_for_nine_at_night(vbox: VisitBox) -> None:
    lead = vbox.lead()
    vid = confirmed_visit(vbox, lead, 2, "11:00")
    before = len(vbox.adapter.sent)
    out = ok(vbox.call("owner", "POST", f"/visits/{vid}/messages", {"kind": "confirmation"}))
    message = out["message"]
    assert message["category"] == "visit" and message["source"] == "system" and message["flags"] == []
    assert "confirmed" in message["text"] and "11:00 am" in message["text"], "India time, 12-hour in English"
    if vbox.night:
        assert (message["status"], message["reason"]) == ("queued", "quiet_hours") and message["scheduled_for"] is not None
        assert sf(out["dispatched"]) == {"sent": 0, "failed": 0} and len(vbox.adapter.sent) == before, "nothing goes between 9 pm and 9 am"
    else:
        assert sf(out["dispatched"]) == {"sent": 1, "failed": 0}
        assert vbox.adapter.sent[-1].body == message["text"] and vbox.adapter.sent[-1].to_phone == lead.phone
        assert ok(vbox.call("owner", "GET", f"/outbox/messages/{message['id']}"))["status"] == "sent"
    visit = ok(vbox.call("viewer", "GET", f"/visits/{vid}"))
    assert visit["confirmation_message_id"] == message["id"] and visit["confirmation_sent"] is (not vbox.night)
    again = ok(vbox.call("owner", "POST", f"/visits/{vid}/messages", {"kind": "confirmation"}))
    assert again["replayed"] is True and again["message"]["id"] == message["id"] and again["dispatched"] is None
    assert len(vbox.adapter.sent) - before == (0 if vbox.night else 1), "a retry sends nothing twice"


def test_a_reminder_follows_a_confirmed_visit_and_sales_only_makes_the_message(vbox: VisitBox) -> None:
    lead = vbox.lead()
    booked = ok(vbox.book(lead.id, 2, "13:30"))["visit"]["id"]
    assert err(vbox.call("sales", "POST", f"/visits/{booked}/messages", {"kind": "reminder"})) == "visit_state", "not confirmed yet"
    ok(vbox.call("sales", "POST", f"/visits/{booked}/confirm"))
    before = len(vbox.adapter.sent)
    out = ok(vbox.call("sales", "POST", f"/visits/{booked}/messages", {"kind": "reminder"}))
    assert out["message"]["status"] == "queued" and out["dispatched"] is None, "Sales leaves delivery to the next dispatch"
    assert len(vbox.adapter.sent) == before
    assert vbox.call("viewer", "POST", f"/visits/{booked}/messages", {"kind": "reminder"}).status_code == 403
    sent = ok(vbox.call("owner", "POST", "/outbox/dispatch"))
    assert sent["sent"] >= (0 if vbox.night else 1)
    assert ok(vbox.call("viewer", "GET", f"/visits/{booked}"))["reminder_sent"] is (not vbox.night)


def test_a_message_that_mentions_the_advance_waits_for_a_person(vbox: VisitBox) -> None:
    lead = vbox.lead()
    vid = confirmed_visit(vbox, lead, 2, "14:00", advance_paise=50000)
    before = len(vbox.adapter.sent)
    out = ok(vbox.call("owner", "POST", f"/visits/{vid}/messages", {"kind": "confirmation"}))
    message = out["message"]
    assert "₹500.00" in message["text"] and (message["status"], message["reason"], message["flags"]) == ("needs_approval", "money", ["money"])
    assert len(vbox.adapter.sent) == before, "nothing with money goes by itself"
    queue = ok(vbox.call("owner", "GET", "/outbox/approvals"))["items"]
    assert message["id"] in {m["id"] for m in queue}
    approved = ok(vbox.call("owner", "POST", f"/outbox/messages/{message['id']}/approve"))
    assert approved["message"]["reason"] == "owner_approved" or approved["message"]["status"] == "sent"


def test_words_nobody_has_checked_yet_wait_for_a_person_whatever_the_hour(vbox: VisitBox) -> None:
    lead = vbox.lead()
    vid = confirmed_visit(vbox, lead, 2, "14:30")
    before = len(vbox.adapter.sent)
    out = ok(vbox.call("owner", "POST", f"/visits/{vid}/messages", {"kind": "confirmation", "language": "te"}))
    assert out["message"]["language"] == "te" and (out["message"]["status"], out["message"]["reason"]) == ("needs_approval", "uncertain")
    assert "ఆదివారం" in out["message"]["text"] or any(day in out["message"]["text"] for day in texts.WEEKDAYS["te"])
    assert len(vbox.adapter.sent) == before


def test_every_template_in_every_language_passes_the_databases_own_word_check() -> None:
    """The outbox policy matches Indian-language words as SUBSTRINGS, so a template can trip it by accident (a Tamil month ends in the word for tax; a Kannada "if it changes" holds the word for a
    rate). Every confirmation, reminder and offer, in every language, for many dates and hours, must come back with no flag at all (money, commitment, complaint)."""
    bodies: set[str] = set()
    for language in ("en", "te", "hi", "kn", "ta"):
        bodies.add(texts.render("offer", language))
        for month in range(1, 13):
            for day in (1, 9, 17, 28):
                for hour in (1, 4, 9, 15):
                    at = datetime(2026, month, day, hour, 0, tzinfo=UTC)
                    bodies.add(texts.render("confirmation", language, at))
                    bodies.add(texts.render("reminder", language, at))
    ordered = sorted(bodies)
    for start in range(0, len(ordered), 60):  # a command line has a size limit
        values = ",".join(f"($T${b}$T$)" for b in ordered[start : start + 60])
        flagged = operator_sql.sql(f"select t from (values {values}) v(t) where cardinality(app.outbox_content_flags(t)) > 0")
        assert flagged.strip() == "", f"{len(bodies)} templates checked; flagged: {flagged[:300]}"
    with_advance = operator_sql.sql(f"select count(*) from (values ($T${texts.render('confirmation', 'en', datetime(2026, 10, 5, tzinfo=UTC), 50000)}$T$)) v(t) where 'money' = any (app.outbox_content_flags(t))")
    assert with_advance.strip() == "1", "the advance sentence IS flagged: that is what holds the message for a person"


# ---------------------------------------------------------------------------------------------- offer a store visit
def call_request(box: VisitBox, lead: Lead) -> str:
    rid = str(uuid.uuid4())
    body = {"request_id": rid, "lead_id": lead.id, "reason": "The customer wants to talk about a large order", "script_draft": "Hello, this is the shop calling.", "language": "en"}
    ok(box.call("sales", "POST", "/call-requests", body))
    return rid


def test_offering_a_store_visit_declines_the_call_and_queues_the_offer(vbox: VisitBox) -> None:
    lead = vbox.lead()
    rid = call_request(vbox, lead)
    before = len(vbox.adapter.sent)
    for who in ("sales", "admin", "viewer"):
        assert vbox.call(who, "POST", f"/call-requests/{rid}/offer-visit").status_code == 403, who
    assert ok(vbox.call("owner", "GET", f"/call-requests/{rid}"))["status"] == "requested", "nothing changed"
    out = ok(vbox.call("owner", "POST", f"/call-requests/{rid}/offer-visit"))
    assert out["request"]["status"] == "rejected" and out["request"]["decision_note"] == "offer_store_visit"
    message = out["message"]
    assert message["category"] == "visit" and message["source"] == "owner" and message["lead_id"] == lead.id and "₹" not in message["text"]
    if vbox.night:
        assert (message["status"], message["reason"]) == ("queued", "quiet_hours") and len(vbox.adapter.sent) == before
    else:
        assert sf(out["dispatched"]) == {"sent": 1, "failed": 0} and vbox.adapter.sent[-1].body == message["text"]
    today = ok(vbox.call("owner", "GET", "/today"))["needs_you"]
    assert not any(i["kind"] == "call_approval" and i["id"] == rid for i in today), "the call no longer waits"
    again = ok(vbox.call("owner", "POST", f"/call-requests/{rid}/offer-visit"))
    assert again["replayed"] is True and again["message"]["id"] == message["id"] and again["dispatched"] is None
    assert len(vbox.adapter.sent) - before == (0 if vbox.night else 1), "nothing is sent twice"
    assert err(vbox.call("owner", "POST", f"/call-requests/{rid}/approve")) == "outbox_state", "a declined call cannot be approved afterwards"
    assert vbox.call("owner", "POST", f"/call-requests/{uuid.uuid4()}/offer-visit").status_code == 404
    assert vbox.call("owner", "POST", f"/call-requests/{rid}/offer-visit", box="b").status_code == 404


def test_the_offer_to_a_customer_who_asked_us_to_stop_declines_the_call_but_sends_nothing(vbox: VisitBox) -> None:
    lead = vbox.lead()
    rid = call_request(vbox, lead)
    assert vbox.fw.suppress(lead).status_code == 200
    before = len(vbox.adapter.sent)
    out = ok(vbox.call("owner", "POST", f"/call-requests/{rid}/offer-visit"))
    assert out["request"]["status"] == "rejected"
    assert (out["message"]["status"], out["message"]["reason"]) == ("blocked", "stopped")
    assert len(vbox.adapter.sent) == before


def test_an_offer_in_an_unchecked_language_waits_for_a_person(vbox: VisitBox) -> None:
    rid = call_request(vbox, vbox.lead())
    out = ok(vbox.call("owner", "POST", f"/call-requests/{rid}/offer-visit", {"language": "hi"}))
    assert out["message"]["language"] == "hi" and (out["message"]["status"], out["message"]["reason"]) == ("needs_approval", "uncertain")


# ---------------------------------------------------------------------------------------------- the order a "bought" visit starts
@pytest.fixture(scope="module")
def ow(eval_world: World) -> OrderWorld:
    qw = QuoteWorld(eval_world, eval_world.a, n_products=4)
    qw.price_version([qw.item(0, 400000, 4, 500), qw.item(1, 310000, 4, 500)])
    qw.policy_version()
    world = OrderWorld(qw)
    world.policy()
    return world


def test_a_bought_visit_makes_the_order_from_the_approved_quote_or_nothing_changes(vbox: VisitBox, ow: OrderWorld) -> None:
    # a customer with no approved quote at all: nothing to make an order from, and the visit stays arrived (all or nothing)
    nobody = vbox.lead()
    unquoted = ok(vbox.book(nobody.id, 0, "10:00"))["visit"]["id"]
    ok(vbox.call("owner", "POST", f"/visits/{unquoted}/arrive"))
    assert err(vbox.call("owner", "POST", f"/visits/{unquoted}/complete", {"outcome": "bought", "order_id": str(uuid.uuid4())})) == "no_approved_quote"
    assert ok(vbox.call("owner", "GET", f"/visits/{unquoted}"))["status"] == "arrived"
    assert ok(vbox.call("owner", "POST", f"/visits/{unquoted}/complete", {"outcome": "not_interested"}))["visit"]["outcome"] == "not_interested"
    # a customer with an approved quote (the lead the real quote flow quotes)
    base_lead = ow.t.rows["leads"]["id"]
    quote = ow.approved_quote()
    arrived = ok(vbox.book(base_lead, 0, "10:30"))["visit"]["id"]
    ok(vbox.call("owner", "POST", f"/visits/{arrived}/arrive"))
    order_id = str(uuid.uuid4())
    # Sales cannot start an order; the visit stays arrived
    assert vbox.call("sales", "POST", f"/visits/{arrived}/complete", {"outcome": "bought", "order_id": order_id, "quote_id": quote}).status_code == 403
    assert ok(vbox.call("owner", "GET", f"/visits/{arrived}"))["status"] == "arrived"
    done = ok(vbox.call("owner", "POST", f"/visits/{arrived}/complete", {"outcome": "bought", "order_id": order_id, "quote_id": quote}))
    assert done["visit"]["status"] == "completed" and done["visit"]["outcome"] == "bought" and done["order_id"] == order_id
    order = ok(vbox.call("owner", "GET", f"/orders/{order_id}"))
    assert order["quote_id"] == quote and order["state"] == "quote_approved" and order["lead_id"] == base_lead, "the first state of the existing order flow, from the approved quote"
    assert ok(vbox.call("owner", "POST", f"/visits/{arrived}/complete", {"outcome": "bought", "order_id": order_id, "quote_id": quote}))["replayed"] is True
    # the quote has its order: another bought visit naming it is refused by the order flow, and the visit stays arrived
    second = ok(vbox.book(base_lead, 0, "11:30"))["visit"]["id"]
    ok(vbox.call("owner", "POST", f"/visits/{second}/arrive"))
    assert err(vbox.call("owner", "POST", f"/visits/{second}/complete", {"outcome": "bought", "order_id": str(uuid.uuid4()), "quote_id": quote})) == "order_exists"
    assert ok(vbox.call("owner", "GET", f"/visits/{second}"))["status"] == "arrived"
    assert ok(vbox.call("owner", "POST", f"/visits/{second}/complete", {"outcome": "will_return"}))["visit"]["status"] == "completed"


def test_the_second_factor_is_needed_to_start_an_order(vbox: VisitBox, ow: OrderWorld) -> None:
    from conftest import aal1_token

    lead = ow.t.rows["leads"]["id"]
    quote = ow.approved_quote()
    vid = ok(vbox.book(lead, 0, "12:00"))["visit"]["id"]
    ok(vbox.call("owner", "POST", f"/visits/{vid}/arrive"))
    weak = {"Authorization": f"Bearer {aal1_token(vbox.w.stack, vbox.w.a.users['owner'])}"}
    r = vbox.client.post(vbox.url(f"/visits/{vid}/complete"), json={"outcome": "bought", "order_id": str(uuid.uuid4()), "quote_id": quote}, headers=weak)
    assert r.status_code == 403 and err(r) == "mfa_required"
    assert ok(vbox.call("owner", "GET", f"/visits/{vid}"))["status"] == "arrived"


# ---------------------------------------------------------------------------------------------- the weekly AI figure
def test_the_weekly_ai_figure_is_a_percentage_for_owner_and_admin_only(vbox: VisitBox) -> None:
    body = ok(vbox.call("owner", "GET", "/ai-usage/week"))
    assert set(body) == {"week_percent", "resets_at_week"} and 0 <= body["week_percent"] <= 100
    reset = datetime.fromisoformat(body["resets_at_week"]).astimezone(IST)
    assert reset.weekday() == 0 and reset.hour == 0 and reset.minute == 0, "a week resets on Monday 00:00 India time"
    assert ok(vbox.call("admin", "GET", "/ai-usage/week"))["week_percent"] == body["week_percent"]
    assert vbox.call("sales", "GET", "/ai-usage/week").status_code == 403
    assert vbox.call("viewer", "GET", "/ai-usage/week").status_code == 403
    stranger = vbox.client.get(vbox.url("/ai-usage/week", vbox.w.b.id), headers=bearer(vbox.w.a.users["owner"]))
    assert stranger.status_code == 404, "an owner of another business reads nothing of this one"
