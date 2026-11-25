"""Credits top-up through Razorpay (docs/contracts/credits-topup.md): amounts and GST, the checkout-ready order, the signature-checked confirmation, the signed webhook, failed and abandoned payments, replays and races,
invoices and the statement, the staff refund, the low-balance flag and the live-mode guard. A FAKE Razorpay (httpx's MockTransport, recorded shapes) and a stateful fake database that follows the rules of migration
20261231992200; the rules themselves are proved by pgTAP 275. No network, no key."""

# ruff: noqa: E501

from __future__ import annotations

import hashlib
import hmac
import json
import threading
import uuid
from concurrent.futures import ThreadPoolExecutor
from types import SimpleNamespace
from typing import Any, cast

import httpx
import pytest
from pydantic import ValidationError

from app.billing.errors import PaymentMethodDeclinedError
from app.billing.fake import FakeBillingProvider
from app.billing.provider import build_provider
from app.billing.razorpay import RazorpayBilling
from app.config import Settings
from app.credits.errors import AlreadyRefundedError, NotAPaidTopupError, NothingUnusedError
from app.credits.service import CreditsService, RefundUnconfirmedError, amount_out, gst_of
from app.crm.repository import NotFoundError
from app.pricing.service import OrderRefusedError, PricingService, balance_out
from tests.fakes import TENANT_A, auth, make_client
from tests.test_pricing_v2_api import CATALOGUE, FakeRepo

URL = f"/v1/tenants/{TENANT_A.id}/billing"
CR = f"{URL}/credits"
KEY, SECRET, HOOK = "rzp_test_abc123", "key-secret-not-real", "hook-secret-not-real"
FY = "2627"


# ------------------------------------------------------------------------------------------------ a fake database that follows migration 20261231992200
class Ledger(FakeRepo):
    """The rules of the database's settle, failure, list, statement and refund functions, with a lock where the database has a row lock."""

    def __init__(self) -> None:
        super().__init__(balance_paise=0, minutes_estimate=0, plan_id="payg", plan_name="Pay as you go")
        self.lock = threading.Lock()
        self.orders: dict[str, dict[str, Any]] = {}
        self.credited: list[tuple[str, int]] = []   # (payment id, paise) each time the balance really grew
        self.invoices: list[str] = []
        self.refunds: dict[str, dict[str, Any]] = {}
        self.refund_calls: list[str] = []
        self.tokens: list[str] = []

    def order_create(self, token: str, tenant_id: uuid.UUID, order_id: str, purpose: str, amount_paise: int | None, plan_id: str | None, interval: str | None) -> dict[str, Any]:
        base = int(amount_paise or 0)
        if purpose != "topup" or base % 100 or not 10000 <= base <= 10_000_000:
            raise OrderRefusedError("22023")
        self.orders[order_id] = {"tenant": tenant_id, "base": base, "total": base + gst_of(base), "status": "created", "payment": None, "failure": None, "invoice": None}
        return {"order_id": order_id, "total_paise": self.orders[order_id]["total"]}

    def order_settle(self, token: str, tenant_id: uuid.UUID, order_id: str, payment_ref: str, paid_paise: int | None = None) -> dict[str, Any]:
        self.tokens.append(token)
        with self.lock:   # the order row's lock
            o = self.orders.get(order_id)
            if o is None or o["tenant"] != tenant_id:
                raise NotFoundError("23503")
            if o["status"] == "paid":
                return {"settled": False, "replayed": True, "purpose": "topup", "same_payment": o["payment"] == payment_ref}
            if any(x["payment"] == payment_ref for x in self.orders.values() if x is not o):
                raise OrderRefusedError("22023")
            if paid_paise is not None and paid_paise != o["total"]:
                o.update(status="failed", failure="amount_mismatch")
                return {"settled": False, "replayed": False, "purpose": "topup", "reason": "amount_mismatch"}
            o.update(status="paid", payment=payment_ref, failure=None)
            self.b["balance_paise"] += o["base"]
            self.credited.append((payment_ref, o["base"]))
            o["invoice"] = f"S19-{FY}-{len(self.invoices) + 1:06d}"
            self.invoices.append(o["invoice"])
            return {"settled": True, "replayed": False, "purpose": "topup"}

    def order_failed(self, token: str, order_id: str, code: str) -> dict[str, Any]:
        self.tokens.append(token)
        with self.lock:
            o = self.orders.get(order_id)
            if o is None:
                return {"recorded": False, "reason": "unknown_order"}
            if o["status"] == "paid":
                return {"recorded": False, "reason": "already_paid"}
            o.update(status="failed", failure=code)
            return {"recorded": True, "reason": None}

    def topup_orders(self, token: str, tenant_id: uuid.UUID, limit: int) -> list[dict[str, Any]]:
        out = []
        for oid, o in self.orders.items():
            if o["tenant"] != tenant_id:
                continue
            state = o["status"] if o["status"] in ("paid", "failed") else ("abandoned" if o.get("old") else "pending")
            out.append({"order_id": oid, "credits_paise": o["base"], "gst_paise": o["total"] - o["base"], "total_paise": o["total"], "state": state, "failure_code": o["failure"], "created_at": "2026-11-24T10:00:00+00:00",
                        "paid_at": "2026-11-24T10:01:00+00:00" if state == "paid" else None, "invoice_number": o["invoice"], "refunded": any(r["order"] == oid and r["status"] == "done" for r in self.refunds.values())})
        return out[:limit]

    def statement(self, token: str, tenant_id: uuid.UUID, date_from: str | None, date_to: str | None, limit: int, before: str | None) -> dict[str, Any]:
        items = [{"at": "2026-11-24T10:01:00+00:00", "kind": "credit", "label": "Top-up", "amount_paise": b, "balance_after_paise": b, "ref": p, "invoice_number": None} for p, b in self.credited]
        return {"items": items[:limit], "has_more": len(items) > limit, "next_before": None, "opening_paise": 0, "closing_paise": self.b["balance_paise"], "balance_paise": self.b["balance_paise"]}

    def invoice_detail(self, token: str, tenant_id: uuid.UUID, number: str) -> dict[str, Any]:
        if number not in self.invoices:
            raise NotFoundError("23503")
        return {"number": number, "kind": "topup", "issued_at": "2026-11-24T10:01:00+00:00", "subtotal_paise": 100000, "gst_paise": 18000, "total_paise": 118000, "cgst_paise": 9000, "sgst_paise": 9000, "igst_paise": 0,
                "tax_split": "cgst_sgst", "against_number": None, "gst_percent": 18.0, "buyer_name": "Tenant A", "buyer_gstin": "27AAPFU0939F1ZV", "buyer_state_code": "27", "seller_name": None, "seller_gstin": None,
                "seller_address": None, "seller_sac": None}

    def refund_begin(self, token: str, tenant_id: uuid.UUID, order_id: str, reason_code: str, reason_text: str, key: str) -> dict[str, Any]:
        with self.lock:
            if key in self.refunds:
                r = self.refunds[key]
                return {**r["doc"], "replayed": True, "status": r["status"]}
            o = self.orders.get(order_id)
            if o is None or o["status"] != "paid":
                raise NotAPaidTopupError("SM938")
            if any(x["order"] == order_id and x["status"] in ("pending", "done") for x in self.refunds.values()):
                raise AlreadyRefundedError("SM937")
            unused = self.b["balance_paise"]
            if unused <= 0:
                raise NothingUnusedError("SM936")
            total = (o["total"] * unused + o["base"] // 2) // o["base"]
            self.b["balance_paise"] = 0
            doc = {"refund_id": str(uuid.uuid4()), "status": "pending", "payment_ref": o["payment"], "refund_paise": total, "credits_reversed_paise": unused, "gst_refund_paise": total - unused, "replayed": False}
            self.refunds[key] = {"doc": doc, "order": order_id, "status": "pending", "unused": unused}
            return doc

    def refund_finish(self, token: str, refund_id: str, ok: bool, provider_ref: str | None) -> dict[str, Any]:
        for r in self.refunds.values():
            if r["doc"]["refund_id"] == refund_id:
                if r["status"] != "pending":
                    return {"refund_id": refund_id, "status": r["status"], "credit_note_number": "C19-2627-000001", "replayed": True}
                r["status"] = "done" if ok else "failed"
                self.refund_calls.append(f"finish:{ok}")
                if not ok:
                    self.b["balance_paise"] += r["unused"]
                return {"refund_id": refund_id, "status": r["status"], "credit_note_number": "C19-2627-000001" if ok else None, "replayed": False}
        raise NotFoundError("23503")


def razorpay(handler: Any = None, seen: list[httpx.Request] | None = None) -> RazorpayBilling:
    counter = {"n": 0}

    def default(r: httpx.Request) -> httpx.Response:
        if seen is not None:
            seen.append(r)
        if r.url.path == "/v1/orders":
            counter["n"] += 1
            return httpx.Response(200, json={"id": f"order_RZP{counter['n']:06d}"})
        if r.url.path.endswith("/refund"):
            return httpx.Response(200, json={"id": "rfnd_RZP000001"})
        return httpx.Response(200, json={})

    return RazorpayBilling(KEY, SECRET, HOOK, client=httpx.Client(transport=httpx.MockTransport(handler or default)))


def sign(order: str, pay: str, secret: str = SECRET) -> str:
    return hmac.new(secret.encode(), f"{order}|{pay}".encode(), hashlib.sha256).hexdigest()


def world(provider: Any = None, admin: bool = False, mail: Any = None) -> tuple[Any, Ledger, Any]:
    ledger = Ledger()
    provider = provider or razorpay()
    pricing = PricingService(cast(Any, ledger), provider)
    credits = CreditsService(cast(Any, ledger), pricing)
    hook = SimpleNamespace(token=lambda: "hook-token")
    client, _ = make_client(pricing=pricing, credits=credits, billing=SimpleNamespace(provider=provider, apply=lambda *a: None), connectors=SimpleNamespace(receiver=SimpleNamespace(token=lambda: "scheduler-token")), billing_webhook=hook, mail_sender=mail, admin=SimpleNamespace() if admin else None)
    return client, ledger, provider


def make_order(client: Any, rupees: int = 1000) -> dict[str, Any]:
    r = client.post(f"{CR}/topups", json={"amount_rupees": rupees}, headers=auth("a_owner"))
    assert r.status_code == 200, r.text
    return r.json()  # type: ignore[no-any-return]


def webhook(client: Any, event: dict[str, Any], event_id: str = "evt_1", secret: str = HOOK) -> Any:
    raw = json.dumps(event).encode()
    return client.post("/v1/webhooks/razorpay-billing", content=raw, headers={"x-razorpay-signature": hmac.new(secret.encode(), raw, hashlib.sha256).hexdigest(), "x-razorpay-event-id": event_id})


def order_paid(order_id: str, payment_id: str, amount: int) -> dict[str, Any]:
    return {"event": "order.paid", "payload": {"order": {"entity": {"id": order_id, "amount_paid": amount, "notes": {"tenant_id": str(TENANT_A.id), "purpose": "topup"}}}, "payment": {"entity": {"id": payment_id}}}}


# ------------------------------------------------------------------------------------------------ amounts and GST
@pytest.mark.parametrize(("rupees", "gst", "total"), [(500, 9000, 59000), (1000, 18000, 118000), (2000, 36000, 236000), (5000, 90000, 590000), (333, 5994, 39294), (100, 1800, 11800), (100000, 1800000, 11800000)])
def test_gst_is_added_on_top_of_the_amount_that_is_added_to_the_balance(rupees: int, gst: int, total: int) -> None:
    a = amount_out(rupees)
    assert (a.added_paise, a.gst_paise, a.total_paise) == (rupees * 100, gst, total)
    assert a.added_paise + a.gst_paise == a.total_paise


def test_gst_rounds_half_up_to_the_paisa() -> None:
    assert gst_of(25) == 5 and gst_of(3) == 1 and gst_of(2) == 0 and gst_of(28) == 5, "4.5 paise rounds to 5, 0.54 to 1, 0.36 to 0, 5.04 to 5"
    assert gst_of(100000, 500) == 5000


def test_the_options_are_the_four_amounts_a_custom_range_and_the_mode() -> None:
    client, _, _ = world()
    r = client.get(f"{CR}/topup-options", headers=auth("a_owner"))
    assert r.status_code == 200, r.text
    o = r.json()
    assert [p["added_paise"] for p in o["presets"]] == [50000, 100000, 200000, 500000] and [p["total_text"] for p in o["presets"]] == ["₹590", "₹1,180", "₹2,360", "₹5,900"]
    assert o["presets"][0]["gst_text"] == "₹90" and o["custom_min_rupees"] == 100 and o["custom_max_rupees"] == 100000 and o["gst_percent"] == 18.0
    assert o["mode"] == "test" and o["checkout_ready"] is True
    assert "credit" not in r.text.lower()
    assert world(FakeBillingProvider())[0].get(f"{CR}/topup-options", headers=auth("a_admin")).json()["mode"] == "fake"
    assert client.get(f"{CR}/topup-options", headers=auth("a_sales")).status_code == 403


# ------------------------------------------------------------------------------------------------ the order
def test_the_order_is_checkout_ready_and_holds_nothing_secret() -> None:
    seen: list[httpx.Request] = []
    client, ledger, _ = world(razorpay(None, seen))
    o = make_order(client, 1000)
    assert o == {"provider": "razorpay", "mode": "test", "order_id": "order_RZP000001", "key_id": KEY, "currency": "INR", "amount_paise": 118000, "added_paise": 100000, "gst_paise": 18000, "added_text": "₹1,000",
                 "gst_text": "₹180", "total_text": "₹1,180", "name": "Stack19", "description": "Call balance ₹1,000 + GST"}
    sent = json.loads(next(r for r in seen if r.url.path == "/v1/orders").content)
    assert sent["amount"] == 118000 and sent["currency"] == "INR" and sent["notes"] == {"tenant_id": str(TENANT_A.id), "purpose": "topup"}
    assert SECRET not in json.dumps(o) and HOOK not in json.dumps(o)
    assert ledger.orders["order_RZP000001"]["total"] == 118000, "the stored order, not the browser, decides what the payment is worth"


@pytest.mark.parametrize("body", [{"amount_rupees": 99}, {"amount_rupees": 100001}, {"amount_rupees": 0}, {"amount_rupees": -500}, {"amount_rupees": 150.5}, {"amount_rupees": "500"}, {}, {"amount_rupees": 500, "x": 1}])
def test_a_bad_amount_is_refused_before_the_provider_is_asked(body: dict[str, Any]) -> None:
    seen: list[httpx.Request] = []
    client, ledger, _ = world(razorpay(None, seen))
    r = client.post(f"{CR}/topups", json=body, headers=auth("a_owner"))
    assert r.status_code == 422, r.text
    assert seen == [] and ledger.orders == {}


def test_only_the_owner_makes_an_order() -> None:
    client, _, _ = world()
    assert client.post(f"{CR}/topups", json={"amount_rupees": 500}, headers=auth("a_admin")).status_code == 403
    assert client.post(f"{CR}/topups", json={"amount_rupees": 500}, headers=auth("a_sales")).status_code == 403
    assert client.post(f"{CR}/topups", json={"amount_rupees": 500}).status_code == 401


def test_the_provider_being_down_is_a_plain_503_and_nothing_is_stored() -> None:
    client, ledger, _ = world(razorpay(lambda r: httpx.Response(500, json={})))
    r = client.post(f"{CR}/topups", json={"amount_rupees": 500}, headers=auth("a_owner"))
    assert r.status_code == 503 and r.json()["error"]["code"] == "billing_unavailable" and ledger.orders == {}


# ------------------------------------------------------------------------------------------------ the confirmation
def test_a_good_signature_adds_the_balance_once_and_writes_the_invoice() -> None:
    client, ledger, _ = world()
    o = make_order(client, 1000)
    r = client.post(f"{CR}/topups/{o['order_id']}/confirm", json={"payment_id": "pay_ABC123", "signature": sign(o["order_id"], "pay_ABC123")}, headers=auth("a_owner"))
    assert r.status_code == 200, r.text
    b = r.json()
    assert b["state"] == "paid" and b["replayed"] is False and b["added_text"] == "₹1,000" and b["invoice_number"] == f"S19-{FY}-000001" and b["balance"]["balance_paise"] == 100000
    assert ledger.credited == [("pay_ABC123", 100000)], "the BASE amount, not the total with GST"


def test_a_wrong_signature_adds_nothing() -> None:
    client, ledger, _ = world()
    o = make_order(client)
    for sig in (sign(o["order_id"], "pay_ABC123", "wrong-secret"), sign("order_OTHER00001", "pay_ABC123"), sign(o["order_id"], "pay_OTHER00001"), "not-a-signature", "a" * 64):
        r = client.post(f"{CR}/topups/{o['order_id']}/confirm", json={"payment_id": "pay_ABC123", "signature": sig}, headers=auth("a_owner"))
        assert r.status_code == 402 and r.json()["error"]["code"] == "topup_not_verified", sig
    assert ledger.credited == [] and ledger.b["balance_paise"] == 0 and ledger.orders[o["order_id"]]["status"] == "created"


def test_confirming_twice_is_safe_and_says_so() -> None:
    client, ledger, _ = world()
    o = make_order(client)
    body = {"payment_id": "pay_ABC123", "signature": sign(o["order_id"], "pay_ABC123")}
    first = client.post(f"{CR}/topups/{o['order_id']}/confirm", json=body, headers=auth("a_owner")).json()
    again = client.post(f"{CR}/topups/{o['order_id']}/confirm", json=body, headers=auth("a_owner")).json()
    assert first["replayed"] is False and again["replayed"] is True and again["invoice_number"] == first["invoice_number"]
    assert len(ledger.credited) == 1 and len(ledger.invoices) == 1


def test_an_unknown_order_and_another_business_are_a_404_and_roles_are_checked() -> None:
    client, ledger, _ = world()
    body = {"payment_id": "pay_ABC123", "signature": sign("order_NOPE000001", "pay_ABC123")}
    r = client.post(f"{CR}/topups/order_NOPE000001/confirm", json=body, headers=auth("a_owner"))
    assert r.status_code == 404 and r.json()["error"]["code"] == "topup_order_unknown"
    o = make_order(client)
    ok = {"payment_id": "pay_ABC123", "signature": sign(o["order_id"], "pay_ABC123")}
    assert client.post(f"{CR}/topups/{o['order_id']}/confirm", json=ok, headers=auth("a_admin")).status_code == 403
    assert client.post(f"{CR}/topups/{o['order_id']}/confirm", json=ok, headers=auth("b_owner")).status_code in (403, 404)
    assert ledger.credited == []


def test_one_payment_cannot_pay_two_orders() -> None:
    client, ledger, _ = world()
    first, second = make_order(client, 500), make_order(client, 500)
    assert client.post(f"{CR}/topups/{first['order_id']}/confirm", json={"payment_id": "pay_ABC123", "signature": sign(first["order_id"], "pay_ABC123")}, headers=auth("a_owner")).status_code == 200
    r = client.post(f"{CR}/topups/{second['order_id']}/confirm", json={"payment_id": "pay_ABC123", "signature": sign(second["order_id"], "pay_ABC123")}, headers=auth("a_owner"))
    assert r.status_code == 402 and len(ledger.credited) == 1


# ------------------------------------------------------------------------------------------------ the webhook
def test_the_signed_webhook_adds_the_balance_once_however_often_it_arrives() -> None:
    client, ledger, _ = world()
    o = make_order(client, 2000)
    for i in range(3):
        assert webhook(client, order_paid(o["order_id"], "pay_WEB123", 236000), "evt_1").status_code == 200, i
    assert ledger.credited == [("pay_WEB123", 200000)] and set(ledger.tokens) == {"hook-token"}


def test_a_webhook_with_a_wrong_signature_changes_nothing() -> None:
    client, ledger, _ = world()
    o = make_order(client)
    r = webhook(client, order_paid(o["order_id"], "pay_WEB123", 118000), secret="not-the-secret")
    assert r.status_code == 401 and ledger.credited == [] and ledger.tokens == []
    raw = json.dumps(order_paid(o["order_id"], "pay_WEB123", 118000)).encode()
    assert client.post("/v1/webhooks/razorpay-billing", content=raw).status_code == 401


def test_the_webhook_and_the_browser_racing_credit_once() -> None:
    client, ledger, _ = world()
    o = make_order(client)
    body = {"payment_id": "pay_RACE123", "signature": sign(o["order_id"], "pay_RACE123")}
    assert webhook(client, order_paid(o["order_id"], "pay_RACE123", 118000)).status_code == 200
    r = client.post(f"{CR}/topups/{o['order_id']}/confirm", json=body, headers=auth("a_owner"))
    assert r.status_code == 200 and r.json()["replayed"] is True and len(ledger.credited) == 1
    o2 = make_order(client)
    assert client.post(f"{CR}/topups/{o2['order_id']}/confirm", json={"payment_id": "pay_RACE456", "signature": sign(o2["order_id"], "pay_RACE456")}, headers=auth("a_owner")).json()["replayed"] is False
    assert webhook(client, order_paid(o2["order_id"], "pay_RACE456", 118000), "evt_2").status_code == 200
    assert len(ledger.credited) == 2


def test_a_webhook_for_a_different_amount_adds_nothing_and_the_order_says_why() -> None:
    client, ledger, _ = world()
    o = make_order(client, 500)
    assert webhook(client, order_paid(o["order_id"], "pay_SHORT01", 58999)).status_code == 200
    assert ledger.credited == [] and ledger.orders[o["order_id"]]["failure"] == "amount_mismatch"
    row = client.get(f"{CR}/topups", headers=auth("a_owner")).json()["items"][0]
    assert row["state"] == "failed" and row["failure_code"] == "amount_mismatch" and "nothing was added" in row["failure_text"]
    assert webhook(client, order_paid(o["order_id"], "pay_SHORT01", 59000), "evt_2").status_code == 200 and ledger.credited == [("pay_SHORT01", 50000)], "the right amount still settles the order"


def test_payment_failed_is_recorded_by_order_id_and_the_order_can_still_be_paid() -> None:
    client, ledger, _ = world()
    o = make_order(client)
    failed = {"event": "payment.failed", "payload": {"payment": {"entity": {"id": "pay_BAD00001", "order_id": o["order_id"], "error_code": "BAD_REQUEST_ERROR", "error_reason": "payment_declined"}}}}
    assert webhook(client, failed, "evt_f").status_code == 200
    row = client.get(f"{CR}/topups", headers=auth("a_owner")).json()["items"][0]
    assert row["state"] == "failed" and row["failure_code"] == "bank_declined" and row["failure_text"].startswith("Your bank declined")
    assert webhook(client, order_paid(o["order_id"], "pay_GOOD0001", 118000), "evt_p").status_code == 200
    assert client.get(f"{CR}/topups", headers=auth("a_owner")).json()["items"][0]["state"] == "paid" and len(ledger.credited) == 1
    unknown = {"event": "payment.failed", "payload": {"payment": {"entity": {"id": "pay_BAD00002", "order_id": "order_NOPE000001", "error_reason": "payment_cancelled"}}}}
    assert webhook(client, unknown, "evt_u").status_code == 200, "an unknown order is answered, not retried for ever"
    again = {"event": "payment.failed", "payload": {"payment": {"entity": {"id": "pay_BAD00003", "order_id": o["order_id"]}}}}
    assert webhook(client, again, "evt_g").status_code == 200 and client.get(f"{CR}/topups", headers=auth("a_owner")).json()["items"][0]["state"] == "paid", "a paid order is never marked failed"


@pytest.mark.parametrize(("reason", "word"), [("payment_cancelled", "payment_cancelled"), ("payment_declined", "bank_declined"), ("insufficient_funds", "bank_declined"), ("gateway_technical_error", "payment_failed"), ("", "payment_failed")])
def test_the_providers_reason_becomes_a_plain_word(reason: str, word: str) -> None:
    raw = json.dumps({"event": "payment.failed", "payload": {"payment": {"entity": {"id": "pay_X00001", "order_id": "order_X00001", "error_reason": reason}}}}).encode()
    events = razorpay().verify_webhook({"x-razorpay-signature": hmac.new(HOOK.encode(), raw, hashlib.sha256).hexdigest()}, raw)
    assert [(e.kind, e.order_id, e.reason) for e in events] == [("payment_failed", "order_X00001", word)]


# ------------------------------------------------------------------------------------------------ failed and abandoned payments seen by the owner
def test_the_checkout_reporting_a_failure_or_being_closed_is_recorded_and_the_list_says_so() -> None:
    client, ledger, _ = world()
    a, b, c = make_order(client, 500), make_order(client, 500), make_order(client, 500)
    assert client.post(f"{CR}/topups/{a['order_id']}/failed", json={"reason": "dismissed"}, headers=auth("a_owner")).json() == {"recorded": True}
    assert client.post(f"{CR}/topups/{b['order_id']}/failed", json={"reason": "failed"}, headers=auth("a_owner")).status_code == 200
    ledger.orders[c["order_id"]]["old"] = True
    rows = {r["order_id"]: r for r in client.get(f"{CR}/topups", headers=auth("a_admin")).json()["items"]}
    assert rows[a["order_id"]]["failure_code"] == "dismissed" and rows[a["order_id"]]["failure_text"] == "The payment window was closed before paying."
    assert rows[b["order_id"]]["failure_code"] == "payment_failed" and rows[c["order_id"]]["state"] == "abandoned"
    assert client.post(f"{CR}/topups/order_NOPE000001/failed", json={"reason": "failed"}, headers=auth("a_owner")).json() == {"recorded": False}
    assert client.post(f"{CR}/topups/{a['order_id']}/failed", json={"reason": "bogus"}, headers=auth("a_owner")).status_code == 422
    assert client.post(f"{CR}/topups/{a['order_id']}/failed", json={"reason": "failed"}, headers=auth("a_sales")).status_code == 403


# ------------------------------------------------------------------------------------------------ concurrency
def test_many_confirmations_and_webhooks_at_once_credit_exactly_once() -> None:
    client, ledger, _ = world()
    o = make_order(client, 5000)
    body = {"payment_id": "pay_CONC001", "signature": sign(o["order_id"], "pay_CONC001")}
    results: list[int] = []

    def confirm() -> None:
        results.append(client.post(f"{CR}/topups/{o['order_id']}/confirm", json=body, headers=auth("a_owner")).status_code)

    def hook() -> None:
        results.append(webhook(client, order_paid(o["order_id"], "pay_CONC001", 590000), "evt_c").status_code)

    with ThreadPoolExecutor(max_workers=16) as pool:
        futures = [pool.submit(confirm if i % 2 else hook) for i in range(32)]
        for f in futures:
            f.result()
    assert results == [200] * 32
    assert ledger.credited == [("pay_CONC001", 500000)] and ledger.b["balance_paise"] == 500000 and len(ledger.invoices) == 1


def test_two_payments_for_one_order_at_once_credit_one() -> None:
    client, ledger, _ = world()
    o = make_order(client, 1000)

    def pay(n: int) -> None:
        client.post(f"{CR}/topups/{o['order_id']}/confirm", json={"payment_id": f"pay_TWIN00{n}", "signature": sign(o["order_id"], f"pay_TWIN00{n}")}, headers=auth("a_owner"))

    with ThreadPoolExecutor(max_workers=2) as pool:
        for f in [pool.submit(pay, 1), pool.submit(pay, 2)]:
            f.result()
    assert len(ledger.credited) == 1 and ledger.b["balance_paise"] == 100000


# ------------------------------------------------------------------------------------------------ statement and invoice
def test_the_statement_and_one_invoice_in_full() -> None:
    client, ledger, _ = world()
    o = make_order(client, 1000)
    client.post(f"{CR}/topups/{o['order_id']}/confirm", json={"payment_id": "pay_ABC123", "signature": sign(o["order_id"], "pay_ABC123")}, headers=auth("a_owner"))
    s = client.get(f"{CR}/statement?limit=5", headers=auth("a_admin")).json()
    assert s["balance_text"] == "₹1,000" and s["items"][0]["amount_text"] == "₹1,000" and s["items"][0]["kind"] == "credit" and s["closing_text"] == "₹1,000"
    assert client.get(f"{CR}/statement", headers=auth("a_sales")).status_code == 403
    assert client.get(f"{CR}/statement?from=2026-11-10&to=2026-11-01", headers=auth("a_owner")).json()["error"]["code"] == "statement_dates_invalid"
    inv = client.get(f"{URL}/gst-invoices/{ledger.invoices[0]}", headers=auth("a_owner"))
    assert inv.status_code == 200, inv.text
    d = inv.json()
    assert d["total_text"] == "₹1,180" and d["gst_text"] == "₹180" and d["tax_split"] == "cgst_sgst" and d["cgst_paise"] + d["sgst_paise"] == d["gst_paise"] and d["buyer_gstin"] == "27AAPFU0939F1ZV"
    assert d["seller_details_missing"] is True, "until the owner of the product enters the company name and GSTIN"
    assert d["description"] == "Call balance top-up"
    assert client.get(f"{URL}/gst-invoices/S19-{FY}-999999", headers=auth("a_owner")).status_code == 404
    assert client.get(f"{URL}/gst-invoices/not-a-number", headers=auth("a_owner")).status_code == 422
    assert client.get(f"{URL}/gst-invoices/{ledger.invoices[0]}", headers=auth("a_sales")).status_code == 403


# ------------------------------------------------------------------------------------------------ the refund (staff)
RURL = f"/v1/admin/businesses/{TENANT_A.id}/topups"
REFUND = {"reason_code": "customer_asked", "reason_text": "asked us to", "idempotency_key": "refund-key-0001"}


def paid_world(spent: int = 0, provider: Any = None) -> tuple[Any, Ledger, str]:
    client, ledger, _ = world(provider, admin=True)
    o = make_order(client, 1000)
    client.post(f"{CR}/topups/{o['order_id']}/confirm", json={"payment_id": "pay_ABC123", "signature": sign(o["order_id"], "pay_ABC123")}, headers=auth("a_owner"))
    ledger.b["balance_paise"] -= spent
    return client, ledger, o["order_id"]


def test_the_refund_sends_back_the_unused_part_with_its_gst_and_issues_a_credit_note() -> None:
    seen: list[httpx.Request] = []
    client, ledger, order = paid_world(spent=30000, provider=razorpay(None, seen))
    r = client.post(f"{RURL}/{order}/refund", json=REFUND, headers=auth("a_owner"))
    assert r.status_code == 200, r.text
    d = r.json()
    assert d["unused_paise"] == 70000 and d["refund_paise"] == 82600 and d["gst_paise"] == 12600 and d["refund_text"] == "₹826" and d["credit_note_number"] == "C19-2627-000001" and d["status"] == "done"
    sent = [x for x in seen if x.url.path.endswith("/refund")]
    assert len(sent) == 1 and sent[0].url.path == "/v1/payments/pay_ABC123/refund" and json.loads(sent[0].content)["amount"] == 82600
    assert ledger.b["balance_paise"] == 0, "the unused balance left the wallet"


def test_the_refund_is_staff_only_and_off_without_the_console() -> None:
    client, _, order = paid_world()
    assert client.post(f"{RURL}/{order}/refund", json=REFUND).status_code == 401
    off, _, _ = world(admin=False)
    assert off.post(f"{RURL}/order_RZP000001/refund", json=REFUND, headers=auth("a_owner")).status_code == 404
    for bad in ({**REFUND, "reason_text": "x"}, {**REFUND, "idempotency_key": "short"}, {**REFUND, "reason_code": "because"}, {"reason_code": "other"}):
        assert client.post(f"{RURL}/{order}/refund", json=bad, headers=auth("a_owner")).status_code == 422


def test_the_refusals_of_a_refund_are_plain_words() -> None:
    client, ledger, order = paid_world()
    ok = client.post(f"{RURL}/{order}/refund", json=REFUND, headers=auth("a_owner"))
    assert ok.status_code == 200
    again = client.post(f"{RURL}/{order}/refund", json={**REFUND, "idempotency_key": "refund-key-0002"}, headers=auth("a_owner"))
    assert again.status_code == 409 and again.json()["error"]["code"] == "refund_already_done"
    assert client.post(f"{RURL}/order_NOPE000001/refund", json={**REFUND, "idempotency_key": "refund-key-0003"}, headers=auth("a_owner")).json()["error"]["code"] == "refund_not_a_topup"
    client2, ledger2, order2 = paid_world(spent=100000)
    r = client2.post(f"{RURL}/{order2}/refund", json=REFUND, headers=auth("a_owner"))
    assert r.status_code == 409 and r.json()["error"]["code"] == "refund_nothing_unused" and ledger2.b["balance_paise"] == 0
    assert ledger.refund_calls == ["finish:True"]


def test_a_refund_the_provider_refuses_gives_the_balance_back() -> None:
    def refuse(r: httpx.Request) -> httpx.Response:
        if r.url.path == "/v1/orders":
            return httpx.Response(200, json={"id": "order_RZP000001"})
        return httpx.Response(400, json={"error": {"description": "refused"}})

    client, ledger, order = paid_world(spent=0, provider=razorpay(refuse))
    r = client.post(f"{RURL}/{order}/refund", json=REFUND, headers=auth("a_owner"))
    assert r.status_code == 502 and r.json()["error"]["code"] == "refund_declined"
    assert ledger.b["balance_paise"] == 100000 and ledger.refund_calls == ["finish:False"]


@pytest.mark.parametrize("status", [500, 503])
def test_a_refund_with_no_clear_answer_stays_pending_and_is_never_asked_twice(status: int) -> None:
    calls: list[str] = []

    def unclear(r: httpx.Request) -> httpx.Response:
        if r.url.path == "/v1/orders":
            return httpx.Response(200, json={"id": "order_RZP000001"})
        calls.append(r.url.path)
        return httpx.Response(status, json={})

    client, ledger, order = paid_world(provider=razorpay(unclear))
    first = client.post(f"{RURL}/{order}/refund", json=REFUND, headers=auth("a_owner"))
    assert first.status_code == 502 and first.json()["error"]["code"] == "refund_unconfirmed"
    assert ledger.b["balance_paise"] == 0 and ledger.refund_calls == [], "the unused balance stays out until a person has looked"
    retry = client.post(f"{RURL}/{order}/refund", json=REFUND, headers=auth("a_owner"))
    assert retry.status_code == 502 and retry.json()["error"]["code"] == "refund_unconfirmed"
    assert len(calls) == 1, "the retry did not ask the provider again"


def test_a_retry_of_a_finished_refund_answers_the_same() -> None:
    client, ledger, order = paid_world()
    one = client.post(f"{RURL}/{order}/refund", json=REFUND, headers=auth("a_owner")).json()
    two = client.post(f"{RURL}/{order}/refund", json=REFUND, headers=auth("a_owner")).json()
    assert one["refund_id"] == two["refund_id"] and two["replayed"] is True and one["refund_paise"] == two["refund_paise"]


def test_the_services_unconfirmed_error_is_a_distinct_thing() -> None:
    assert issubclass(RefundUnconfirmedError, Exception) and not issubclass(RefundUnconfirmedError, PaymentMethodDeclinedError)


def test_the_razorpay_adapter_sends_the_refund_and_refuses_nonsense() -> None:
    seen: list[httpx.Request] = []
    p = razorpay(None, seen)
    assert p.refund_payment("pay_ABC123", 5900, "refund-key-0001") == "rfnd_RZP000001"
    sent = json.loads(seen[0].content)
    assert seen[0].url.path == "/v1/payments/pay_ABC123/refund" and sent["amount"] == 5900 and sent["notes"] == {"idempotency_key": "refund-key-0001"}
    from app.billing.errors import NotSupportedError

    for pay, amount in (("../x", 100), ("pay_ABC123", 0), ("pay_ABC123", -5)):
        with pytest.raises(NotSupportedError):
            p.refund_payment(pay, amount, "refund-key-0001")
    assert FakeBillingProvider().refund_payment("pay_fake_1", 100, "k-0000001") == FakeBillingProvider().refund_payment("pay_fake_1", 100, "k-0000001")


# ------------------------------------------------------------------------------------------------ the low balance
def doc(**kw: Any) -> dict[str, Any]:
    base = {"balance_paise": 1000, "plan_id": "payg", "plan_name": "Pay as you go", "rate_paise_per_minute": 500, "minutes_estimate": 2, "included_minutes": 0, "included_half_used": 0, "free_start_granted": True, "free_start_left_paise": 0, "subscription": None}
    return {**base, **kw}


def test_low_means_under_about_four_minutes_and_no_included_minutes_left() -> None:
    assert balance_out(doc(minutes_estimate=3, balance_paise=1999)).low is True
    assert balance_out(doc(minutes_estimate=4, balance_paise=2000)).low is False
    assert balance_out(doc(minutes_estimate=0, balance_paise=0)).low is True
    assert balance_out(doc(minutes_estimate=0, balance_paise=0, plan_id="sales_assistant", included_minutes=500, included_half_used=100)).low is False, "included minutes still cover the calls"
    assert balance_out(doc(minutes_estimate=0, balance_paise=0, plan_id="sales_assistant", included_minutes=500, included_half_used=1000)).low is True, "all 500 included minutes are used"


def test_the_balance_route_carries_the_flag_for_the_web() -> None:
    client, ledger, _ = world()
    ledger.b.update(balance_paise=1500, minutes_estimate=3)
    assert client.get(f"{URL}/balance", headers=auth("a_viewer")).json()["low"] is True
    ledger.b.update(balance_paise=155000, minutes_estimate=310)
    assert client.get(f"{URL}/balance", headers=auth("a_viewer")).json()["low"] is False


# ------------------------------------------------------------------------------------------------ test mode and live mode
def test_a_live_key_stops_the_settings_unless_razorpay_live_ok_says_yes() -> None:
    def settings(**kw: Any) -> Settings:
        return Settings(_env_file=None, api_env="development", **kw)  # type: ignore[call-arg]

    for field in ("billing_razorpay_key_id", "razorpay_key_id"):
        with pytest.raises(ValidationError, match="RAZORPAY_LIVE_OK"):
            settings(**{field: "rzp_live_abc123"})
        assert settings(**{field: "rzp_live_abc123"}, razorpay_live_ok=True).razorpay_live_ok is True
        assert settings(**{field: "rzp_test_abc123"}).razorpay_live_ok is False
    assert settings().razorpay_live_ok is False, "off by default"


def test_the_razorpay_adapter_refuses_a_live_key_without_the_yes_and_knows_its_mode() -> None:
    with pytest.raises(ValueError, match="RAZORPAY_LIVE_OK"):
        RazorpayBilling("rzp_live_abc123", SECRET, HOOK)
    with pytest.raises(ValueError, match="needs a Razorpay key"):
        RazorpayBilling("key_abc123", SECRET, HOOK)
    assert RazorpayBilling("rzp_live_abc123", SECRET, HOOK, live_ok=True).mode == "live"
    assert RazorpayBilling(KEY, SECRET, HOOK).mode == "test" and FakeBillingProvider().mode == "fake"
    assert build_provider("razorpay", (KEY, SECRET, HOOK)).mode == "test"
    with pytest.raises(ValueError, match="RAZORPAY_LIVE_OK"):
        build_provider("razorpay", ("rzp_live_abc123", SECRET, HOOK))
    assert "rzp_live" not in repr(RazorpayBilling("rzp_live_abc123", SECRET, HOOK, live_ok=True)), "no key in a log line"


def test_a_live_provider_is_labelled_live_so_a_test_payment_is_never_mistaken_for_a_real_one() -> None:
    live = RazorpayBilling("rzp_live_abc123", SECRET, HOOK, live_ok=True, client=httpx.Client(transport=httpx.MockTransport(lambda r: httpx.Response(200, json={"id": "order_LIVE00001"}))))
    client, _, _ = world(live)
    assert client.get(f"{CR}/topup-options", headers=auth("a_owner")).json()["mode"] == "live"
    assert make_order(client, 500)["mode"] == "live"


def test_nothing_in_the_credits_answers_says_the_word_credits() -> None:
    client, ledger, _ = world()
    o = make_order(client)
    client.post(f"{CR}/topups/{o['order_id']}/confirm", json={"payment_id": "pay_ABC123", "signature": sign(o["order_id"], "pay_ABC123")}, headers=auth("a_owner"))
    texts = [client.get(f"{CR}/topup-options", headers=auth("a_owner")).text, client.get(f"{CR}/topups", headers=auth("a_owner")).text, client.get(f"{CR}/statement", headers=auth("a_owner")).text,
             client.get(f"{URL}/gst-invoices/{ledger.invoices[0]}", headers=auth("a_owner")).text, json.dumps(o)]
    import re

    # the only "credit" is the closed word of a statement line's kind (and the credit note's kind): never a word a person reads
    assert all("credit" not in re.sub(r'"kind":\s*"credit(_note)?"', "", t).lower() for t in texts), [t[:80] for t in texts]


def test_the_catalogue_constant_matches_the_database_gst() -> None:
    assert CATALOGUE["gst_percent"] == 18.0 and gst_of(100000, round(CATALOGUE["gst_percent"] * 100)) == 18000


# ------------------------------------------------------------------------------------------------ the invoice by e-mail
def test_a_first_paid_confirmation_mails_the_receipt_once_and_the_button_mails_it_again() -> None:
    from app.billing.mail import FakeEmailSender

    mail = FakeEmailSender()
    client, ledger, _ = world(mail=mail)
    o = make_order(client, 1000)
    pay = {"payment_id": "pay_MAIL001", "signature": sign(o["order_id"], "pay_MAIL001")}
    headers = auth("a_owner", email="owner@example.test")
    assert client.post(f"{CR}/topups/{o['order_id']}/confirm", json=pay, headers=headers).status_code == 200
    assert client.post(f"{CR}/topups/{o['order_id']}/confirm", json=pay, headers=headers).status_code == 200   # a repeat: no second receipt
    assert len(mail.sent) == 1 and mail.sent[0].to == "owner@example.test" and ledger.invoices[0] in mail.sent[0].subject
    assert "₹1,180" in mail.sent[0].body and "not yet a valid tax invoice" in mail.sent[0].body
    again = client.post(f"{URL}/gst-invoices/{ledger.invoices[0]}/email", headers=headers)
    assert again.status_code == 200 and again.json() == {"sent": True} and len(mail.sent) == 2
    assert client.post(f"{URL}/gst-invoices/{ledger.invoices[0]}/email", headers=auth("a_sales", email="s@example.test")).status_code == 403
    assert client.post(f"{URL}/gst-invoices/S19-{FY}-999999/email", headers=headers).status_code == 404


def test_the_invoice_mail_needs_a_sender_and_an_address() -> None:
    from app.billing.mail import FakeEmailSender

    client, ledger, _ = world(mail=None)
    o = make_order(client, 1000)
    client.post(f"{CR}/topups/{o['order_id']}/confirm", json={"payment_id": "pay_MAIL002", "signature": sign(o["order_id"], "pay_MAIL002")}, headers=auth("a_owner"))   # a payment still works with no sender
    assert client.post(f"{URL}/gst-invoices/{ledger.invoices[0]}/email", headers=auth("a_owner", email="o@example.test")).json()["error"]["code"] == "mail_unavailable"
    mail = FakeEmailSender()
    client2, ledger2, _ = world(mail=mail)
    o2 = make_order(client2, 1000)
    client2.post(f"{CR}/topups/{o2['order_id']}/confirm", json={"payment_id": "pay_MAIL003", "signature": sign(o2["order_id"], "pay_MAIL003")}, headers=auth("a_owner"))   # a token without an address: nothing is mailed
    assert mail.sent == []
    assert client2.post(f"{URL}/gst-invoices/{ledger2.invoices[0]}/email", headers=auth("a_owner")).json()["error"]["code"] == "mail_unavailable"


def test_the_dev_outbox_shows_what_the_fake_sender_was_asked_to_send() -> None:
    from app.billing.mail import FakeEmailSender

    mail = FakeEmailSender()
    client, _, _ = world(mail=mail)
    o = make_order(client, 1000)
    client.post(f"{CR}/topups/{o['order_id']}/confirm", json={"payment_id": "pay_DEV0001", "signature": sign(o["order_id"], "pay_DEV0001")}, headers=auth("a_owner", email="o@example.test"))
    seen = client.get("/v1/dev/outbox", headers=auth("a_owner")).json()
    assert [m["to"] for m in seen["emails"]] == ["o@example.test"] and "receipt" in seen["emails"][0]["subject"].lower()
    assert client.get("/v1/dev/outbox").status_code == 401
