"""Job AT (ADR 0066) on the real stack: the outbox through OUR API with real JWT verification, real PostgREST and the real database functions, the LOCAL FAKE adapter as the only channel.
A message is decided by the database (policy, blocks, quiet hours, limit, disclosure), delivered only by the fake adapter, and every refusal is a fixed answer. NOTHING reaches a real channel.

Time: the policy keeps quiet hours 21:00 to 09:00 India time by the database's outbox clock, app.outbox_now(). These tests NEVER lean on the real time: the `box` fixture runs the whole module
twice, with that clock pinned (for the module, restored afterwards) to 14:00 IST ("day": a message goes at once) and to 23:30 IST ("night": it is held until 09:00). The pins are on yesterday's India
date, so they are always in the past (an enquiry may not be received in the future). The clock itself is also tested at explicit instants in pgTAP 76."""

# ruff: noqa: E501, S608

from __future__ import annotations

import uuid
from collections.abc import Iterator
from datetime import datetime, time, timedelta, timezone
from typing import Any

import operator_sql
import pytest
from conftest import bearer
from crm_support import World
from fastapi.testclient import TestClient
from followup_support import FollowWorld, Lead

from app.outbox.adapter import LocalFakeAdapter


def sf(dispatched: dict[str, Any]) -> dict[str, int]:
    """Just what the channel did (sent, failed): the dispatch answer also carries counts of what is still waiting (job BB)."""
    return {"sent": dispatched["sent"], "failed": dispatched["failed"]}


TELUGU_PRICE = "ఈ చీర ధర 500 రూపాయలు మాత్రమే"


IST = timezone(timedelta(hours=5, minutes=30))
PINS = {"day": time(14, 0), "night": time(23, 30)}


def pin_clock(at: time) -> str:
    """Pin the outbox clock (for the whole local database, until restore_clock) to `at` India time yesterday; returns the instant."""
    yesterday = datetime.now(IST).date() - timedelta(days=1)
    instant = datetime.combine(yesterday, at, tzinfo=IST).isoformat()
    operator_sql.sql(
        "create or replace function app.outbox_now() returns timestamptz language sql stable security definer set search_path = '' "
        f"as $b$ select timestamptz '{instant}' $b$"
    )
    return instant


def restore_clock() -> None:
    operator_sql.sql(
        "create or replace function app.outbox_now() returns timestamptz language sql stable security definer set search_path = '' as $b$ select now() $b$"
    )


def quiet() -> bool:
    return operator_sql.sql("select app.outbox_in_quiet_hours(app.outbox_now())").strip() == "t"


class Box:
    def __init__(self, client: TestClient, world: World) -> None:
        self.client, self.w = client, world
        self.fw = FollowWorld(client, world, world.a)
        self.fb = FollowWorld(client, world, world.b)
        self.tenant = world.a.id
        runtime = client.app.state.runtime  # type: ignore[attr-defined]
        self.adapter: LocalFakeAdapter = runtime.outbox_adapter
        assert isinstance(self.adapter, LocalFakeAdapter)
        self.pin_name = "day"

    def url(self, path: str, tenant: str | None = None) -> str:
        return f"/v1/tenants/{tenant or self.tenant}{path}"

    def call(
        self,
        user: str,
        method: str,
        path: str,
        body: Any = None,
        *,
        tenant: str | None = None,
        box: str = "a",
    ) -> Any:
        users = (self.w.a if box == "a" else self.w.b).users
        return self.client.request(
            method, self.url(path, tenant), json=body, headers=bearer(users[user])
        )

    def lead(self, **kw: Any) -> Lead:
        return self.fw.lead(**kw)

    def inbound(
        self, lead: Lead, body: str = "Hello, please tell me about your sarees", ago: str = "1 hour"
    ) -> None:
        operator_sql.sql(
            f"insert into public.enquiries (id, tenant_id, lead_id, channel, received_at, body, body_sha256) "
            f"values ('{uuid.uuid4()}', '{self.tenant}', '{lead.id}', 'whatsapp', app.outbox_now() - interval '{ago}', '{body}', repeat('a', 64))"
        )

    def submit(
        self,
        user: str,
        lead: Lead,
        text: str,
        category: str = "reply_to_inbound",
        language: str = "en",
        message_id: str | None = None,
        **extra: Any,
    ) -> Any:
        return self.call(
            user,
            "POST",
            "/outbox/messages",
            {
                "message_id": message_id or str(uuid.uuid4()),
                "lead_id": lead.id,
                "text": text,
                "language": language,
                "category": category,
                **extra,
            },
        )


@pytest.fixture(scope="module", params=sorted(PINS))
def box(request: pytest.FixtureRequest, client: TestClient, eval_world: World) -> Iterator[Box]:
    pin_clock(PINS[request.param])
    assert quiet() == (request.param == "night"), "the pin put the clock where it was asked to"
    operator_sql.sql("update public.platform_flags set enabled = true where key = 'outbox_enabled'")
    b = Box(client, eval_world)
    b.pin_name = request.param  # the pin this run of the module uses (job BB re-pins inside a test and puts it back)
    r = b.call(
        "owner",
        "PUT",
        "/outbox/settings",
        {"auto_send_enabled": True, "per_customer_daily_limit": 3},
    )
    assert r.status_code == 200, r.text
    try:
        yield b
    finally:
        operator_sql.sql(
            "update public.platform_flags set enabled = false where key = 'outbox_enabled'"
        )
        restore_clock()


def body_of(r: Any, code: int = 200) -> Any:
    assert r.status_code == code, (r.status_code, r.text)
    return r.json()


def test_a_plain_reply_within_24_hours_goes_out_through_the_fake_channel_with_the_disclosure(
    box: Box,
) -> None:
    lead = box.lead()
    box.inbound(lead)
    before = len(box.adapter.sent)
    out = body_of(
        box.submit(
            "owner",
            lead,
            "Thank you for writing. We are open from 10 am to 8 pm every day.",
            source="assistant",  # job DX: the AI line labels what the ASSISTANT wrote (a person's reply has none)
        )
    )
    message = out["message"]
    assert message["disclosure_added"] is True and "AI assistant" in message["text"], (
        "the first message the assistant writes to a customer says it is from the AI assistant"
    )
    assert message["flags"] == [] and message["channel"] == "whatsapp"
    if quiet():
        assert (message["status"], message["reason"]) == ("queued", "quiet_hours") and message[
            "scheduled_for"
        ] is not None
        assert sf(out["dispatched"]) == {"sent": 0, "failed": 0} and len(box.adapter.sent) == before, (
            "no message goes between 9 pm and 9 am"
        )
    else:
        assert sf(out["dispatched"]) == {"sent": 1, "failed": 0}
        sent = box.adapter.sent[-1]
        assert sent.body == message["text"] and sent.to_phone == lead.phone
        row = body_of(box.call("owner", "GET", f"/outbox/messages/{message['id']}"))
        assert (
            row["status"] == "sent"
            and row["reason"] == "auto_allowed"
            and row["sent_at"] is not None
        )
    second = body_of(box.submit("owner", lead, "Our shop is open every day.", category="info"))[
        "message"
    ]
    assert second["disclosure_added"] is False, "only the first message carries the line"


def test_a_price_in_telugu_waits_for_a_person_then_goes_only_after_approval(box: Box) -> None:
    lead = box.lead()
    box.inbound(lead)
    before = len(box.adapter.sent)
    out = body_of(box.submit("owner", lead, TELUGU_PRICE, language="te", source="assistant"))  # job DX: the AI line labels what the ASSISTANT wrote
    message = out["message"]
    assert (message["status"], message["reason"], message["flags"]) == (
        "needs_approval",
        "money",
        ["money"],
    )
    assert sf(out["dispatched"]) == {"sent": 0, "failed": 0} and len(box.adapter.sent) == before, (
        "nothing with money goes by itself"
    )
    queue = body_of(box.call("owner", "GET", "/outbox/approvals"))["items"]
    assert message["id"] in {m["id"] for m in queue}
    today = body_of(box.call("owner", "GET", "/today"))["needs_you"]
    mine = [i for i in today if i["id"] == message["id"]]
    assert (
        mine
        and mine[0]["kind"] == "outbox_approval"
        and mine[0]["target"] == {"type": "outbox_message", "id": message["id"]}
    )
    # Sales can neither edit nor approve; an Admin can edit; the Owner approves with a second factor (the default test token is aal2)
    assert box.call("sales", "POST", f"/outbox/messages/{message['id']}/approve").status_code == 403
    assert (
        box.call(
            "sales", "POST", f"/outbox/messages/{message['id']}/edit", {"text": "no"}
        ).status_code
        == 403
    )
    edited = body_of(
        box.call(
            "admin",
            "POST",
            f"/outbox/messages/{message['id']}/edit",
            {"text": "మా కొత్త చీరలు చూడండి, ఈ ఆదివారం రండి"},
        )
    )
    assert (
        edited["status"] == "needs_approval"
        and "మా కొత్త చీరలు" in edited["text"]
        and edited["disclosure_added"] is True
        and "AI" in edited["text"]
    )
    approved = body_of(box.call("owner", "POST", f"/outbox/messages/{message['id']}/approve"))
    assert (approved["message"]["status"], approved["message"]["reason"]) == (
        "queued",
        "owner_approved",
    ) or approved["message"]["status"] == "sent"
    if not quiet():
        assert approved["message"]["status"] == "sent" and approved["dispatched"]["sent"] >= 1
        assert "మా కొత్త చీరలు" in box.adapter.sent[-1].body, "the channel got the EDITED words"
    else:
        assert approved["message"]["scheduled_for"] is not None
    assert (
        box.call("owner", "POST", f"/outbox/messages/{message['id']}/approve").status_code == 409
    ), "approving twice is refused (outbox_state)"


def test_rejecting_a_message_blocks_it_for_good(box: Box) -> None:
    lead = box.lead()
    box.inbound(lead)
    message = body_of(box.submit("owner", lead, "The price is ₹500 each"))["message"]
    assert message["status"] == "needs_approval"
    rejected = body_of(box.call("admin", "POST", f"/outbox/messages/{message['id']}/reject"))[
        "message"
    ]
    assert (rejected["status"], rejected["reason"]) == ("blocked", "owner_rejected")
    assert box.call("owner", "POST", f"/outbox/messages/{message['id']}/approve").status_code == 409


def test_after_stop_nothing_more_goes_and_what_waited_is_blocked_at_once(box: Box) -> None:
    lead = box.lead()
    box.inbound(lead)
    waiting = body_of(box.submit("owner", lead, "The price is ₹700 each"))["message"]
    assert waiting["status"] == "needs_approval"
    assert box.fw.suppress(lead).status_code == 200  # the customer sent STOP; Sales records it
    row = body_of(box.call("owner", "GET", f"/outbox/messages/{waiting['id']}"))
    assert (row["status"], row["reason"]) == ("blocked", "stopped"), (
        "what waited is blocked the moment the customer stops"
    )
    assert box.call("owner", "POST", f"/outbox/messages/{waiting['id']}/approve").status_code == 409
    again = body_of(box.submit("owner", lead, "Thank you for writing to us."))["message"]
    assert (again["status"], again["reason"]) == ("blocked", "stopped")
    call = box.call(
        "sales",
        "POST",
        "/call-requests",
        {
            "request_id": str(uuid.uuid4()),
            "lead_id": lead.id,
            "reason": "A call",
            "script_draft": "Hello",
            "language": "en",
        },
    )
    assert call.status_code == 409 and call.json()["error"]["code"] == "customer_stopped", (
        "nobody phones a customer who asked us to stop"
    )


def test_the_global_kill_switch_blocks_everything(box: Box) -> None:
    lead = box.lead()
    box.inbound(lead)
    operator_sql.sql(
        "update public.platform_flags set enabled = false where key = 'outbox_enabled'"
    )
    try:
        before = len(box.adapter.sent)
        message = body_of(box.submit("owner", lead, "Thank you for writing to us."))["message"]
        assert (message["status"], message["reason"]) == ("blocked", "switch_off")
        assert sf(body_of(box.call("owner", "POST", "/outbox/dispatch"))) == {"sent": 0, "failed": 0}
        assert len(box.adapter.sent) == before
    finally:
        operator_sql.sql(
            "update public.platform_flags set enabled = true where key = 'outbox_enabled'"
        )


def test_the_per_customer_daily_limit(box: Box) -> None:
    lead = box.lead()
    first = [
        body_of(
            box.submit(
                "owner", lead, f"Hello, our new collection {n} is here.", category="followup"
            )
        )["message"]["status"]
        for n in range(3)
    ]
    assert first == ["queued", "queued", "queued"] or all(s in ("queued", "sent") for s in first)
    fourth = body_of(box.submit("owner", lead, "One more thing to show you.", category="followup"))[
        "message"
    ]
    assert (fourth["status"], fourth["reason"]) == ("blocked", "daily_limit")
    assert (
        box.call(
            "owner",
            "PUT",
            "/outbox/settings",
            {"auto_send_enabled": True, "per_customer_daily_limit": 4},
        ).status_code
        == 200
    )
    fifth = body_of(
        box.submit("owner", lead, "And one last thing for today.", category="followup")
    )["message"]
    assert fifth["status"] in ("queued", "sent")
    assert (
        box.call(
            "owner",
            "PUT",
            "/outbox/settings",
            {"auto_send_enabled": True, "per_customer_daily_limit": 3},
        ).status_code
        == 200
    )


def test_a_retry_with_the_same_id_replays_and_sends_once(box: Box) -> None:
    lead = box.lead()
    box.inbound(lead)
    mid = str(uuid.uuid4())
    before = len(box.adapter.sent)
    first = body_of(box.submit("owner", lead, "Thank you for writing to us.", message_id=mid))
    again = body_of(box.submit("owner", lead, "Thank you for writing to us.", message_id=mid))
    assert first["replayed"] is False and again["replayed"] is True and again["dispatched"] is None
    assert again["message"]["id"] == first["message"]["id"]
    assert len(box.adapter.sent) - before == (0 if quiet() else 1)
    other = box.submit("owner", lead, "Some other words entirely.", message_id=mid)
    assert other.status_code == 409, "the same id with other words is refused"
    assert sf(box.call("owner", "POST", "/outbox/dispatch").json()) == {"sent": 0, "failed": 0}, (
        "a second dispatch finds nothing to send twice"
    )


def test_a_failing_channel_marks_the_message_failed(box: Box) -> None:
    lead = box.lead()
    box.inbound(lead)
    mid = uuid.uuid4()
    box.adapter.fail_next(mid, "timeout")
    out = body_of(box.submit("owner", lead, "Thank you for writing to us.", message_id=str(mid)))
    if quiet():
        # at night nothing reaches the channel, so the failure cannot happen yet: the message is only held for 09:00
        assert sf(out["dispatched"]) == {"sent": 0, "failed": 0}
        assert (out["message"]["status"], out["message"]["reason"]) == ("queued", "quiet_hours")
        return
    assert sf(out["dispatched"]) == {"sent": 0, "failed": 1}
    assert (out["message"]["status"], out["message"]["reason"], out["message"]["failure_code"]) == (
        "failed",
        "send_failed",
        "timeout",
    )


def test_the_business_must_switch_automatic_sending_on(box: Box) -> None:
    assert (
        box.call(
            "admin",
            "PUT",
            "/outbox/settings",
            {"auto_send_enabled": False, "per_customer_daily_limit": 3},
        ).status_code
        == 403
    ), "only the Owner changes the settings"
    assert (
        box.call(
            "owner",
            "PUT",
            "/outbox/settings",
            {"auto_send_enabled": False, "per_customer_daily_limit": 3},
        ).status_code
        == 200
    )
    try:
        lead = box.lead()
        box.inbound(lead)
        message = body_of(box.submit("owner", lead, "Thank you for writing to us."))["message"]
        assert (message["status"], message["reason"]) == ("needs_approval", "auto_off")
    finally:
        assert (
            box.call(
                "owner",
                "PUT",
                "/outbox/settings",
                {"auto_send_enabled": True, "per_customer_daily_limit": 3},
            ).status_code
            == 200
        )
    settings = body_of(box.call("admin", "GET", "/outbox/settings"))
    assert settings == {
        "platform_switch_on": True,
        "auto_send_enabled": True,
        "per_customer_daily_limit": 3,
        "quiet_hours_start": 21,
        "quiet_hours_end": 9,
    }
    assert box.call("sales", "GET", "/outbox/settings").status_code == 403


def test_a_call_request_is_only_a_request_until_the_owner_approves_and_nobody_dials(
    box: Box,
) -> None:
    lead = box.lead()
    before = len(box.adapter.sent)
    rid = str(uuid.uuid4())
    body = {
        "request_id": rid,
        "lead_id": lead.id,
        "reason": "The customer asked for a call about a large order",
        "script_draft": "Hello, this is the shop calling about your enquiry.",
        "language": "en",
    }
    made = body_of(box.call("sales", "POST", "/call-requests", body))
    assert made["request"]["status"] == "requested" and made["replayed"] is False
    assert body_of(box.call("sales", "POST", "/call-requests", body))["replayed"] is True
    today = body_of(box.call("owner", "GET", "/today"))["needs_you"]
    assert any(
        i["kind"] == "call_approval" and i["id"] == rid and i["target"]["type"] == "call_request"
        for i in today
    )
    assert not any(
        i["kind"] == "call_approval"
        for i in body_of(box.call("admin", "GET", "/today"))["needs_you"]
    ), "an Admin does not decide calls"
    for who in ("sales", "admin", "viewer"):
        assert box.call(who, "POST", f"/call-requests/{rid}/approve").status_code == 403, who
    approved = body_of(
        box.call("owner", "POST", f"/call-requests/{rid}/approve", {"note": "Go ahead before noon"})
    )
    assert (
        approved["status"] == "approved"
        and approved["decision_note"] == "Go ahead before noon"
        and approved["decided_at"] is not None
    )
    assert box.call("owner", "POST", f"/call-requests/{rid}/reject").status_code == 409, (
        "a decided call stays decided"
    )
    assert len(box.adapter.sent) == before, "approving a call sends nothing and dials nobody"
    listed = body_of(box.call("sales", "GET", "/call-requests?status=approved"))["items"]
    assert rid in {c["id"] for c in listed}
    assert box.call("viewer", "GET", "/call-requests").status_code == 403


def test_another_business_sees_none_of_it_and_a_viewer_sees_nothing(box: Box) -> None:
    lead = box.lead()
    box.inbound(lead)
    message = body_of(box.submit("owner", lead, "The price is ₹800 each"))["message"]
    assert (
        box.call(
            "owner", "GET", f"/outbox/messages/{message['id']}", tenant=box.w.b.id, box="b"
        ).status_code
        == 404
    )
    assert (
        box.call("owner", "GET", f"/outbox/messages/{message['id']}", box="b").status_code == 404
    ), "B's owner on A's path is a stranger"
    assert (
        box.call(
            "owner", "POST", f"/outbox/messages/{message['id']}/approve", tenant=box.w.b.id, box="b"
        ).status_code
        == 404
    )
    assert (
        body_of(box.call("owner", "GET", "/outbox/messages", tenant=box.w.b.id, box="b"))["items"]
        == []
    )
    assert box.call("viewer", "GET", "/outbox/messages").status_code == 403
    assert (
        box.call(
            "viewer",
            "POST",
            "/outbox/messages",
            {
                "message_id": str(uuid.uuid4()),
                "lead_id": lead.id,
                "text": "Hello there",
                "language": "en",
                "category": "info",
            },
        ).status_code
        == 403
    )
    assert box.submit("owner", box.fb.lead(), "Hello there", category="info").status_code in (
        404,
        422,
        409,
        403,
    ), "a lead of another business cannot be messaged"


def test_the_log_pages_and_filters(box: Box) -> None:
    lead = box.lead()
    for n in range(3):
        box.submit("owner", lead, f"Message number {n} for the log.", category="followup")
    page = body_of(box.call("owner", "GET", f"/outbox/messages?lead_id={lead.id}&limit=2"))
    assert len(page["items"]) == 2 and page["next_cursor"]
    rest = body_of(
        box.call(
            "owner",
            "GET",
            f"/outbox/messages?lead_id={lead.id}&limit=2&after={page['next_cursor']}",
        )
    )
    seen = {m["id"] for m in page["items"]} | {m["id"] for m in rest["items"]}
    assert len(seen) == 3 and not (
        {m["id"] for m in page["items"]} & {m["id"] for m in rest["items"]}
    )
    blocked = body_of(box.call("owner", "GET", "/outbox/messages?status=blocked"))["items"]
    assert blocked and all(m["status"] == "blocked" for m in blocked)
    for m in page["items"]:
        assert set(m) >= {
            "id",
            "status",
            "reason",
            "reason_text",
            "flags",
            "customer",
            "text",
            "scheduled_for",
        } and "phone" not in str(m).lower().replace("telephone", "")


def test_the_main_agent_can_name_what_waits_for_approval_without_showing_the_text(
    box: Box, stack: Any
) -> None:
    """Today lists a message held for approval and a call request; the assistant's "what needs me today" must be able to cite them (job AT)."""
    from assistant_support import (
        assistant_app,
        conversation_of,
        enable_assistant,
        events,
        restore,
        sources_of,
        text_of,
    )

    lead = box.lead()
    box.inbound(lead)
    secret = "The price is ₹4321 each, a secret to keep out of the answer"
    held = body_of(box.submit("owner", lead, secret))["message"]
    assert held["status"] == "needs_approval"
    rid = str(uuid.uuid4())
    body_of(
        box.call(
            "sales",
            "POST",
            "/call-requests",
            {
                "request_id": rid,
                "lead_id": lead.id,
                "reason": "A call about the large order",
                "script_draft": "Hello, calling about it.",
                "language": "en",
            },
        )
    )
    saved = enable_assistant([box.w.a])
    try:
        for app in assistant_app(stack):
            r = app.post(
                f"/v1/tenants/{box.tenant}/assistant/messages",
                json={"message_id": str(uuid.uuid4()), "text": "What is waiting for me today?"},
                headers=bearer(box.w.a.users["owner"]),
            )
            assert r.status_code == 200, r.text
            evts = events(r)
            assert evts[-1][0] == "done", evts[-1]
            kinds = {(s["kind"], s["id"]) for s in sources_of(evts)}
            assert ("outbox_message", held["id"]) in kinds or ("call_request", rid) in kinds, kinds
            cid = conversation_of(evts)
            stored = app.get(
                f"/v1/tenants/{box.tenant}/assistant/conversations/{cid}",
                headers=bearer(box.w.a.users["owner"]),
            )
            assert stored.status_code == 200, stored.text
            stored_labels = " ".join(
                s["label"] for m in stored.json()["messages"] for s in m["sources"]
            )
            assert "WhatsApp message to" in stored_labels or "Call request for" in stored_labels, (
                stored_labels
            )
            assert "4321" not in stored_labels and "no longer available" not in stored_labels
            labels = " ".join(s["label"] for s in sources_of(evts))
            assert "4321" not in labels and "4321" not in text_of(evts), (
                "the text of a held message is never shown as a label"
            )
    finally:
        restore(saved)


def test_a_reply_inside_an_active_conversation_goes_now_even_at_night(box: Box) -> None:
    """Job DX: quiet hours hold what the business starts, not an answer to a customer who wrote a few minutes ago. The customer wrote 10 minutes ago: the reply goes now on both pins."""
    lead = box.lead()
    box.inbound(lead, ago="10 minutes")
    before = len(box.adapter.sent)
    out = body_of(box.submit("owner", lead, "Yes, the green silk saree is in stock.", source="owner"))
    message = out["message"]
    assert (message["status"], message["reason"]) == ("sent", "auto_allowed") or (message["status"], message["reason"]) == ("queued", "auto_allowed")
    assert sf(out["dispatched"]) == {"sent": 1, "failed": 0} and len(box.adapter.sent) - before == 1
    assert message["disclosure_added"] is False and "AI assistant" not in box.adapter.sent[-1].body, "a reply a person wrote carries no AI line"


def test_a_follow_up_or_an_old_conversation_still_waits_for_morning(box: Box) -> None:
    lead = box.lead()
    box.inbound(lead, ago="10 minutes")
    old = box.lead()
    box.inbound(old, ago="3 hours")
    before = len(box.adapter.sent)
    follow = body_of(box.submit("owner", lead, "Just checking in on the saree.", category="followup", source="owner"))
    stale = body_of(box.submit("owner", old, "Thank you for writing to us.", source="owner"))
    if quiet():
        assert (follow["message"]["status"], follow["message"]["reason"]) == ("queued", "quiet_hours")
        assert (stale["message"]["status"], stale["message"]["reason"]) == ("queued", "quiet_hours")
        assert len(box.adapter.sent) == before
    else:
        assert follow["message"]["reason"] == "auto_allowed" and stale["message"]["reason"] == "auto_allowed"


def test_only_what_the_assistant_wrote_gets_the_ai_line(box: Box) -> None:
    mine, theirs = box.lead(), box.lead()
    box.inbound(mine, ago="10 minutes")
    box.inbound(theirs, ago="10 minutes")
    person = body_of(box.submit("owner", mine, "I will send the photos now.", source="owner"))["message"]
    assistant = body_of(box.submit("owner", theirs, "We are open from 10 am to 8 pm.", source="assistant"))["message"]
    assert person["disclosure_added"] is False and "AI assistant" not in person["text"]
    assert assistant["disclosure_added"] is True and "AI assistant" in assistant["text"]
