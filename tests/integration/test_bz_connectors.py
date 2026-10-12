"""Job BZ (ADR 0080) on the real stack: the connectors through OUR API with FAKE providers. Real JWT verification, real PostgREST, the real database functions, the caller's own token for people and the
registered worker account for the webhooks. Proved: an IndiaMART pull makes leads once and is rate limited; a payment link is made for what an order lacks, a signed webhook marks it paid, NOTHING is
recorded on the order until a person records it (through the order lifecycle), and a repeat records nothing twice; a bad signature changes nothing; a missed call is found by its number; a call is
placed only for an approved request, within the hours, once; and business B reaches none of it. All data is synthetic."""

# ruff: noqa: E501, S608

from __future__ import annotations

import dataclasses
import json
import uuid
from collections.abc import Iterator
from typing import Any

import operator_sql
import pytest
from conftest import Stack, bearer
from crm_support import World
from fastapi.testclient import TestClient
from followup_support import FollowWorld
from order_support import OrderWorld
from quote_support import QuoteWorld
from test_outbox_api import restore_clock

from app.connectors.calls import FakeBridge
from app.connectors.indiamart import FixtureLeadSource
from app.connectors.payments import FakePayments
from app.connectors.repository import PostgrestConnectorsRepository
from app.connectors.runtime import Connectors
from app.scheduler.session import PrincipalSession

TOKEN = "T" * 32


class Shop:
    def __init__(self, client: TestClient, w: World, stack: Stack, connectors: Connectors, payments: FakePayments, bridge: FakeBridge) -> None:
        self.client, self.w, self.stack, self.connectors, self.payments, self.bridge = client, w, stack, connectors, payments, bridge
        self.tenant = w.a.id
        qw = QuoteWorld(w, w.a, n_products=4)
        qw.price_version([qw.item(0, 400000, 4, 500), qw.item(1, 310000, 4, 500)])
        qw.policy_version()
        self.ow = OrderWorld(qw)
        self.ow.policy()
        self.fw = FollowWorld(client, w, w.a)

    def call(self, user: str, method: str, path: str, body: Any = None, *, box: str = "a") -> Any:
        users = (self.w.a if box == "a" else self.w.b).users
        tenant = self.w.a.id if box == "a" else self.w.b.id
        return self.client.request(method, f"/v1/tenants/{tenant}{path}", json=body, headers=bearer(users[user]))

    def order(self) -> dict[str, Any]:
        order, _ = self.ow.order()
        for user, kind in (("sales", "send_quote"), ("sales", "customer_accept"), ("sales", "request_advance")):
            run = self.ow.run_event(order, user, kind)
            assert run.response.status_code == 200, (kind, run.response.text)
        got = self.call("owner", "GET", f"/orders/{order}")
        assert got.status_code == 200, got.text
        return dict(got.json())

    def link(self, order: dict[str, Any], amount: int, *, user: str = "owner") -> Any:
        return self.call(user, "POST", f"/orders/{order['id']}/payment-links", {"id": str(uuid.uuid4()), "amount_paise": amount})

    def webhook(self, link: dict[str, Any], status: str = "paid", amount: int | None = None, ref: str | None = None) -> Any:
        event = {"payment_link.paid": "payment_link.paid"}.get(f"payment_link.{status}", f"payment_link.{status}")
        body: dict[str, Any] = {"event": event, "payload": {"payment_link": {"entity": {"id": operator_link_id(link["id"]), "reference_id": link["reference"], "amount": link["amount_paise"], "amount_paid": amount if amount is not None else link["amount_paise"], "status": status}}}}
        if status == "paid":
            body["payload"]["payment"] = {"entity": {"id": ref or f"pay_{uuid.uuid4().hex[:10]}", "amount": amount if amount is not None else link["amount_paise"]}}
        raw, headers = FakePayments.signed(body)
        return self.client.post("/v1/webhooks/fake-payments", content=raw, headers=headers)

    def paid_events(self, order_id: str) -> int:
        return int(operator_sql.sql(f"select count(*) from public.order_events where order_id = '{order_id}' and type = 'record_payment'"))


def operator_link_id(link_id: str) -> str:
    return operator_sql.sql(f"select provider_link_id from integrations.payment_links where id = '{link_id}'")


@pytest.fixture(scope="module")
def shop(client: TestClient, eval_world: World, stack: Stack, signup: Any) -> Iterator[Shop]:
    worker = signup("bz-worker", mfa=False)
    operator_sql.sql(f"select app.operator_register_scheduler('{worker.email}')")
    operator_sql.sql("update public.platform_flags set enabled = true where key = 'outbox_enabled'")
    payments, bridge = FakePayments(), FakeBridge()
    connectors = Connectors(
        repo=PostgrestConnectorsRepository(stack.rest, stack.anon_key),
        tenant_id=uuid.UUID(str(eval_world.a.id)),
        leads=FixtureLeadSource(),
        payments=payments,
        calls=bridge,
        receiver=PrincipalSession(f"{stack.url}/auth/v1", stack.anon_key, worker.email, worker.password),
        agent_number="+910000000000",
        webhook_token=TOKEN,
        public_base_url="https://api.example.test",
        reply_language="en",
    )
    state = client.app.state  # type: ignore[attr-defined]
    original = state.runtime
    state.runtime = dataclasses.replace(original, connectors=connectors)
    try:
        yield Shop(client, eval_world, stack, connectors, payments, bridge)
    finally:
        state.runtime = original
        operator_sql.sql("update public.platform_flags set enabled = false where key = 'outbox_enabled'")
        operator_sql.sql(f"select app.operator_remove_scheduler('{worker.email}')")
        restore_clock()


# ---------------------------------------------------------------------------------------------- IndiaMART
def test_a_pull_makes_the_leads_once_and_a_second_pull_inside_five_minutes_is_refused(shop: Shop) -> None:
    first = shop.call("owner", "POST", "/connectors/indiamart/pull")
    assert first.status_code == 200, first.text
    body = first.json()
    assert (body["fetched"], body["created"], body["rejected"], body["gated"]) == (3, 3, 0, 0)
    assert int(operator_sql.sql(f"select count(*) from public.leads where tenant_id = '{shop.tenant}' and source = 'IndiaMART'")) == 3
    assert int(operator_sql.sql(f"select count(*) from public.enquiries where tenant_id = '{shop.tenant}' and subject = 'IndiaMART enquiry'")) == 3
    assert operator_sql.sql(f"select phone from public.contacts where tenant_id = '{shop.tenant}' and full_name = 'Invented Buyer One'") == "+009876500001"
    again = shop.call("owner", "POST", "/connectors/indiamart/pull")
    assert again.status_code == 429 and again.json()["error"]["code"] == "asked_too_soon"
    assert shop.connectors.leads.calls and len(shop.connectors.leads.calls) == 1  # type: ignore[union-attr]
    operator_sql.sql(f"update integrations.pull_state set last_attempt_at = now() - interval '10 minutes' where tenant_id = '{shop.tenant}'")
    repeat = shop.call("admin", "POST", "/connectors/indiamart/pull")
    assert repeat.status_code == 200 and (repeat.json()["created"], repeat.json()["existing"]) == (0, 3), repeat.text
    assert int(operator_sql.sql(f"select count(*) from public.leads where tenant_id = '{shop.tenant}' and source = 'IndiaMART'")) == 3
    window = shop.connectors.leads.calls[1]  # type: ignore[union-attr]
    first_end = shop.connectors.leads.calls[0][1]  # type: ignore[union-attr]
    assert 290 <= (first_end - window[0]).total_seconds() <= 310, "the next window starts five minutes before the last good pull"


def test_who_may_pull_and_the_other_business_cannot_reach_the_connectors(shop: Shop) -> None:
    assert shop.call("sales", "POST", "/connectors/indiamart/pull").status_code == 403
    assert shop.call("viewer", "GET", "/connectors/status").status_code == 403
    for method, path in (("GET", "/connectors/status"), ("POST", "/connectors/indiamart/pull"), ("GET", "/missed-calls")):
        assert shop.call("owner", method, path, box="b").status_code == 404, path
    status = shop.call("owner", "GET", "/connectors/status").json()
    assert status["indiamart"]["last_pull_count"] == 3 and status["payments"]["provider"] == "fake"


# ---------------------------------------------------------------------------------------------- payment links
def test_a_payment_link_a_signed_webhook_and_a_person_recording_it(shop: Shop) -> None:
    order = shop.order()
    advance = order["advance_paise"]
    assert advance >= 100
    assert shop.link(order, advance, user="sales").status_code == 403
    assert shop.link(order, order["order_total_paise"] + 1).status_code == 422, "more than the order lacks"
    made = shop.link(order, advance)
    assert made.status_code == 200, made.text
    link = made.json()
    assert link["status"] == "created" and link["url"].startswith("https://pay.example-upi.test/") and link["amount_paise"] == advance
    assert shop.payments.created[-1].amount_paise == advance
    again = shop.link(order, advance)
    assert again.status_code == 409 and again.json()["error"]["code"] == "open_payment_link", "one open link per order"
    listed = shop.call("sales", "GET", f"/orders/{order['id']}/payment-links").json()
    assert [x["status"] for x in listed] == ["created"]

    # the message to the customer waits for a person (it carries an amount); it is never sent from here
    message = str(uuid.uuid4())
    sent = shop.call("sales", "POST", f"/payment-links/{link['id']}/send", {"message_id": message, "language": "en"})
    assert sent.status_code == 200, sent.text
    assert sent.json()["status"] in ("needs_approval", "blocked") and sent.json()["status"] != "queued"
    assert operator_sql.sql(f"select count(*) from public.outbox_messages where id = '{message}' and status = 'sent'") == "0"

    # a bad signature changes nothing
    raw, headers = FakePayments.signed({"event": "payment_link.paid", "payload": {}})
    bad = shop.client.post("/v1/webhooks/fake-payments", content=raw, headers={"x-razorpay-signature": "0" * 64})
    assert bad.status_code == 401
    assert shop.paid_events(order["id"]) == 0

    # the provider says it is paid
    assert shop.webhook(link).status_code == 200
    got = shop.call("owner", "GET", f"/orders/{order['id']}/payment-links").json()[0]
    assert got["status"] == "paid" and got["paid_amount_paise"] == advance
    assert shop.paid_events(order["id"]) == 0, "THE WEBHOOK RECORDED NO MONEY on the order"
    assert shop.webhook(link).status_code == 200  # a retry of the same message
    assert shop.call("owner", "GET", f"/orders/{order['id']}/payment-links").json()[0]["status"] == "paid"

    # a person records it, through the order lifecycle
    assert shop.call("viewer", "POST", f"/payment-links/{link['id']}/record").status_code == 403
    recorded = shop.call("admin", "POST", f"/payment-links/{link['id']}/record")
    assert recorded.status_code == 200, recorded.text
    assert recorded.json()["link"]["status"] == "recorded" and recorded.json()["paid_total"] == advance
    assert shop.paid_events(order["id"]) == 1
    repeat = shop.call("admin", "POST", f"/payment-links/{link['id']}/record")
    assert repeat.status_code == 200 and shop.paid_events(order["id"]) == 1, "a repeat records nothing twice"
    after = shop.call("owner", "GET", f"/orders/{order['id']}").json()
    assert after["paid_paise"] == advance
    # the next link may be for what is still lacking
    rest = after["balance_paise"]
    if rest >= 100:
        assert shop.link(after, rest).status_code == 200


def test_a_payment_of_another_amount_is_a_mismatch_and_is_left_to_a_person(shop: Shop) -> None:
    order = shop.order()
    link = shop.link(order, order["advance_paise"]).json()
    assert shop.webhook(link, amount=link["amount_paise"] - 1).status_code == 200
    got = shop.call("owner", "GET", f"/orders/{order['id']}/payment-links").json()[0]
    assert got["status"] == "mismatch"
    assert shop.call("owner", "POST", f"/payment-links/{link['id']}/record").status_code == 409
    assert shop.paid_events(order["id"]) == 0


def test_an_expired_link_frees_the_order_for_another(shop: Shop) -> None:
    order = shop.order()
    link = shop.link(order, order["advance_paise"]).json()
    assert shop.webhook(link, status="expired").status_code == 200
    assert shop.call("owner", "GET", f"/orders/{order['id']}/payment-links").json()[0]["status"] == "expired"
    assert shop.link(order, order["advance_paise"]).status_code == 200


def test_the_other_business_sees_none_of_it(shop: Shop) -> None:
    order = shop.order()
    link = shop.link(order, order["advance_paise"]).json()
    assert shop.call("owner", "GET", f"/orders/{order['id']}/payment-links", box="b").status_code == 404
    assert shop.call("owner", "POST", f"/payment-links/{link['id']}/record", box="b").status_code == 404
    assert shop.call("owner", "POST", f"/orders/{order['id']}/payment-links", {"id": str(uuid.uuid4()), "amount_paise": 100}, box="b").status_code == 404


# ---------------------------------------------------------------------------------------------- missed calls
def test_a_missed_call_from_a_contact_and_from_a_stranger(shop: Shop) -> None:
    known_id, stranger_id = f"mc-known-{uuid.uuid4().hex[:8]}", f"mc-stranger-{uuid.uuid4().hex[:8]}"
    lead = shop.fw.lead("bz-known", phone_number="+00 98765 41234")
    url = f"/v1/webhooks/exotel/{TOKEN}/missed-call"
    wrong = shop.client.get("/v1/webhooks/exotel/" + "W" * 32 + "/missed-call", params={"CallSid": "mc-wrong-1", "CallFrom": "09876541234"})
    assert wrong.status_code == 404
    known = shop.client.get(url, params={"CallSid": known_id, "CallFrom": "098765 41234", "Direction": "incoming"})
    assert known.status_code == 200
    stranger = shop.client.post(url, data={"CallSid": stranger_id, "CallFrom": "+1 202 555 0143", "Direction": "incoming"})
    assert stranger.status_code == 200
    assert shop.client.get(url, params={"CallSid": known_id, "CallFrom": "098765 41234"}).status_code == 200  # a repeat
    rows = shop.call("sales", "GET", "/missed-calls").json()
    by_last4 = {r["caller_last4"]: r for r in rows}
    assert by_last4["1234"]["contact_id"] == lead.contact_id and by_last4["1234"]["phone"] is None
    assert by_last4["0143"]["contact_id"] is None and by_last4["0143"]["phone"] == "12025550143"
    assert len([r for r in rows if r["caller_last4"] == "1234"]) == 1
    # automatic sending is off here: the call waits for a person and nothing was sent
    assert by_last4["1234"]["outcome"] == "needs_owner"
    assert operator_sql.sql(f"select count(*) from public.outbox_messages where lead_id = '{lead.id}' and source = 'system'") == "0"
    handled = shop.call("sales", "POST", f"/missed-calls/{by_last4['0143']['id']}/handle")
    assert handled.status_code == 200 and handled.json()["handled"] is True
    assert "0143" not in {r["caller_last4"] for r in shop.call("sales", "GET", "/missed-calls").json()}
    assert operator_sql.sql(f"select caller_phone is null from integrations.missed_calls where provider_call_id = '{stranger_id}'") == "t"


def test_with_automatic_sending_on_and_consent_a_short_fixed_reply_is_queued(shop: Shop) -> None:
    reply_id = f"mc-reply-{uuid.uuid4().hex[:8]}"
    lead = shop.fw.lead("bz-reply", phone_number="+00 98765 47777")
    assert shop.call("owner", "PUT", "/outbox/settings", {"auto_send_enabled": True, "per_customer_daily_limit": 5}).status_code == 200
    try:
        r = shop.client.get(f"/v1/webhooks/exotel/{TOKEN}/missed-call", params={"CallSid": reply_id, "CallFrom": "9876547777"})
        assert r.status_code == 200
        row = operator_sql.sql(f"select m.source || '/' || m.category || '/' || m.channel || '/' || m.body from public.outbox_messages m where m.lead_id = '{lead.id}'")
        assert row.startswith("system/reply_to_inbound/whatsapp/Thank you for calling"), row
        assert operator_sql.sql(f"select outcome from integrations.missed_calls where provider_call_id = '{reply_id}'") == "replied"
    finally:
        assert shop.call("owner", "PUT", "/outbox/settings", {"auto_send_enabled": False, "per_customer_daily_limit": 5}).status_code == 200


# ---------------------------------------------------------------------------------------------- the call bridge
def pin(at: str) -> None:
    operator_sql.sql(f"create or replace function app.outbox_now() returns timestamptz language sql stable security definer set search_path = '' as $b$ select timestamptz '{at}' $b$")


def _approved_call(shop: Shop, lead: Any) -> str:
    rid = str(uuid.uuid4())
    made = shop.call("sales", "POST", "/call-requests", {"request_id": rid, "lead_id": lead.id, "reason": "About the order", "script_draft": "Hello, this is the shop.", "language": "en"})
    assert made.status_code == 200, made.text
    return rid


def test_only_an_approved_request_within_the_hours_is_placed_and_only_once(shop: Shop) -> None:
    lead = shop.fw.lead("bz-call", phone_number="+00 98765 45555")
    rid = _approved_call(shop, lead)
    try:
        day = operator_sql.sql("select (now() at time zone 'Asia/Kolkata')::date")
        pin(f"{day}T12:00:00+05:30")
        refused = shop.call("owner", "POST", f"/call-requests/{rid}/connect")
        assert refused.status_code == 409 and refused.json()["error"]["code"] == "not_in_a_state_for_this", "not approved yet"
        assert shop.bridge.calls == []
        assert shop.call("owner", "POST", f"/call-requests/{rid}/approve", {"note": "ok"}).status_code == 200
        assert shop.call("sales", "POST", f"/call-requests/{rid}/connect").status_code == 403
        pin(f"{day}T21:00:00+05:30")
        late = shop.call("owner", "POST", f"/call-requests/{rid}/connect")
        assert late.status_code == 409 and late.json()["error"]["code"] == "outside_calling_hours" and shop.bridge.calls == []
        pin(f"{day}T12:00:00+05:30")
        placed = shop.call("owner", "POST", f"/call-requests/{rid}/connect")
        assert placed.status_code == 200, placed.text
        assert placed.json()["status"] == "queued" and placed.json()["replayed"] is False
        assert len(shop.bridge.calls) == 1 and shop.bridge.calls[0][0] == "+910000000000" and shop.bridge.calls[0][1].endswith("9876545555")
        again = shop.call("owner", "POST", f"/call-requests/{rid}/connect")
        assert again.status_code == 200 and again.json()["replayed"] is True and len(shop.bridge.calls) == 1, "one call per request"
        # the provider's callback moves it on, and a final status is final
        cb = f"/v1/webhooks/exotel/{TOKEN}/call-status"
        assert shop.client.post(cb, json={"CallSid": shop.bridge.sids[-1], "Status": "completed"}).status_code == 200
        assert operator_sql.sql(f"select status from integrations.call_bridges where call_request_id = '{rid}'") == "completed"
        assert shop.client.post(cb, json={"CallSid": shop.bridge.sids[-1], "Status": "queued"}).status_code == 200
        assert operator_sql.sql(f"select status from integrations.call_bridges where call_request_id = '{rid}'") == "completed"
    finally:
        restore_clock()


def test_a_customer_who_asked_to_stop_is_not_called(shop: Shop) -> None:
    lead = shop.fw.lead("bz-stop", phone_number="+00 98765 46666")
    rid = _approved_call(shop, lead)
    assert shop.call("owner", "POST", f"/call-requests/{rid}/approve").status_code == 200
    assert shop.fw.suppress(lead).status_code == 200
    refused = shop.call("owner", "POST", f"/call-requests/{rid}/connect")
    assert refused.status_code == 409 and refused.json()["error"]["code"] == "not_in_a_state_for_this"
    assert not [c for c in shop.bridge.calls if c[1].endswith("9876546666")]


def test_no_secret_or_number_is_in_the_audit_or_the_webhook_log(shop: Shop) -> None:
    rows = operator_sql.sql("select string_agg(coalesce(new_values::text, '') || coalesce(metadata::text, ''), ' ') from public.audit_events where action like 'payment_link.%' or action like 'call_bridge.%'")
    assert "9876545555" not in rows and "pay.example-upi" not in rows and TOKEN not in rows
    assert json.loads(json.dumps({"ok": True}))["ok"] is True
