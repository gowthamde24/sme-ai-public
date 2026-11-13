"""C12: POST /billing/checkout, step 1 of a start with a real provider (the web opens Razorpay Checkout with what it returns). Fakes only, no network."""

# ruff: noqa: E501

from __future__ import annotations

import json
from typing import Any

import httpx

from app.billing import fake
from app.billing.fake import FakeBillingProvider
from app.billing.razorpay import RazorpayBilling
from app.billing.service import BillingService
from tests.di_fakes import FakeBillingRepository
from tests.fakes import TENANT_A, auth, make_client

URL = f"/v1/tenants/{TENANT_A.id}/billing/checkout"
KEY = "rzp_test_abc123"


def razorpay(handler: Any = None) -> RazorpayBilling:
    def default(r: httpx.Request) -> httpx.Response:
        if r.method == "GET":
            return httpx.Response(200, json={"items": []})
        return httpx.Response(200, json={"id": "plan_ABC123" if r.url.path == "/v1/plans" else "sub_XYZ789"})

    return RazorpayBilling(KEY, "secret-not-real", "hook-not-real", client=httpx.Client(transport=httpx.MockTransport(handler or default)))


def world(provider: Any, price: int | None = 249900) -> tuple[Any, FakeBillingRepository]:
    repo = FakeBillingRepository(price_paise=price)
    client, _ = make_client(billing=BillingService(repo, provider))
    return client, repo


def test_razorpay_gives_the_key_id_and_the_subscription_and_never_a_secret() -> None:
    client, _ = world(razorpay())
    r = client.post(URL, json={"plan_id": "growth"}, headers=auth("a_owner"))
    assert r.status_code == 200, r.text
    assert r.json() == {"provider": "razorpay", "key_id": KEY, "subscription_id": "sub_XYZ789", "plan_id": "growth", "amount_paise": 249900, "currency": "INR"}
    assert "secret-not-real" not in r.text and "hook-not-real" not in r.text


def test_the_fake_provider_has_no_checkout_step_so_the_web_keeps_its_test_payment_methods() -> None:
    client, _ = world(FakeBillingProvider())
    r = client.post(URL, json={"plan_id": "growth"}, headers=auth("a_owner"))
    assert r.status_code == 200 and r.json()["provider"] == "fake" and r.json()["key_id"] is None and r.json()["subscription_id"] is None


def test_the_closed_refusals() -> None:
    client, _ = world(razorpay(), price=None)
    r = client.post(URL, json={"plan_id": "growth"}, headers=auth("a_owner"))
    assert r.status_code == 409 and r.json()["error"]["code"] == "plan_has_no_price"
    client, _ = world(razorpay())
    assert client.post(URL, json={"plan_id": "no_such_plan"}, headers=auth("a_owner")).json()["error"]["code"] == "plan_unknown"
    client.post(f"{URL.replace('checkout', 'trial')}", json={"plan_id": "growth", "checkout_ref": fake.OK}, headers=auth("a_owner"))   # the fake-shaped ref is refused by Razorpay: no trial started
    client, _ = world(FakeBillingProvider())
    assert client.post(f"{URL.replace('checkout', 'trial')}", json={"plan_id": "growth", "checkout_ref": fake.OK}, headers=auth("a_owner")).status_code == 200
    again = client.post(URL, json={"plan_id": "growth"}, headers=auth("a_owner"))
    assert again.status_code == 409 and again.json()["error"]["code"] == "trial_already_started"


def test_when_razorpay_does_not_answer_it_is_a_plain_503() -> None:
    def down(r: httpx.Request) -> httpx.Response:
        return httpx.Response(500, json={})

    client, _ = world(razorpay(down))
    r = client.post(URL, json={"plan_id": "growth"}, headers=auth("a_owner"))
    assert r.status_code == 503 and r.json()["error"]["code"] == "billing_unavailable"


def test_only_the_owner_and_the_body_is_strict() -> None:
    client, _ = world(razorpay())
    for user in ("a_admin", "a_sales", "a_viewer"):
        assert client.post(URL, json={"plan_id": "growth"}, headers=auth(user)).status_code == 403
    assert client.post(URL, json={"plan_id": "growth"}).status_code == 401
    assert client.post(URL, json={"plan_id": "growth", "price": 1}, headers=auth("a_owner")).status_code == 422
    assert client.post(URL, json={"plan_id": "Growth!"}, headers=auth("a_owner")).status_code == 422


def test_a_razorpay_checkout_ref_fits_the_trial_body() -> None:
    ref = "sub_" + "A" * 14 + ".pay_" + "B" * 14 + "." + "f" * 64
    client, _ = world(FakeBillingProvider())
    r = client.post(URL.replace("checkout", "trial"), json={"plan_id": "growth", "checkout_ref": ref}, headers=auth("a_owner"))
    assert r.status_code != 422, "the long dotted reference is accepted by the body (the provider then judges it)"
    json.dumps(r.json())
