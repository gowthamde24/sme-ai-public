"""Billing v2 API (the owner's final pricing, 13 Nov 2026): everything shown in rupees, never "credits"; the catalogue, the balance with its words, the free start, the estimate. A fake repository; the rules are pgTAP 193."""

# ruff: noqa: E501

from __future__ import annotations

import json
import uuid
from typing import Any, cast

import pytest

from app.pricing.inr import group, inr, minutes_text
from app.pricing.service import PricingService
from tests.fakes import TENANT_A, auth, make_client

URL = f"/v1/tenants/{TENANT_A.id}/billing"
CATALOGUE = {
    "gst_percent": 18.0, "free_start_paise": 5000, "lot_days": 90,
    "plans": [
        {"id": "payg", "name": "Pay as you go", "monthly_paise": 49900, "yearly_paise": 499000, "included_minutes": 0, "rate_paise_per_minute": 500, "numbers_included": 1, "lead_finder": False, "free_searches_month": 1, "extra_search_paise": 4900},
        {"id": "sales_assistant", "name": "Sales Assistant", "monthly_paise": 199900, "yearly_paise": 1999000, "included_minutes": 500, "rate_paise_per_minute": 450, "numbers_included": 1, "lead_finder": False, "free_searches_month": 1, "extra_search_paise": 4900},
        {"id": "sales_lead_finder", "name": "Sales Assistant + Lead Finder", "monthly_paise": 599900, "yearly_paise": 5999000, "included_minutes": 1500, "rate_paise_per_minute": 400, "numbers_included": 3, "lead_finder": True, "free_searches_month": 300, "extra_search_paise": 0},
    ],
}


class FakeRepo:
    def __init__(self, **balance: Any) -> None:
        self.b: dict[str, Any] = {"balance_paise": 155000, "plan_id": "payg", "plan_name": "Pay as you go", "rate_paise_per_minute": 500, "minutes_estimate": 310, "included_minutes": 0, "included_half_used": 0,
                                  "free_start_granted": True, "free_start_left_paise": 0, "subscription": None, **balance}
        self.granted = False

    def catalogue(self, token: str) -> dict[str, Any]:
        return CATALOGUE

    def balance(self, token: str, tenant_id: uuid.UUID) -> dict[str, Any]:
        return dict(self.b)

    def free_start(self, token: str, tenant_id: uuid.UUID, phone_hash: str | None) -> dict[str, Any]:
        first = not self.granted
        self.granted = True
        return {"granted": first, "reason": None if first else "already_granted", "balance_paise": 5000}


def world(**balance: Any) -> Any:
    client, _ = make_client(pricing=PricingService(cast(Any, FakeRepo(**balance))))
    return client


def test_money_reads_like_a_person_says_it() -> None:
    assert [inr(x) for x in (0, 450, 5000, 155000, 199900, 1999000, 12345600, -250)] == ["₹0", "₹4.50", "₹50", "₹1,550", "₹1,999", "₹19,990", "₹1,23,456", "-₹2.50"]
    assert group(1234567) == "12,34,567" and minutes_text(310) == "about 310 call minutes" and minutes_text(1) == "about 1 call minute"


def test_the_balance_shows_rupees_and_minutes_and_never_the_word_credits() -> None:
    r = world().get(f"{URL}/balance", headers=auth("a_viewer"))
    assert r.status_code == 200, r.text
    b = r.json()
    assert b["balance_text"] == "₹1,550" and b["summary_text"] == "₹1,550 · about 310 call minutes" and b["low"] is False and b["topup_available"] is True
    assert b["plan_id"] == "payg" and b["plan_name"] == "Pay as you go" and b["subscription"] is None and b["free_start_left_text"] is None
    assert "credit" not in r.text.lower()


def test_low_balance_and_the_free_start_left_and_the_included_minutes() -> None:
    low = world(balance_paise=4000, minutes_estimate=8, free_start_left_paise=4000, free_start_granted=True).get(f"{URL}/balance", headers=auth("a_owner")).json()
    assert low["low"] is True and low["free_start_left_text"] == "₹40"
    sub = {"interval": "monthly", "status": "active", "period_end": "2026-12-13T00:00:00+00:00", "cancel_at_period_end": False, "price_locked_until": "2027-11-13T00:00:00+00:00"}
    inc = world(plan_id="sales_assistant", plan_name="Sales Assistant", included_minutes=500, included_half_used=120, subscription=sub).get(f"{URL}/balance", headers=auth("a_owner")).json()
    assert inc["included_minutes_left"] == 440 and inc["subscription"]["interval"] == "monthly"


def test_the_catalogue_is_the_owners_prices_with_their_words() -> None:
    c = world().get("/v1/pricing", headers=auth("a_owner")).json()
    plans = {p["id"]: p for p in c["plans"]}
    assert plans["payg"]["monthly_text"] == "₹499 a month" and plans["payg"]["rate_text"] == "₹5 a minute"
    assert plans["sales_assistant"]["monthly_text"] == "₹1,999 a month" and plans["sales_assistant"]["rate_text"] == "₹4.50 a minute" and plans["sales_assistant"]["included_minutes"] == 500
    assert plans["sales_lead_finder"]["monthly_text"] == "₹5,999 a month" and plans["sales_lead_finder"]["numbers_included"] == 3 and plans["sales_lead_finder"]["rate_text"] == "₹4 a minute"
    assert plans["sales_assistant"]["yearly_text"] == "₹19,990 a year" and plans["sales_assistant"]["yearly_saving_text"] == "2 months free"
    assert c["gst_text"] == "+18% GST on invoices" and c["free_start_text"] == "₹50 free to start, no card"
    text = json.dumps(c).lower()
    assert "credit" not in text and "token" not in text
    assert world().get("/v1/pricing").status_code == 401


def test_the_free_start_is_the_owners_and_says_once() -> None:
    client = world()
    first = client.post(f"{URL}/free-start", headers=auth("a_owner")).json()
    assert first == {"granted": True, "reason": None, "balance_paise": 5000, "balance_text": "₹50"}
    again = client.post(f"{URL}/free-start", headers=auth("a_owner")).json()
    assert again["granted"] is False and again["reason"] == "already_granted"
    assert client.post(f"{URL}/free-start", headers=auth("a_admin")).status_code == 403


@pytest.mark.parametrize(("calls", "avg", "cost", "minutes"), [(10, 2.0, 10000, 20.0), (10, 0.3, 2500, 5.0), (4, 1.1, 3000, 6.0)])
def test_the_estimate_rounds_each_call_up_to_a_half_minute_and_uses_the_plan_rate(calls: int, avg: float, cost: int, minutes: float) -> None:
    r = world().post(f"{URL}/estimate", json={"calls": calls, "avg_minutes": avg}, headers=auth("a_owner")).json()
    assert r["cost_paise"] == cost and r["total_minutes"] == minutes and r["rate_text"] == "₹5 a minute" and r["enough"] is True


def test_the_estimate_uses_included_minutes_first_and_says_what_is_short() -> None:
    sub = {"interval": "monthly", "status": "active", "period_end": "2026-12-13T00:00:00+00:00", "cancel_at_period_end": False, "price_locked_until": None}
    inc = world(plan_id="sales_assistant", plan_name="Sales Assistant", rate_paise_per_minute=450, included_minutes=500, included_half_used=980, subscription=sub, balance_paise=1000)
    r = inc.post(f"{URL}/estimate", json={"calls": 20, "avg_minutes": 1}, headers=auth("a_owner")).json()
    assert r["included_minutes_used"] == 10.0 and r["paid_minutes"] == 10.0 and r["cost_paise"] == 4500 and r["enough"] is False and r["shortfall_text"] == "₹35 more needed" and r["time_text"] == "about 20 min of calling"
    long = world().post(f"{URL}/estimate", json={"calls": 100, "avg_minutes": 1.5}, headers=auth("a_owner")).json()
    assert long["time_text"] == "about 2 h 30 min of calling"
    assert world().post(f"{URL}/estimate", json={"calls": 0, "avg_minutes": 1}, headers=auth("a_owner")).status_code == 422
    assert world().post(f"{URL}/estimate", json={"calls": 1, "avg_minutes": 1}, headers=auth("a_sales")).status_code == 403


def test_off_it_is_404_as_if_it_did_not_exist() -> None:
    client, _ = make_client()
    assert client.get(f"{URL}/balance", headers=auth("a_owner")).status_code == 404
    assert client.get("/v1/pricing", headers=auth("a_owner")).status_code == 404
    assert client.post(f"{URL}/free-start", headers=auth("a_owner")).status_code == 404
