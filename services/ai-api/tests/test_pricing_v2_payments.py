"""Billing v2 payments (the owner's final pricing, 13 Nov 2026): subscribe, change plan, cancel, orders for a top-up / the pay-as-you-go fee / an upgrade, the provider's signature, the webhook onto the pricing functions, invoices.
Fake provider and fake repository, and Razorpay against recorded-shape responses: no network. The rules themselves are pgTAP 193 to 195."""

# ruff: noqa: E501

from __future__ import annotations

import hashlib
import hmac
import json
import uuid
from typing import Any

import httpx

from app.billing.fake import FakeBillingProvider
from app.billing.razorpay import RazorpayBilling
from app.pricing.service import PricingService
from tests.fakes import TENANT_A, auth, make_client
from tests.test_pricing_v2_api import CATALOGUE, FakeRepo

URL = f"/v1/tenants/{TENANT_A.id}/billing"
KEY, SECRET, HOOK = "rzp_test_abc123", "key-secret-not-real", "hook-secret-not-real"


class PayRepo(FakeRepo):
    def __init__(self, **balance: Any) -> None:
        super().__init__(**balance)
        self.orders: dict[str, dict[str, Any]] = {}
        self.calls: list[tuple[str, Any]] = []
        self.tokens: list[str] = []   # the token each system call (settle, provider event) came with
        self.quote = {"from_plan": "sales_assistant", "to_plan": "sales_lead_finder", "days_left": 15, "days_in_period": 30, "amount_due_paise": 200000, "gst_paise": 36000, "total_due_paise": 236000, "credit_paise": 0}

    def subscribe(self, token: str, tenant_id: uuid.UUID, plan_id: str, interval: str, provider: str, provider_ref: str | None, payment_ref: str) -> dict[str, Any]:
        self.calls.append(("subscribe", (plan_id, interval, provider, provider_ref, payment_ref)))
        self.b.update(plan_id=plan_id, plan_name=plan_id)
        return {}

    def change_quote(self, token: str, tenant_id: uuid.UUID, plan_id: str, interval: str) -> dict[str, Any]:
        return dict(self.quote)

    def change_apply(self, token: str, tenant_id: uuid.UUID, plan_id: str, interval: str, ref: str) -> dict[str, Any]:
        self.calls.append(("change_apply", (plan_id, interval, ref)))
        return {}

    def cancel(self, token: str, tenant_id: uuid.UUID) -> dict[str, Any]:
        self.calls.append(("cancel", None))
        return {**self.b, "provider": "razorpay", "provider_ref": "sub_XYZ789"}

    def order_create(self, token: str, tenant_id: uuid.UUID, order_id: str, purpose: str, amount_paise: int | None, plan_id: str | None, interval: str | None) -> dict[str, Any]:
        base = amount_paise or 0 if purpose == "topup" else 49900 if purpose == "payg_fee" else int(str(self.quote["amount_due_paise"]))
        self.orders[order_id] = {"purpose": purpose, "base": base, "total": base + (base * 18 + 50) // 100}
        return {"order_id": order_id, "total_paise": self.orders[order_id]["total"]}

    def order_settle(self, token: str, tenant_id: uuid.UUID, order_id: str, payment_ref: str) -> dict[str, Any]:
        self.tokens.append(token)
        o = self.orders[order_id]
        first = "paid" not in o
        o["paid"] = payment_ref
        if first and o["purpose"] == "topup":
            self.b["balance_paise"] += o["base"]
        self.calls.append(("order_settle", (order_id, payment_ref)))
        return {"settled": first}

    def provider_event(self, token: str, tenant_id: uuid.UUID, event_id: str, kind: str, amount_paise: int | None) -> dict[str, Any]:
        self.tokens.append(token)
        self.calls.append(("provider_event", (event_id, kind, amount_paise)))
        return {"applied": True}

    def invoices(self, token: str, tenant_id: uuid.UUID) -> list[dict[str, Any]]:
        return [{"number": "S19-2026-000001", "kind": "topup", "subtotal_paise": 100000, "gst_paise": 18000, "total_paise": 118000, "issued_at": "2026-11-13T10:00:00+00:00"}]


def world(provider: Any = None) -> tuple[Any, PayRepo]:
    repo = PayRepo()
    client, _ = make_client(pricing=PricingService(repo, provider or FakeBillingProvider()))
    return client, repo


def razorpay(handler: Any = None) -> RazorpayBilling:
    def default(r: httpx.Request) -> httpx.Response:
        if r.url.path == "/v1/orders":
            return httpx.Response(200, json={"id": "order_ABC123"})
        if r.url.path == "/v1/plans":
            return httpx.Response(200, json={"id": "plan_ABC123"})
        if r.method == "GET":
            return httpx.Response(200, json={"items": []})
        return httpx.Response(200, json={"id": "sub_XYZ789"})

    return RazorpayBilling(KEY, SECRET, HOOK, client=httpx.Client(transport=httpx.MockTransport(handler or default)))


def sign(order: str, pay: str, secret: str = SECRET) -> str:
    return hmac.new(secret.encode(), f"{order}|{pay}".encode(), hashlib.sha256).hexdigest()


# ------------------------------------------------------------------------------------------------ orders
def test_a_topup_order_is_priced_by_the_server_and_paid_with_the_providers_signature() -> None:
    client, repo = world(razorpay())
    r = client.post(f"{URL}/orders", json={"purpose": "topup", "amount_paise": 100000}, headers=auth("a_owner"))
    assert r.status_code == 200, r.text
    o = r.json()
    assert o == {"provider": "razorpay", "order_id": "order_ABC123", "key_id": KEY, "purpose": "topup", "amount_text": "₹1,000", "gst_text": "₹180", "total_paise": 118000, "total_text": "₹1,180"}
    ok = client.post(f"{URL}/orders/order_ABC123/confirm", json={"payment_id": "pay_ABC123", "signature": sign("order_ABC123", "pay_ABC123")}, headers=auth("a_owner"))
    assert ok.status_code == 200 and ok.json()["balance_paise"] == 155000 + 100000, ok.text
    bad = client.post(f"{URL}/orders/order_ABC123/confirm", json={"payment_id": "pay_ABC123", "signature": sign("order_ABC123", "pay_ABC123", "wrong")}, headers=auth("a_owner"))
    assert bad.status_code == 402 and bad.json()["error"]["code"] == "payment_not_verified"
    assert [c for c in repo.calls if c[0] == "order_settle"] == [("order_settle", ("order_ABC123", "pay_ABC123"))], "a refused signature settled nothing"


def test_the_amount_the_provider_charges_is_what_the_database_stored() -> None:
    seen: list[dict[str, Any]] = []

    def handler(r: httpx.Request) -> httpx.Response:
        if r.url.path == "/v1/orders":
            seen.append(json.loads(r.content))
            return httpx.Response(200, json={"id": "order_ABC123"})
        return httpx.Response(200, json={})

    client, _ = world(razorpay(handler))
    client.post(f"{URL}/orders", json={"purpose": "topup", "amount_paise": 50000}, headers=auth("a_owner"))
    assert seen[0]["amount"] == 59000 and seen[0]["currency"] == "INR" and seen[0]["notes"]["purpose"] == "topup" and seen[0]["notes"]["tenant_id"] == str(TENANT_A.id)


def test_the_payg_fee_and_an_upgrade_are_orders_too() -> None:
    client, _ = world(razorpay())
    fee = client.post(f"{URL}/orders", json={"purpose": "payg_fee"}, headers=auth("a_owner")).json()
    assert fee["amount_text"] == "₹499" and fee["total_text"] == "₹588.82"
    up = client.post(f"{URL}/orders", json={"purpose": "plan_change", "plan_id": "sales_lead_finder", "interval": "monthly"}, headers=auth("a_owner")).json()
    assert up["amount_text"] == "₹2,000" and up["total_text"] == "₹2,360"


def test_the_refusals_of_an_order() -> None:
    client, _ = world(razorpay())
    for body in ({"purpose": "topup"}, {"purpose": "topup", "amount_paise": 5000}, {"purpose": "plan_change"}, {"purpose": "other"}, {"purpose": "topup", "amount_paise": 100000, "x": 1}):
        assert client.post(f"{URL}/orders", json=body, headers=auth("a_owner")).status_code in (422,), body
    assert client.post(f"{URL}/orders", json={"purpose": "topup", "amount_paise": 100000}, headers=auth("a_admin")).status_code == 403
    assert client.post(f"{URL}/orders", json={"purpose": "topup", "amount_paise": 100000}).status_code == 401
    down = client.post(f"{URL}/orders/order_ABC123/confirm", json={"payment_id": "p", "signature": "s"}, headers=auth("a_owner"))
    assert down.status_code == 422


def test_the_fake_provider_has_its_own_test_checkout() -> None:
    client, _ = world()
    o = client.post(f"{URL}/orders", json={"purpose": "topup", "amount_paise": 20000}, headers=auth("a_owner")).json()
    assert o["provider"] == "fake" and o["key_id"] is None and o["order_id"].startswith("order_fake_")
    ok = client.post(f"{URL}/orders/{o['order_id']}/confirm", json={"payment_id": "pay_fake_1", "signature": "sig_fake_ok"}, headers=auth("a_owner"))
    assert ok.status_code == 200 and ok.json()["balance_paise"] == 175000
    assert client.post(f"{URL}/orders/{o['order_id']}/confirm", json={"payment_id": "pay_real_1", "signature": "sig_fake_ok"}, headers=auth("a_owner")).status_code == 402


# ------------------------------------------------------------------------------------------------ subscribe, change, cancel, invoices
def test_subscribing_goes_through_the_providers_checkout_and_the_signature() -> None:
    client, repo = world(razorpay())
    c = client.post(f"{URL}/subscription-checkout", json={"plan_id": "sales_assistant", "interval": "yearly"}, headers=auth("a_owner")).json()
    assert c == {"provider": "razorpay", "key_id": KEY, "subscription_id": "sub_XYZ789", "plan_id": "sales_assistant", "interval": "yearly", "amount_text": "₹19,990", "gst_text": "₹3,598.20", "total_text": "₹23,588.20"}
    sig = hmac.new(SECRET.encode(), b"pay_ABC123|sub_XYZ789", hashlib.sha256).hexdigest()
    ok = client.post(f"{URL}/subscribe", json={"plan_id": "sales_assistant", "interval": "yearly", "checkout_ref": f"sub_XYZ789.pay_ABC123.{sig}"}, headers=auth("a_owner"))
    assert ok.status_code == 200, ok.text
    assert ("subscribe", ("sales_assistant", "yearly", "razorpay", "sub_XYZ789", "pay_ABC123")) in repo.calls
    wrong = client.post(f"{URL}/subscribe", json={"plan_id": "sales_assistant", "interval": "yearly", "checkout_ref": "sub_XYZ789.pay_ABC123." + "0" * 64}, headers=auth("a_owner"))
    assert wrong.status_code == 402 and wrong.json()["error"]["code"] == "payment_method_declined"
    assert client.post(f"{URL}/subscribe", json={"plan_id": "no_such", "interval": "monthly", "checkout_ref": "pm_fake_ok"}, headers=auth("a_owner")).json()["error"]["code"] == "plan_unknown"


def test_the_fake_provider_subscribes_with_a_test_reference() -> None:
    client, repo = world()
    c = client.post(f"{URL}/subscription-checkout", json={"plan_id": "payg", "interval": "monthly"}, headers=auth("a_owner")).json()
    assert c["provider"] == "fake" and c["key_id"] is None and c["total_text"] == "₹588.82"
    assert client.post(f"{URL}/subscribe", json={"plan_id": "payg", "interval": "monthly", "checkout_ref": "pm_fake_ok"}, headers=auth("a_owner")).status_code == 200
    assert repo.calls[0][0] == "subscribe" and repo.calls[0][1][2] == "fake"


def test_a_change_is_quoted_then_paid_by_order_or_applied_free() -> None:
    client, repo = world()
    q = client.post(f"{URL}/change-quote", json={"plan_id": "sales_lead_finder", "interval": "monthly"}, headers=auth("a_owner")).json()
    assert q["amount_text"] == "₹2,000" and q["total_text"] == "₹2,360" and q["needs_payment"] is True and q["credit_text"] is None
    assert client.post(f"{URL}/change", json={"plan_id": "sales_lead_finder", "interval": "monthly"}, headers=auth("a_owner")).json()["error"]["code"] == "payment_required"
    repo.quote = {**repo.quote, "amount_due_paise": 0, "gst_paise": 0, "total_due_paise": 0, "credit_paise": 200000}
    q2 = client.post(f"{URL}/change-quote", json={"plan_id": "sales_assistant", "interval": "monthly"}, headers=auth("a_owner")).json()
    assert q2["needs_payment"] is False and q2["credit_text"] == "₹2,000 goes to your balance"
    assert client.post(f"{URL}/change", json={"plan_id": "sales_assistant", "interval": "monthly"}, headers=auth("a_owner")).status_code == 200
    ref = [c for c in repo.calls if c[0] == "change_apply"][0][1][2]
    assert ref.startswith("chg_") and len(ref) == 28


def test_cancel_tells_the_provider_and_hides_the_reference() -> None:
    seen: list[str] = []

    def handler(r: httpx.Request) -> httpx.Response:
        seen.append(f"{r.method} {r.url.path} {r.content.decode()}")
        return httpx.Response(200, json={"status": "cancelled"})

    client, _ = world(razorpay(handler))
    r = client.post(f"{URL}/plan/cancel", headers=auth("a_owner"))
    assert r.status_code == 200 and "sub_XYZ789" not in r.text and "provider_ref" not in r.text
    assert seen == ['POST /v1/subscriptions/sub_XYZ789/cancel {"cancel_at_cycle_end":1}'] or seen == ['POST /v1/subscriptions/sub_XYZ789/cancel {"cancel_at_cycle_end": 1}']
    assert client.post(f"{URL}/plan/cancel", headers=auth("a_admin")).status_code == 403


def test_the_invoices_are_in_rupees_for_owner_and_admin() -> None:
    client, _ = world()
    for user in ("a_owner", "a_admin"):
        r = client.get(f"{URL}/gst-invoices", headers=auth(user))
        assert r.status_code == 200 and r.json()["items"][0]["total_text"] == "₹1,180" and r.json()["items"][0]["gst_text"] == "₹180"
    assert client.get(f"{URL}/gst-invoices", headers=auth("a_sales")).status_code == 403
    assert "credit" not in client.get(f"{URL}/gst-invoices", headers=auth("a_owner")).text.lower()


# ------------------------------------------------------------------------------------------------ the webhook onto the pricing functions
def test_an_order_paid_event_is_signed_mapped_and_settles_once_for_the_pricing_module() -> None:
    from types import SimpleNamespace

    repo = PayRepo()
    provider = razorpay()
    pricing = PricingService(repo, provider)
    repo.orders["order_ABC123"] = {"purpose": "topup", "base": 100000, "total": 118000}
    connectors = SimpleNamespace(receiver=SimpleNamespace(token=lambda: "scheduler-token"))   # the scheduler's account: must NOT be what the webhook uses
    hook = SimpleNamespace(token=lambda: "hook-token")   # the billing webhook's own account
    client, _ = make_client(pricing=pricing, billing=SimpleNamespace(provider=provider, apply=lambda *a: None), connectors=connectors, billing_webhook=hook)
    doc = {"event": "order.paid", "payload": {"order": {"entity": {"id": "order_ABC123", "amount_paid": 118000, "notes": {"tenant_id": str(TENANT_A.id), "purpose": "topup"}}}, "payment": {"entity": {"id": "pay_ABC123"}}}}
    raw = json.dumps(doc).encode()
    headers = {"x-razorpay-signature": hmac.new(HOOK.encode(), raw, hashlib.sha256).hexdigest(), "x-razorpay-event-id": "evt_1"}
    assert client.post("/v1/webhooks/razorpay-billing", content=raw, headers=headers).status_code == 200
    assert client.post("/v1/webhooks/razorpay-billing", content=raw, headers=headers).status_code == 200
    assert repo.b["balance_paise"] == 155000 + 100000, "settled once although delivered twice"
    renewal = json.dumps({"event": "subscription.charged", "payload": {"subscription": {"entity": {"id": "sub_X", "notes": {"tenant_id": str(TENANT_A.id)}}}, "payment": {"entity": {"amount": 199900, "created_at": 1789000000}}}}).encode()
    h2 = {"x-razorpay-signature": hmac.new(HOOK.encode(), renewal, hashlib.sha256).hexdigest(), "x-razorpay-event-id": "evt_2"}
    assert client.post("/v1/webhooks/razorpay-billing", content=renewal, headers=h2).status_code == 200
    assert ("provider_event", ("razorpay:evt_2", "charge_succeeded", 199900)) in repo.calls
    assert CATALOGUE["gst_percent"] == 18.0
    assert set(repo.tokens) == {"hook-token"}, "every system call used the billing webhook's own account, never the scheduler's"


# ------------------------------------------------------------------------------------------------ the v1 trial is closed while PRICING_V2 is on
def test_the_v1_trial_topups_and_upgrade_are_closed_when_the_new_pricing_is_on() -> None:
    client, _ = world()
    for path, body in (("trial", {"plan_id": "starter", "checkout_ref": "pm_fake_ok"}), ("resume", {"plan_id": "starter", "checkout_ref": "pm_fake_ok"}),
                       ("checkout", {"plan_id": "starter"}), ("upgrade", {"plan_id": "growth", "checkout_ref": "pm_fake_ok"}),
                       ("topups", {"purchase_id": str(uuid.uuid4()), "pack_code": "calls_100", "checkout_ref": "pm_fake_ok"})):
        r = client.post(f"{URL}/{path}", json=body, headers=auth("a_owner"))
        assert r.status_code == 404 and r.json()["error"]["code"] == "not_found", (path, r.status_code, r.text)


def test_the_webhook_refuses_without_its_own_account_and_never_falls_back_to_the_scheduler() -> None:
    from types import SimpleNamespace

    from app.billing.errors import (
        NotSupportedError,  # noqa: F401  (the webhook route imports it too)
    )
    from app.scheduler.session import SignInError

    repo = PayRepo()
    provider = razorpay()
    repo.orders["order_ABC123"] = {"purpose": "topup", "base": 100000, "total": 118000}
    doc = {"event": "order.paid", "payload": {"order": {"entity": {"id": "order_ABC123", "amount_paid": 118000, "notes": {"tenant_id": str(TENANT_A.id), "purpose": "topup"}}}, "payment": {"entity": {"id": "pay_ABC123"}}}}
    raw = json.dumps(doc).encode()
    headers = {"x-razorpay-signature": hmac.new(HOOK.encode(), raw, hashlib.sha256).hexdigest(), "x-razorpay-event-id": "evt_9"}
    scheduler = SimpleNamespace(receiver=SimpleNamespace(token=lambda: "scheduler-token"))

    def broken() -> str:
        raise SignInError("no")

    for hook in (None, SimpleNamespace(token=broken)):
        client, _ = make_client(pricing=PricingService(repo, provider), billing=SimpleNamespace(provider=provider, apply=lambda *a: None), connectors=scheduler, billing_webhook=hook)
        r = client.post("/v1/webhooks/razorpay-billing", content=raw, headers=headers)
        assert r.status_code == 503 and r.json()["error"]["code"] == "webhooks_unavailable"
    assert repo.tokens == [] and repo.b["balance_paise"] == 155000, "nothing was settled, and the scheduler's account was never used"
