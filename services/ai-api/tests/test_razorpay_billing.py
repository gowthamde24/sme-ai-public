"""C12: Razorpay billing in TEST mode, against recorded-shape fakes (no network, no key). The first run against Razorpay's test servers needs the owner's test keys (docs/plans/razorpay-test-billing.md)."""

# ruff: noqa: E501

from __future__ import annotations

import hashlib
import hmac
import json
from datetime import UTC, datetime
from types import SimpleNamespace
from typing import Any

import httpx
import pytest

from app.billing.errors import NotSupportedError, PaymentMethodDeclinedError
from app.billing.provider import CreateSubscription, build_provider
from app.billing.razorpay import RazorpayBilling, WebhookRejected

KEY, SECRET, HOOK = "rzp_test_abc123", "key-secret-not-real", "hook-secret-not-real"
TENANT = "11111111-1111-4111-8111-111111111111"
NOW = datetime(2026, 11, 13, 6, 0, tzinfo=UTC)


def provider(handler: Any = None) -> RazorpayBilling:
    transport = httpx.MockTransport(handler or (lambda r: httpx.Response(404, json={})))
    return RazorpayBilling(KEY, SECRET, HOOK, client=httpx.Client(transport=transport))


def request(ref: str = "x", price: int | None = 99900) -> CreateSubscription:
    return CreateSubscription(TENANT, "starter", ref, 14, price, NOW)


def test_only_test_keys_are_accepted_and_nothing_is_printed() -> None:
    with pytest.raises(ValueError, match="TEST keys"):
        RazorpayBilling("rzp_live_abc", SECRET, HOOK)
    with pytest.raises(ValueError):
        RazorpayBilling(KEY, "", HOOK)
    assert SECRET not in repr(provider()) and KEY not in repr(provider())
    with pytest.raises(ValueError, match="needs"):
        build_provider("razorpay", None)
    assert build_provider("razorpay", (KEY, SECRET, HOOK)).name == "razorpay"
    assert build_provider("fake").name == "fake"
    with pytest.raises(ValueError):
        build_provider("stripe")


def test_checkout_makes_the_plan_once_and_a_subscription_with_our_tenant_in_its_notes() -> None:
    seen: list[tuple[str, str, dict[str, Any]]] = []

    def handler(r: httpx.Request) -> httpx.Response:
        body = json.loads(r.content) if r.content else {}
        seen.append((r.method, r.url.path, body))
        if r.method == "GET":
            return httpx.Response(200, json={"items": []})
        if r.url.path == "/v1/plans":
            return httpx.Response(200, json={"id": "plan_ABC123"})
        return httpx.Response(200, json={"id": "sub_XYZ789", "status": "created"})

    session = provider(handler).begin_checkout(request())
    assert (session.key_id, session.subscription_id) == (KEY, "sub_XYZ789")
    plan = next(b for m, p, b in seen if p == "/v1/plans" and m == "POST")
    assert plan["item"] == {"name": "Stack19 starter", "amount": 99900, "currency": "INR"} and plan["period"] == "monthly" and plan["notes"] == {"stack19_plan": "starter:99900"}
    sub = next(b for m, p, b in seen if p == "/v1/subscriptions")
    assert sub["plan_id"] == "plan_ABC123" and sub["notes"] == {"tenant_id": TENANT, "plan": "starter"} and sub["customer_notify"] is False
    assert sub["start_at"] == int(datetime(2026, 11, 27, 6, 0, tzinfo=UTC).timestamp()), "14 days after the start"


def test_an_existing_plan_is_found_by_its_notes_not_made_again() -> None:
    posted: list[str] = []

    def handler(r: httpx.Request) -> httpx.Response:
        if r.method == "GET":
            return httpx.Response(200, json={"items": [{"id": "plan_OLD111", "notes": {"stack19_plan": "starter:99900"}}]})
        posted.append(r.url.path)
        return httpx.Response(200, json={"id": "sub_XYZ789"})

    provider(handler).begin_checkout(request())
    assert posted == ["/v1/subscriptions"]


def test_a_plan_with_no_price_cannot_be_started() -> None:
    with pytest.raises(NotSupportedError):
        provider().begin_checkout(request(price=None))


def sign(sub: str, pay: str, secret: str = SECRET) -> str:
    return hmac.new(secret.encode(), f"{pay}|{sub}".encode(), hashlib.sha256).hexdigest()


def test_the_checkout_signature_is_checked() -> None:
    p = provider()
    good = f"sub_XYZ789.pay_ABC123.{sign('sub_XYZ789', 'pay_ABC123')}"
    got = p.create_subscription(request(good))
    assert (got.provider, got.reference, got.trial_ends_at) == ("razorpay", "sub_XYZ789", None)
    for bad in (f"sub_XYZ789.pay_ABC123.{sign('sub_XYZ789', 'pay_ABC123', 'other')}", "sub_XYZ789.pay_ABC123.nothex", "pm_fake_ok", f"sub_OTHER.pay_ABC123.{sign('sub_XYZ789', 'pay_ABC123')}", ""):
        with pytest.raises(PaymentMethodDeclinedError):
            p.create_subscription(request(bad))


def test_cancel_goes_to_razorpay_at_once_or_at_the_end_of_the_cycle_and_is_safe_to_repeat() -> None:
    calls: list[tuple[str, dict[str, Any]]] = []

    def handler(r: httpx.Request) -> httpx.Response:
        calls.append((r.url.path, json.loads(r.content)))
        return httpx.Response(400, json={"error": {"description": "already cancelled"}}) if len(calls) == 3 else httpx.Response(200, json={"status": "cancelled"})

    p = provider(handler)
    p.cancel_subscription("sub_XYZ789", at_period_end=False, now=NOW)
    p.cancel_subscription("sub_XYZ789", at_period_end=True, now=NOW)
    p.cancel_subscription("sub_XYZ789", at_period_end=True, now=NOW)   # Razorpay answers 400: no error
    p.cancel_subscription("bad id!", at_period_end=True, now=NOW)       # never sent
    assert calls == [("/v1/subscriptions/sub_XYZ789/cancel", {"cancel_at_cycle_end": 0}), ("/v1/subscriptions/sub_XYZ789/cancel", {"cancel_at_cycle_end": 1}), ("/v1/subscriptions/sub_XYZ789/cancel", {"cancel_at_cycle_end": 1})]


def hook(event: str, *, payment: dict[str, Any] | None = None, tenant: str | None = TENANT) -> tuple[bytes, dict[str, str]]:
    doc: dict[str, Any] = {"event": event, "payload": {"subscription": {"entity": {"id": "sub_XYZ789", "notes": {"tenant_id": tenant} if tenant else {}}}}}
    if payment is not None:
        doc["payload"]["payment"] = {"entity": payment}
    raw = json.dumps(doc).encode()
    return raw, {"x-razorpay-signature": hmac.new(HOOK.encode(), raw, hashlib.sha256).hexdigest(), "x-razorpay-event-id": "evt_001"}


def test_webhook_events_map_to_the_billing_events() -> None:
    p = provider()
    raw, headers = hook("subscription.charged", payment={"amount": 99900, "created_at": 1789000000})
    [e] = p.verify_webhook(headers, raw)
    assert (e.kind, e.tenant_id, e.amount_paise, e.event_id) == ("charge_succeeded", TENANT, 99900, "razorpay:evt_001") and e.occurred_at == datetime.fromtimestamp(1789000000, UTC)
    for event, kind in (("subscription.pending", "charge_failed"), ("subscription.halted", "halted"), ("subscription.cancelled", "cancelled")):
        raw, headers = hook(event)
        assert [x.kind for x in p.verify_webhook(headers, raw)] == [kind]
    raw, headers = hook("subscription.activated")
    assert p.verify_webhook(headers, raw) == [], "signed, but not an event billing uses"
    raw, headers = hook("subscription.charged", tenant=None)
    assert p.verify_webhook(headers, raw) == [], "no tenant in the notes: not one of ours"


def test_a_wrong_or_missing_signature_is_refused() -> None:
    p = provider()
    raw, headers = hook("subscription.charged")
    for bad in ({}, {"x-razorpay-signature": "0" * 64}, {**headers, "x-razorpay-signature": headers["x-razorpay-signature"][:-1] + "0"}):
        with pytest.raises(WebhookRejected):
            p.verify_webhook(bad, raw)
    with pytest.raises(WebhookRejected):
        p.verify_webhook(headers, raw + b" ")
    with pytest.raises(WebhookRejected):
        p.verify_webhook(headers, b"x" * 70000)


def test_top_ups_and_plan_changes_are_not_built_and_say_so() -> None:
    p = provider()
    with pytest.raises(NotSupportedError):
        p.charge_once(SimpleNamespace())   # type: ignore[arg-type]
    with pytest.raises(NotSupportedError):
        p.change_plan("sub_XYZ789", 1)
    assert p.events_until(NOW) == []


def test_the_webhook_route_applies_a_signed_event_once_per_delivery_and_refuses_the_rest() -> None:
    from tests.fakes import make_client

    applied: list[Any] = []
    billing = SimpleNamespace(provider=provider(), apply=lambda token, event: applied.append((token, event.kind)))
    connectors = SimpleNamespace(receiver=SimpleNamespace(token=lambda: "worker-token"))
    client, _ = make_client(billing=billing, connectors=connectors)
    raw, headers = hook("subscription.halted")
    ok = client.post("/v1/webhooks/razorpay-billing", content=raw, headers=headers)
    assert ok.status_code == 200 and applied == [("worker-token", "halted")]
    bad = client.post("/v1/webhooks/razorpay-billing", content=raw, headers={**headers, "x-razorpay-signature": "0" * 64})
    assert bad.status_code == 401 and len(applied) == 1
    fake = SimpleNamespace(provider=SimpleNamespace(name="fake"), apply=lambda *a: None)
    client2, _ = make_client(billing=fake, connectors=connectors)
    assert client2.post("/v1/webhooks/razorpay-billing", content=raw, headers=headers).status_code == 404
