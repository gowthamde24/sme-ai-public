"""Job AW (ADR 0068) on the real stack: the scheduler worker with its OWN registered account, real JWT sign-in, real PostgREST, the real database functions and the LOCAL FAKE adapter as the only channel.
Nothing reaches a real channel.

What is proved: the worker does nothing while the global switch or the business's automatic sending is off; held messages are released at 09:00 and not at 08:59, sent at 20:59 and held at 21:00;
the evening-before and heads-up reminders are queued once through the outbox and sent in the same tick; a visit at 00:30 is reminded the evening before and never in quiet hours; an unchecked language
waits for a person; two workers ticking at the same moment send each message and queue each reminder exactly once; a tick that dies between the channel and the database is offered again after the
lease (the message id is the channel's idempotency key); a crashed tick does not stop the next; the automatic no-show is off by default and exact when on; the Owner's card tells the truth; and the
worker's account can read nothing and call nothing but its own functions.

THE CLOCK. Every time decision is the database's, by app.outbox_now(); these tests NEVER lean on the real time. The module pins that clock (for the whole local database, restored afterwards) to
explicit India-time instants on dates 40 days ago, the second pgTAP file 79 tests the same boundaries inside a transaction at 14:00 and 23:30."""

# ruff: noqa: E501, S608

from __future__ import annotations

import threading
import uuid
from collections.abc import Iterator
from datetime import date, datetime, time, timedelta, timezone
from typing import Any

import httpx
import operator_sql
import pytest
from conftest import Stack, User, aal1_token, bearer
from crm_support import World
from fastapi.testclient import TestClient
from followup_support import FollowWorld, Lead
from test_outbox_api import restore_clock

from app.outbox.adapter import LocalFakeAdapter
from app.scheduler.repository import PostgrestSchedulerRepository
from app.scheduler.session import PrincipalSession
from app.scheduler.worker import Worker
from app.tenancy.repository import UpstreamError
from app.visits import texts

IST = timezone(timedelta(hours=5, minutes=30))
D0 = datetime.now(IST).date() - timedelta(days=40)
ALL_DAY = {
    d: {"open": "00:00", "close": "24:00"}
    for d in ("mon", "tue", "wed", "thu", "fri", "sat", "sun")
}


def day(offset: int) -> date:
    return D0 + timedelta(days=offset)


def instant(offset: int, clock: str) -> datetime:
    h, m, *s = (int(p) for p in clock.split(":"))
    return datetime.combine(day(offset), time(h, m, s[0] if s else 0), tzinfo=IST)


def pin(offset: int, clock: str) -> datetime:
    at = instant(offset, clock)
    operator_sql.sql(
        "create or replace function app.outbox_now() returns timestamptz language sql stable security definer set search_path = '' "
        f"as $b$ select timestamptz '{at.isoformat()}' $b$"
    )
    return at


class Sched:
    """The worker's account (signed up like any account, then registered by the operator in the database) and a way to make workers."""

    def __init__(self, stack: Stack, user: User) -> None:
        self.stack, self.user = stack, user

    def session(self) -> PrincipalSession:
        return PrincipalSession(
            f"{self.stack.url}/auth/v1", self.stack.anon_key, self.user.email, self.user.password
        )

    def worker(
        self, repository: PostgrestSchedulerRepository | None = None
    ) -> tuple[Worker, LocalFakeAdapter]:
        adapter = LocalFakeAdapter()
        repo = repository or PostgrestSchedulerRepository(self.stack.rest, self.stack.anon_key)
        return Worker(repo, adapter, self.session(), interval_seconds=60), adapter

    def repo(self) -> PostgrestSchedulerRepository:
        return PostgrestSchedulerRepository(self.stack.rest, self.stack.anon_key)


class Shop:
    def __init__(self, client: TestClient, world: World, sched: Sched, stack: Stack) -> None:
        self.client, self.w, self.sched, self.stack = client, world, sched, stack
        self.fw = FollowWorld(client, world, world.a)
        self.fb = FollowWorld(client, world, world.b)
        self.tenant = world.a.id

    def call(
        self,
        user: str,
        method: str,
        path: str,
        body: Any = None,
        *,
        box: str = "a",
        token: str | None = None,
    ) -> Any:
        users = (self.w.a if box == "a" else self.w.b).users
        headers = {"Authorization": f"Bearer {token}"} if token else bearer(users[user])
        return self.client.request(
            method,
            f"/v1/tenants/{self.tenant if box == 'a' else self.w.b.id}{path}",
            json=body,
            headers=headers,
        )

    def lead(self, box: str = "a") -> Lead:
        return (self.fw if box == "a" else self.fb).lead()

    def submit(
        self, lead: Lead, text: str = "Our new collection is on display at the shop today."
    ) -> str:
        # made by Sales: an Owner's or Admin's own call also dispatches at once through the API's adapter, and these tests are about the worker
        message_id = str(uuid.uuid4())
        r = self.call(
            "sales",
            "POST",
            "/outbox/messages",
            {
                "message_id": message_id,
                "lead_id": lead.id,
                "text": text,
                "language": "en",
                "category": "info",
            },
        )
        assert r.status_code == 200, r.text
        return message_id

    def msg(self, message_id: str) -> tuple[str, str]:
        row = operator_sql.sql(
            f"select status || '/' || reason from public.outbox_messages where id = '{message_id}'"
        )
        return tuple(row.split("/", 1))  # type: ignore[return-value]

    def scheduled_for(self, message_id: str) -> datetime:
        return datetime.fromisoformat(
            operator_sql.sql(
                f"select scheduled_for from public.outbox_messages where id = '{message_id}'"
            ).replace("+00", "+00:00")
        )

    def visit_messages(self, lead: Lead) -> list[tuple[str, str, str, str]]:
        rows = operator_sql.sql(
            f"select id || '|' || status || '|' || reason || '|' || language from public.outbox_messages where lead_id = '{lead.id}' and category = 'visit' order by created_at, id"
        )
        return [tuple(r.split("|")) for r in rows.splitlines() if r]  # type: ignore[misc]

    def visit(
        self, lead: Lead, offset: int, slot: str, *, confirm: bool = True, box: str = "a"
    ) -> str:
        visit_id = str(uuid.uuid4())
        r = self.call(
            "owner",
            "POST",
            "/visits",
            {
                "visit_id": visit_id,
                "lead_id": lead.id,
                "date": day(offset).isoformat(),
                "slot_start": slot,
            },
            box=box,
        )
        assert r.status_code == 200, r.text
        if confirm:
            assert (
                self.call("owner", "POST", f"/visits/{visit_id}/confirm", box=box).status_code
                == 200
            )
        return visit_id

    def visit_status(self, visit_id: str) -> str:
        return str(self.call("owner", "GET", f"/visits/{visit_id}").json()["status"])

    def set_auto(self, on: bool) -> None:
        r = self.call(
            "owner",
            "PUT",
            "/outbox/settings",
            {"auto_send_enabled": on, "per_customer_daily_limit": 5},
        )
        assert r.status_code == 200, r.text

    def set_scheduler(self, **over: Any) -> Any:
        body = {
            "reminder_evening_enabled": True,
            "reminder_evening_hour": 18,
            "reminder_heads_up_enabled": True,
            "reminder_heads_up_minutes": 120,
            "no_show_enabled": False,
            "no_show_after_minutes": 30,
            **over,
        }
        return self.call("owner", "PUT", "/scheduler/settings", body)


def sent_ids(adapter: LocalFakeAdapter) -> list[str]:
    return [str(m.message_id) for m in adapter.sent]


@pytest.fixture(scope="module")
def shop(client: TestClient, eval_world: World, stack: Stack, signup: Any) -> Iterator[Shop]:
    user = signup("scheduler", mfa=False)
    operator_sql.sql(f"select app.operator_register_scheduler('{user.email}')")
    pin(0, "12:00")
    operator_sql.sql("update public.platform_flags set enabled = true where key = 'outbox_enabled'")
    s = Shop(client, eval_world, Sched(stack, user), stack)
    s.set_auto(True)
    r = s.call(
        "owner",
        "PUT",
        "/visits/settings",
        {"weekly_hours": ALL_DAY, "closed_dates": [], "slot_minutes": 30, "max_parallel": 12},
    )
    assert r.status_code == 200, r.text
    try:
        yield s
    finally:
        operator_sql.sql(
            "update public.platform_flags set enabled = false where key = 'outbox_enabled'"
        )
        operator_sql.sql(f"select app.operator_remove_scheduler('{user.email}')")
        restore_clock()


# ---------------------------------------------------------------------------------------------- safe by default
def test_nothing_is_released_while_either_switch_is_off(shop: Shop) -> None:
    pin(0, "14:00")
    lead = shop.lead()
    mid = shop.submit(lead)
    assert shop.msg(mid) == ("queued", "auto_allowed")
    worker, adapter = shop.sched.worker()
    # the GLOBAL switch off
    operator_sql.sql(
        "update public.platform_flags set enabled = false where key = 'outbox_enabled'"
    )
    assert worker.tick_once() is not None
    assert mid not in sent_ids(adapter) and shop.msg(mid) == ("queued", "auto_allowed"), (
        "the kill switch holds the queue"
    )
    # the switch on, the BUSINESS off
    operator_sql.sql("update public.platform_flags set enabled = true where key = 'outbox_enabled'")
    shop.set_auto(False)
    assert worker.tick_once() is not None
    assert mid not in sent_ids(adapter) and shop.msg(mid) == ("queued", "auto_allowed"), (
        "no automatic sending, no automatic release"
    )
    # both on
    shop.set_auto(True)
    assert worker.tick_once() is not None
    assert sent_ids(adapter).count(mid) == 1 and shop.msg(mid)[0] == "sent"
    assert adapter.sent[sent_ids(adapter).index(mid)].body.startswith(
        "Our new collection is on display at the shop today."
    )


def test_a_business_that_did_not_switch_automatic_sending_on_is_left_alone(shop: Shop) -> None:
    pin(0, "17:00")
    lead = shop.lead("b")
    shop.visit(lead, 1, "11:00", box="b")
    pin(0, "18:00")
    worker, adapter = shop.sched.worker()
    worker.tick_once()
    assert shop.visit_messages(lead) == [], "no automatic sending, no reminder"
    assert all(m.to_phone != lead.phone for m in adapter.sent)
    status = shop.call("owner", "GET", "/scheduler/status", box="b").json()
    assert (
        status["active"] is False
        and status["auto_send_enabled"] is False
        and status["platform_switch_on"] is True
    )


# ---------------------------------------------------------------------------------------------- release: quiet hours
def test_a_message_held_for_the_morning_goes_at_nine_and_not_at_eight_fifty_nine(
    shop: Shop,
) -> None:
    pin(0, "22:00")
    lead = shop.lead()
    mid = shop.submit(lead)
    assert shop.msg(mid) == ("queued", "quiet_hours")
    assert shop.scheduled_for(mid) == instant(1, "09:00")
    worker, adapter = shop.sched.worker()
    pin(0, "23:30")
    worker.tick_once()
    pin(1, "08:59")
    worker.tick_once()
    assert mid not in sent_ids(adapter) and shop.msg(mid)[0] == "queued", "08:59 is still night"
    pin(1, "09:00")
    worker.tick_once()
    assert sent_ids(adapter).count(mid) == 1 and shop.msg(mid)[0] == "sent", "09:00: released"
    pin(1, "09:01")
    worker.tick_once()
    assert sent_ids(adapter).count(mid) == 1, "a sent message is never sent again"


def test_a_message_is_sent_at_twenty_fifty_nine_and_held_from_twenty_one(shop: Shop) -> None:
    worker, adapter = shop.sched.worker()
    pin(1, "20:30")
    first = shop.submit(shop.lead())
    pin(1, "20:59")
    second = shop.submit(shop.lead())
    assert shop.msg(first) == ("queued", "auto_allowed") and shop.msg(second) == (
        "queued",
        "auto_allowed",
    )
    worker.tick_once()
    assert {first, second} <= set(sent_ids(adapter)), "20:59 is still day"
    pin(1, "20:59:30")
    third = shop.submit(shop.lead())
    pin(1, "21:00")
    worker.tick_once()
    assert third not in sent_ids(adapter) and shop.msg(third)[0] == "queued", "21:00: quiet hours"
    assert shop.scheduled_for(third) == instant(2, "09:00"), "pushed to the next 09:00"
    pin(2, "09:00")
    worker.tick_once()
    assert sent_ids(adapter).count(third) == 1


# ---------------------------------------------------------------------------------------------- reminders
def test_the_evening_reminder_and_the_heads_up_are_queued_once_and_sent_in_the_same_tick(
    shop: Shop,
) -> None:
    pin(0, "12:00")
    lead = shop.lead()
    visit = shop.visit(lead, 1, "11:00")
    worker, adapter = shop.sched.worker()
    pin(0, "17:59")
    worker.tick_once()
    assert shop.visit_messages(lead) == [], "the evening window opens at 18:00"
    pin(0, "18:00")
    worker.tick_once()
    messages = shop.visit_messages(lead)
    assert len(messages) == 1 and messages[0][1:] == ("sent", "auto_allowed", "en"), messages
    starts = datetime.combine(day(1), time(11, 0), tzinfo=IST)
    body = adapter.sent[sent_ids(adapter).index(messages[0][0])].body
    assert body.startswith(texts.render("reminder", "en", starts)), body
    assert "11:00 am" in body
    pin(0, "18:01")
    worker.tick_once()
    pin(0, "20:59")
    worker.tick_once()
    assert len(shop.visit_messages(lead)) == 1, "once per visit and kind"
    pin(1, "08:59")
    worker.tick_once()
    assert len(shop.visit_messages(lead)) == 1, "08:59 is night: no heads-up"
    pin(1, "09:00")
    worker.tick_once()
    messages = shop.visit_messages(lead)
    assert len(messages) == 2 and all(m[1] == "sent" for m in messages), (
        "09:00: 120 minutes before 11:00"
    )
    pin(1, "09:01")
    worker.tick_once()
    assert len(shop.visit_messages(lead)) == 2
    count = operator_sql.sql(
        f"select count(*) from public.visit_reminders where visit_id = '{visit}'"
    )
    assert count == "2"
    assert (
        operator_sql.sql(
            f"select count(distinct kind) from public.visit_reminders where visit_id = '{visit}'"
        )
        == "2"
    )


def test_a_visit_at_half_past_midnight_is_reminded_the_evening_before_and_never_in_quiet_hours(
    shop: Shop,
) -> None:
    pin(0, "12:00")
    early = shop.lead()
    shop.visit(early, 1, "00:30")
    worker, _ = shop.sched.worker()
    pin(0, "20:59")
    worker.tick_once()
    assert len(shop.visit_messages(early)) == 1, (
        "20:59 is still evening: the reminder for 00:30 tomorrow goes"
    )
    # a visit confirmed at the very end of the evening has missed its window
    pin(0, "20:59:30")
    late = shop.lead()
    shop.visit(late, 1, "00:30")
    for offset, clock in ((0, "21:00"), (0, "22:30"), (1, "00:10"), (1, "09:00")):
        pin(offset, clock)
        worker.tick_once()
        assert len(shop.visit_messages(early)) == 1, (
            offset,
            clock,
            "no heads-up for a visit at 00:30: it would fall in quiet hours",
        )
        assert shop.visit_messages(late) == [], (
            offset,
            clock,
            "from 21:00 nothing is queued for the night",
        )


def test_a_confirmation_just_sent_is_not_followed_by_a_reminder_and_an_unchecked_language_waits_for_a_person(
    shop: Shop,
) -> None:
    pin(0, "12:00")
    hindi, told = shop.lead(), shop.lead()
    v_hi = shop.visit(hindi, 1, "12:00")
    v_told = shop.visit(told, 1, "12:30")
    r = shop.call(
        "sales", "POST", f"/visits/{v_hi}/messages", {"kind": "confirmation", "language": "hi"}
    )
    assert r.status_code == 200 and r.json()["message"]["status"] == "needs_approval"
    worker, adapter = shop.sched.worker()
    pin(0, "18:30")
    r = shop.call("sales", "POST", f"/visits/{v_told}/messages", {"kind": "confirmation"})
    assert r.status_code == 200
    worker.tick_once()
    assert [m[0] for m in shop.visit_messages(told)] == [r.json()["message"]["id"]], (
        "told a moment ago: nothing on top of it"
    )
    reminders = shop.visit_messages(hindi)
    assert len(reminders) == 2 and reminders[1][2:] == ("uncertain", "hi"), reminders
    assert reminders[1][1] == "needs_approval" and reminders[1][0] not in sent_ids(adapter), (
        "unchecked words are never sent automatically"
    )


# ---------------------------------------------------------------------------------------------- two workers, a crashed tick
def test_two_workers_ticking_at_the_same_moment_send_and_queue_everything_exactly_once(
    shop: Shop,
) -> None:
    pin(0, "12:00")
    leads = [shop.lead() for _ in range(8)]
    visits = [
        shop.visit(lead, 1, f"{10 + n // 2}:{'00' if n % 2 == 0 else '30'}")
        for n, lead in enumerate(leads)
    ]
    pin(0, "14:00")
    messages = [shop.submit(shop.lead()) for _ in range(8)]
    pin(0, "18:00")
    (w1, a1), (w2, a2) = shop.sched.worker(), shop.sched.worker()
    barrier = threading.Barrier(2)
    results: list[Any] = []

    def run(worker: Worker) -> None:
        barrier.wait()
        results.append(worker.tick_once())

    threads = [threading.Thread(target=run, args=(w,)) for w in (w1, w2)]
    for t in threads:
        t.start()
    for t in threads:
        t.join(timeout=60)
    assert len(results) == 2 and all(r is not None for r in results), "both ticks finished"
    sent = sent_ids(a1) + sent_ids(a2)
    for mid in messages:
        assert sent.count(mid) == 1 and shop.msg(mid)[0] == "sent", (
            "each message went out exactly once"
        )
    for lead, visit in zip(leads, visits, strict=True):
        got = shop.visit_messages(lead)
        assert len(got) == 1 and got[0][1] == "sent", (lead, got)
        assert sent.count(got[0][0]) == 1, "each reminder was queued once and sent once"
        assert (
            operator_sql.sql(
                f"select count(*) from public.visit_reminders where visit_id = '{visit}'"
            )
            == "1"
        )


class FlakyMark(PostgrestSchedulerRepository):
    """Loses the first report to the database (the process dies between the channel and the database)."""

    def __init__(self, *a: Any, **k: Any) -> None:
        super().__init__(*a, **k)
        self.lose = 1

    def mark(self, token: str, args: dict[str, Any]) -> dict[str, Any]:
        if self.lose:
            self.lose -= 1
            raise UpstreamError("lost")
        return super().mark(token, args)


def test_a_tick_that_dies_between_the_channel_and_the_database_is_offered_again_after_the_lease(
    shop: Shop,
) -> None:
    pin(0, "14:00")
    mid = shop.submit(shop.lead())
    repo = FlakyMark(shop.stack.rest, shop.stack.anon_key)
    worker, adapter = shop.sched.worker(repo)
    worker.tick_once()
    assert sent_ids(adapter).count(mid) == 1
    assert shop.msg(mid)[0] == "queued", "the database was never told"
    pin(0, "14:01")
    worker.tick_once()
    assert sent_ids(adapter).count(mid) == 1, "a minute later the message is still leased"
    pin(0, "14:02:01")
    worker.tick_once()
    assert sent_ids(adapter).count(mid) == 2, (
        "the lease lapsed: offered again, with the SAME message id (the channel's idempotency key)"
    )
    assert shop.msg(mid)[0] == "sent"
    pin(0, "14:05")
    worker.tick_once()
    assert sent_ids(adapter).count(mid) == 2


def test_a_crashed_tick_does_not_stop_the_next_one(shop: Shop) -> None:
    pin(0, "14:10")
    mid = shop.submit(shop.lead())

    class Down(PostgrestSchedulerRepository):
        def tenants(self, token: str) -> list[uuid.UUID]:
            raise UpstreamError("the data layer is down")

    broken, adapter = shop.sched.worker(Down(shop.stack.rest, shop.stack.anon_key))
    first = broken.tick_once()
    assert first is not None and first.tally.errors == 1 and mid not in sent_ids(adapter)
    healthy, adapter2 = shop.sched.worker()
    healthy.tick_once()
    assert sent_ids(adapter2).count(mid) == 1


# ---------------------------------------------------------------------------------------------- automatic no-show
def test_the_automatic_no_show_is_off_by_default_and_exact_when_on(shop: Shop) -> None:
    pin(0, "12:00")
    lead, booked = shop.lead(), shop.lead()
    visit = shop.visit(lead, 3, "10:00")
    unconfirmed = shop.visit(booked, 3, "10:00", confirm=False)
    worker, _ = shop.sched.worker()
    pin(3, "13:00")
    worker.tick_once()
    assert shop.visit_status(visit) == "confirmed", "off by default"
    assert shop.set_scheduler(no_show_enabled=True, no_show_after_minutes=30).status_code == 200
    pin(3, "10:59")
    worker.tick_once()
    assert shop.visit_status(visit) == "confirmed", "the slot ended at 10:30; 29 minutes"
    pin(3, "11:00")
    worker.tick_once()
    assert shop.visit_status(visit) == "no_show", "30 minutes after the slot ended"
    assert shop.visit_status(unconfirmed) == "booked", (
        "a visit the customer never confirmed is not marked"
    )
    assert shop.set_scheduler().status_code == 200


# ---------------------------------------------------------------------------------------------- the Owner's card and settings
def test_the_owners_card_tells_the_truth_and_the_settings_need_the_owner_and_a_second_factor(
    shop: Shop, stack: Stack
) -> None:
    pin(0, "15:00")
    worker, _ = shop.sched.worker()
    worker.tick_once()
    status = shop.call("owner", "GET", "/scheduler/status").json()
    assert (
        status["worker_running"] is True
        and status["active"] is True
        and status["interval_seconds"] == 60
    )
    assert datetime.fromisoformat(status["last_run_at"]) == instant(0, "15:00")
    assert datetime.fromisoformat(status["next_run_at"]) == instant(0, "15:01")
    assert set(status["today"]) == {"sent", "failed", "reminders", "no_shows", "errors"}
    pin(0, "15:03:01")
    assert shop.call("admin", "GET", "/scheduler/status").json()["worker_running"] is False, (
        "three intervals without a tick: not running"
    )
    assert shop.call("sales", "GET", "/scheduler/status").status_code == 403
    assert shop.call("viewer", "GET", "/scheduler/settings").status_code == 403
    assert shop.call("admin", "GET", "/scheduler/settings").status_code == 200
    body = {
        "reminder_evening_enabled": True,
        "reminder_evening_hour": 17,
        "reminder_heads_up_enabled": True,
        "reminder_heads_up_minutes": 90,
        "no_show_enabled": False,
        "no_show_after_minutes": 30,
    }
    assert shop.call("admin", "PUT", "/scheduler/settings", body).status_code == 403, (
        "only the Owner"
    )
    weak = shop.call(
        "owner",
        "PUT",
        "/scheduler/settings",
        body,
        token=aal1_token(stack, shop.w.a.users["owner"]),
    )
    assert weak.status_code == 403 and weak.json()["error"]["code"] == "mfa_required"
    saved = shop.call("owner", "PUT", "/scheduler/settings", body)
    assert saved.status_code == 200 and saved.json() == {**body, "is_default": False}
    assert (
        shop.call(
            "owner", "PUT", "/scheduler/settings", {**body, "reminder_evening_hour": 21}
        ).status_code
        == 422
    )
    assert shop.set_scheduler().status_code == 200


# ---------------------------------------------------------------------------------------------- the worker's account
def test_the_workers_account_reads_nothing_and_calls_nothing_but_its_own_functions(
    shop: Shop, stack: Stack
) -> None:
    token = shop.sched.session().token()
    headers = {
        "apikey": stack.anon_key,
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json",
    }
    for table in (
        "outbox_messages",
        "store_visits",
        "leads",
        "contacts",
        "scheduler_runs",
        "visit_reminders",
        "outbox_settings",
    ):
        r = httpx.get(f"{stack.rest}/{table}?select=*&limit=5", headers=headers, timeout=15)
        assert r.status_code == 200 and r.json() == [], (table, r.text[:100])
    for fn, args in (
        ("outbox_claim_due", {"p_tenant_id": str(shop.tenant), "p_limit": 5}),
        ("scheduler_status", {"p_tenant_id": str(shop.tenant)}),
        ("scheduler_settings_get", {"p_tenant_id": str(shop.tenant)}),
        (
            "visit_step",
            {
                "p_tenant_id": str(shop.tenant),
                "p_visit_id": str(uuid.uuid4()),
                "p_action": "confirm",
            },
        ),
    ):
        r = httpx.post(f"{stack.rest}/rpc/{fn}", headers=headers, json=args, timeout=15)
        assert r.status_code in (401, 403) and r.json().get("code") == "42501", (
            fn,
            r.status_code,
            r.text[:100],
        )
    assert (
        httpx.post(
            f"{stack.rest}/rpc/scheduler_tenants", headers=headers, json={}, timeout=15
        ).status_code
        == 200
    )
    assert shop.call("owner", "GET", "/outbox/messages", token=token).status_code == 404, (
        "the API knows it as nobody's member"
    )


def test_a_person_cannot_call_the_workers_functions_even_an_owner(shop: Shop, stack: Stack) -> None:
    owner = shop.w.a.users["owner"]
    headers = {
        "apikey": stack.anon_key,
        "Authorization": f"Bearer {owner.token}",
        "Content-Type": "application/json",
    }
    for fn, args in (
        ("scheduler_tenants", {}),
        ("scheduler_claim_due", {"p_tenant_id": str(shop.tenant), "p_limit": 5}),
        ("scheduler_mark_no_shows", {"p_tenant_id": str(shop.tenant)}),
        ("scheduler_heartbeat", {"p_interval_seconds": 60, "p_errors": 0}),
    ):
        r = httpx.post(f"{stack.rest}/rpc/{fn}", headers=headers, json=args, timeout=15)
        assert r.status_code == 403 and r.json().get("code") == "42501", (
            fn,
            r.status_code,
            r.text[:100],
        )
    # an unregistered account is nobody too
    stranger = shop.w.a.users["viewer"]
    r = httpx.post(
        f"{stack.rest}/rpc/scheduler_tenants",
        headers={**headers, "Authorization": f"Bearer {stranger.token}"},
        json={},
        timeout=15,
    )
    assert r.status_code == 403
