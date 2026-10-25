"""Job DI: the routes of plans and billing with fakes (no database): who may call what, the shapes (the response models ARE the contract), the fixed refusals, and that no answer shows AI money."""

# ruff: noqa: E501

from __future__ import annotations

import json
from typing import Any

import pytest

from app.billing import fake
from app.billing.fake import FakeBillingProvider
from app.billing.service import BillingService
from tests.di_fakes import FakeBillingRepository
from tests.fakes import TENANT_A, auth, make_client

A = TENANT_A.id
B = f"/v1/tenants/{A}/billing"
TRIAL = {"plan_id": "growth", "checkout_ref": fake.OK}
ALL = ("a_owner", "a_admin", "a_sales", "a_viewer")


def world(price: int | None = None) -> tuple[Any, FakeBillingRepository]:
    repo = FakeBillingRepository(price_paise=price)
    client, _ = make_client(billing=BillingService(repo, FakeBillingProvider()))
    return client, repo


MATRIX: list[tuple[str, str, Any, tuple[str, ...]]] = [
    ("GET", f"{B}", None, ("a_owner", "a_admin")),
    ("GET", f"{B}/usage", None, ("a_owner", "a_admin")),
    ("POST", f"{B}/trial", TRIAL, ("a_owner",)),
]


@pytest.mark.parametrize(("method", "path", "body", "who"), MATRIX, ids=[f"{m} {p.rsplit('/', 1)[-1]}" for m, p, _b, _w in MATRIX])
def test_who_may_call_what(method: str, path: str, body: Any, who: tuple[str, ...]) -> None:
    for user in ALL:
        client, repo = world()
        r = client.request(method, path, json=body, headers=auth(user))
        if user in who:
            assert r.status_code == 200, (user, r.status_code, r.text)
        else:
            assert r.status_code == 403, (user, r.status_code)
            assert repo.calls == [] or all(name != "start_trial" for name, _ in repo.calls), "a refused caller never reaches the data layer"
    client, _ = world()
    assert client.request(method, path, json=body, headers=auth("b_owner")).status_code == 404, "another business"
    assert client.request(method, path, json=body).status_code == 401, "no token"


def test_cancel_is_the_owners_alone() -> None:
    for user in ALL:
        client, _ = world()
        client.post(f"{B}/trial", json=TRIAL, headers=auth("a_owner"))
        r = client.post(f"{B}/cancel", headers=auth(user))
        assert r.status_code == (200 if user == "a_owner" else 403), (user, r.status_code)


def test_the_trial_and_the_cancel_need_a_second_factor() -> None:
    client, _ = world()
    assert client.post(f"{B}/trial", json=TRIAL, headers=auth("a_owner", aal="aal1")).status_code == 403
    client.post(f"{B}/trial", json=TRIAL, headers=auth("a_owner"))
    assert client.post(f"{B}/cancel", headers=auth("a_owner", aal="aal1")).status_code == 403


def test_the_catalogue_is_for_any_signed_in_user_and_has_no_price() -> None:
    client, _ = world()
    assert client.get("/v1/plans").status_code == 401
    for user in ALL:
        r = client.get("/v1/plans", headers=auth(user))
        assert r.status_code == 200
    body = r.json()
    assert [p["id"] for p in body["plans"]][:4] == ["free_trial", "starter", "growth", "business"]
    assert all(p["price_paise_monthly"] is None and p["price_set"] is False for p in body["plans"])
    assert body["trial"] == {"days": 30, "payment_method_at_start": True, "grace_days_after_failed_payment": 7}


def test_the_billing_answer_is_the_contract_and_shows_no_ai_money() -> None:
    client, _ = world()
    r = client.get(B, headers=auth("a_owner"))
    body = r.json()
    assert set(body) == {"plan", "subscription", "period", "usage", "notices", "can_start_trial"}
    assert set(body["usage"]) == {"call_minutes", "whatsapp_messages"}
    text = json.dumps(body).lower()
    for word in ("token", "micro", "rupee", "cost", "spend", "ledger", "anthropic", "model"):
        assert word not in text, word


def test_starting_the_trial_and_the_refusals_have_fixed_sentences() -> None:
    client, repo = world()
    r = client.post(f"{B}/trial", json=TRIAL, headers=auth("a_owner"))
    assert r.status_code == 200 and r.json()["subscription"]["status"] == "trialing"
    again = client.post(f"{B}/trial", json={**TRIAL, "plan_id": "business"}, headers=auth("a_owner"))
    assert again.status_code == 409 and again.json()["error"]["code"] == "trial_already_started"
    client2, _ = world()
    declined = client2.post(f"{B}/trial", json={**TRIAL, "checkout_ref": fake.DECLINED}, headers=auth("a_owner"))
    assert declined.status_code == 402 and declined.json()["error"]["code"] == "payment_method_declined"
    unknown = client2.post(f"{B}/trial", json={**TRIAL, "plan_id": "platinum"}, headers=auth("a_owner"))
    assert unknown.status_code == 422 and unknown.json()["error"]["code"] == "plan_unknown"
    trial_plan = client2.post(f"{B}/trial", json={**TRIAL, "plan_id": "free_trial"}, headers=auth("a_owner"))
    assert trial_plan.status_code == 422 and trial_plan.json()["error"]["code"] == "plan_unknown"
    nothing = client2.post(f"{B}/cancel", headers=auth("a_owner"))
    assert nothing.status_code == 409 and nothing.json()["error"]["code"] == "nothing_to_cancel"
    assert repo.subs  # the first world kept its subscription


@pytest.mark.parametrize("bad", [{}, {"plan_id": "growth"}, {"checkout_ref": "pm_x"}, {**TRIAL, "extra": 1}, {**TRIAL, "checkout_ref": "has space"}, {**TRIAL, "checkout_ref": "x"}, {**TRIAL, "plan_id": "Growth"}])
def test_the_request_is_closed(bad: dict[str, Any]) -> None:
    client, _ = world()
    assert client.post(f"{B}/trial", json=bad, headers=auth("a_owner")).status_code == 422


def test_without_a_billing_service_the_answer_is_a_plain_unavailable() -> None:
    client, _ = make_client()
    r = client.get(B, headers=auth("a_owner"))
    assert r.status_code == 503 and r.json()["error"]["code"] == "billing_unavailable"
