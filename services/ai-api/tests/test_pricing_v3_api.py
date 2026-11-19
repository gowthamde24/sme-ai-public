"""Pricing v3 API (the owner's plans and pricing of 19 Nov 2026): Pay as you go / Pro / Business in rupees, ONE wallet with a usage line per feature, the limits, the automatic top-up, the upgrade hint, the
warnings, the read-only gate; the INTERNAL plan ids never leave. A fake repository stands for the database (its rules are pgTAP 260 to 262); payments are billing v2's own code with the fake provider."""

# ruff: noqa: E501

from __future__ import annotations

import copy
import json
import uuid
from typing import Any

import pytest

from app.billing.errors import WorkspaceReadOnlyError
from app.billing.fake import FakeBillingProvider
from app.pricing.service import PricingService
from app.pricing.v3_service import (
    INTERNAL,
    PUBLIC,
    PricingV3Service,
    SettingRefusedError,
    SpendingLimitReachedError,
    WalletEmptyError,
    WorkspaceLapsedError,
)
from tests.fakes import TENANT_A, auth, make_client
from tests.test_pricing_v2_payments import PayRepo

URL = f"/v1/tenants/{TENANT_A.id}/billing/v3"
TID = TENANT_A.id

CATALOGUE = {
    "gst_percent": 18.0, "free_start_paise": 5000, "lot_days": 90, "launch_lock_months": 12, "extra_number_paise": 29900, "number_hold_days": 30, "warn_pct": 80, "data_days": 90, "payg_to_pro_minutes": 300,
    "plans": [
        {"id": "payg", "name": "Pay as you go", "popular": False, "monthly_paise": 49900, "yearly_paise": 499000, "included_minutes": 0, "minute_paise": 500, "numbers_included": 1, "free_searches_month": 2, "search_paise": 4900, "onboarding": "self_and_assistant"},
        {"id": "pro", "name": "Pro", "popular": True, "monthly_paise": 199900, "yearly_paise": 1999000, "included_minutes": 500, "minute_paise": 500, "numbers_included": 1, "free_searches_month": 10, "search_paise": 3900, "onboarding": "self_and_assistant"},
        {"id": "business", "name": "Business", "popular": False, "monthly_paise": 599900, "yearly_paise": 5999000, "included_minutes": 1500, "minute_paise": 500, "numbers_included": 1, "free_searches_month": 100, "search_paise": 2900, "onboarding": "priority"},
    ],
}

WALLET: dict[str, Any] = {
    "balance_paise": 155000, "plan_id": "payg", "plan_name": "Pay as you go", "monthly_paise": 49900, "yearly_paise": 499000, "early_access": False,
    "window_start": "2026-11-01T00:00:00+00:00", "window_end": "2026-12-01T00:00:00+00:00", "free_start_granted": True, "free_start_left_paise": 0, "subscription": None,
    "lines": {
        "calls": {"billed_half_minutes": 25, "included_minutes": 0, "included_half_used": 0, "included_half_left": 0, "rate_paise_per_minute": 500, "charged_paise": 3125, "unpaid_paise": 0, "limit_paise": None},
        "lead_finder": {"searches": 1, "free_searches": 2, "free_left": 1, "search_paise": 4900, "charged_paise": 0, "limit_paise": None},
        "numbers": {"active": 3, "included": 1, "extra": 2, "extra_number_paise": 29900, "charged_paise": 59800, "held": [{"number": "+918012345603", "hold_until": "2026-12-10T00:00:00+00:00"}], "limit_paise": 100000},
        "whatsapp": {"messages": 4, "charged_paise": 340, "limit_paise": None},
        "ai_actions": {"charged_paise": 0},
    },
    "warnings": [{"scope": "wallet", "level": 80, "used_paise": 80000, "of_paise": 100000}],
    "queued_calls": 2, "auto_topup": None, "access": {"access": "full", "read_only_since": None, "delete_on": None, "data_days_left": None},
    "hint": {"has_hint": False, "current_plan": "payg", "suggested_plan": None, "current_cost_paise": 52400, "suggested_cost_paise": None, "saving_paise": 0, "billed_half_minutes": 25, "searches": 1, "days": 30},
}


class FakeV3Repo:
    def __init__(self, **wallet: Any) -> None:
        self.w: dict[str, Any] = {**copy.deepcopy(WALLET), **wallet}
        self.calls: list[tuple[str, Any]] = []
        self.raise_next: Exception | None = None

    def _maybe(self) -> None:
        if self.raise_next is not None:
            exc, self.raise_next = self.raise_next, None
            raise exc

    def catalogue(self, token: str) -> dict[str, Any]:
        return copy.deepcopy(CATALOGUE)

    def wallet(self, token: str, tenant_id: uuid.UUID) -> dict[str, Any]:
        return copy.deepcopy(self.w)

    def access(self, token: str, tenant_id: uuid.UUID) -> dict[str, Any]:
        return dict(self.w["access"])

    def ledger(self, token: str, tenant_id: uuid.UUID, limit: int) -> list[dict[str, Any]]:
        return [{"feature": "calls", "at": "2026-11-19T10:00:00+00:00", "billed_half_minutes": 5, "included_half": 0, "charged_paise": 625, "unpaid_paise": 0}][:limit]

    def limit_set(self, token: str, tenant_id: uuid.UUID, feature: str, limit_paise: int | None) -> dict[str, Any]:
        self._maybe()
        self.calls.append(("limit_set", (feature, limit_paise)))
        return {"feature": feature, "limit_paise": limit_paise}

    def auto_topup_set(self, token: str, tenant_id: uuid.UUID, enabled: bool, amount: int, below: int, monthly_limit: int) -> dict[str, Any]:
        self._maybe()
        self.calls.append(("auto_topup_set", (enabled, amount, below, monthly_limit)))
        self.w["auto_topup"] = {"enabled": enabled, "amount_paise": amount, "below_paise": below, "monthly_limit_paise": monthly_limit, "used_this_month_paise": 0}
        return {}

    def charge_call(self, token: str, tenant_id: uuid.UUID, call_id: uuid.UUID, seconds: int, answered: bool) -> dict[str, Any]:
        self.calls.append(("charge_call", (seconds, answered)))
        return {"charged_paise": 0}

    def charge_search(self, token: str, tenant_id: uuid.UUID, search_id: uuid.UUID) -> dict[str, Any]:
        self._maybe()
        return {"charged_paise": 0, "free": True}

    def charge_whatsapp(self, token: str, tenant_id: uuid.UUID, message_id: uuid.UUID, cost_paise: int) -> dict[str, Any]:
        self.calls.append(("charge_whatsapp", cost_paise))
        return {"charged_paise": cost_paise}

    def feature_gate(self, token: str, tenant_id: uuid.UUID, feature: str) -> dict[str, Any]:
        return {"allowed": True}

    def call_gate(self, token: str, tenant_id: uuid.UUID, call_ref: uuid.UUID) -> dict[str, Any]:
        return {"allowed": False, "queued": True, "reason": "wallet_empty"}

    def queue_release(self, token: str, tenant_id: uuid.UUID, limit: int) -> dict[str, Any]:
        return {"released": [], "expired": 0, "waiting": 0}

    def warnings_take(self, token: str, tenant_id: uuid.UUID) -> dict[str, Any]:
        return {"new": [{"scope": "calls", "level": 100, "used_paise": 50000, "of_paise": 50000}, {"scope": "wallet", "level": 100, "used_paise": 100000, "of_paise": 100000}]}

    def auto_topup_due(self, token: str, tenant_id: uuid.UUID) -> dict[str, Any]:
        return {"due": False}

    def auto_topup_record(self, token: str, tenant_id: uuid.UUID, payment_ref: str, amount_paise: int) -> dict[str, Any]:
        return {"credited": True}

    def numbers_renew(self, token: str, tenant_id: uuid.UUID) -> dict[str, Any]:
        return {"renewed": [], "lapsed": [], "let_go": []}

    def number_taken(self, token: str, tenant_id: uuid.UUID, number: str) -> dict[str, Any]:
        return {"number": number}

    def number_released(self, token: str, tenant_id: uuid.UUID, number: str) -> dict[str, Any]:
        return {"number": number}

    def number_reclaim(self, token: str, tenant_id: uuid.UUID, number: str) -> dict[str, Any]:
        return {"number": number}


def world(**wallet: Any) -> tuple[Any, FakeV3Repo, PayRepo]:
    repo, pay = FakeV3Repo(**wallet), PayRepo()
    service = PricingV3Service(repo, PricingService(pay, FakeBillingProvider()))  # type: ignore[arg-type]
    client, _ = make_client(pricing_v3=service)
    return client, repo, pay


def test_the_plans_are_pay_as_you_go_pro_and_business_with_the_owners_numbers() -> None:
    client, _, _ = world()
    c = client.get("/v1/pricing/v3", headers=auth("a_viewer")).json()
    plans = {p["id"]: p for p in c["plans"]}
    assert list(plans) == ["payg", "pro", "business"] and [p["name"] for p in plans.values()] == ["Pay as you go", "Pro", "Business"]
    assert [p["monthly_text"] for p in plans.values()] == ["₹499 a month", "₹1,999 a month", "₹5,999 a month"]
    assert [p["yearly_text"] for p in plans.values()] == ["₹4,990 a year", "₹19,990 a year", "₹59,990 a year"] and plans["pro"]["yearly_saving_text"] == "2 months free"
    assert [p["included_minutes"] for p in plans.values()] == [0, 500, 1500] and {p["minute_text"] for p in plans.values()} == {"₹5 a minute"}
    assert [p["free_searches_month"] for p in plans.values()] == [2, 10, 100] and [p["search_paise"] for p in plans.values()] == [4900, 3900, 2900]
    assert plans["pro"]["popular"] is True and plans["payg"]["popular"] is False and plans["business"]["onboarding"] == "priority"
    assert c["gst_text"] == "+18% GST on invoices" and c["free_start_text"] == "₹50 free to start, no card" and c["extra_number_text"] == "₹299 a month for each extra number"
    assert c["payg_to_pro_minutes"] == 300 and c["launch_lock_text"] == "Launch prices are locked for 12 months" and c["number_hold_days"] == 30
    assert "Lead Finder: 10 free searches a month, then ₹39 each" in plans["pro"]["lines"] and "500 call minutes included, then ₹5 a minute" in plans["pro"]["lines"]
    text = json.dumps(c)
    for never in ("sales_assistant", "sales_lead_finder", "Lead Desk", "AI Workforce", "credit"):
        assert never.lower() not in text.lower(), never
    assert client.get("/v1/pricing/v3").status_code == 401


def test_off_it_is_404_and_the_old_billing_still_answers() -> None:
    client, _ = make_client()
    assert client.get("/v1/pricing/v3", headers=auth("a_owner")).status_code == 404
    assert client.get(f"{URL}/wallet", headers=auth("a_owner")).status_code == 404
    assert client.put(f"{URL}/limits/calls", json={"limit_paise": 20000}, headers=auth("a_owner")).status_code == 404
    assert client.get(f"/v1/tenants/{TID}/billing/balance", headers=auth("a_owner")).status_code == 404   # billing v2 is off too in this client: nothing changed for it


def test_the_wallet_has_one_balance_and_a_line_per_feature() -> None:
    client, _, _ = world()
    r = client.get(f"{URL}/wallet", headers=auth("a_viewer"))
    assert r.status_code == 200, r.text
    w = r.json()
    assert w["balance_text"] == "₹1,550" and w["plan_id"] == "payg" and w["plan_name"] == "Pay as you go" and w["monthly_text"] == "₹499 a month" and w["early_access"] is False
    lines = w["lines"]
    assert set(lines) == {"calls", "lead_finder", "numbers", "whatsapp", "ai_actions"}
    assert lines["calls"]["billed_minutes"] == 12.5 and lines["calls"]["charged_text"] == "₹31.25" and lines["calls"]["rate_text"] == "₹5 a minute" and lines["calls"]["summary_text"] == "12.5 minutes billed at ₹5 a minute"
    assert lines["lead_finder"]["summary_text"] == "1 free search left this month, then ₹49 each"
    assert lines["numbers"]["summary_text"] == "3 numbers: 1 included, 2 extra at ₹299 a month each" and lines["numbers"]["held"][0]["number"] == "+918012345603" and lines["numbers"]["limit_paise"] == 100000
    assert lines["whatsapp"]["summary_text"] == "At Meta's own cost, no mark-up" and lines["whatsapp"]["charged_text"] == "₹3.40"
    assert lines["ai_actions"] == {"charged_paise": 0, "summary_text": "No charge for AI actions"}
    assert w["warnings"] == [{"scope": "wallet", "level": 80, "used_paise": 80000, "of_paise": 100000, "text": "You have used 80% of your wallet. Add money to keep calls running."}]
    assert w["queued_calls"] == 2 and w["access"]["access"] == "full" and w["hint"]["has_hint"] is False
    assert "credit" not in r.text.lower() and "sales_assistant" not in r.text


def test_a_plan_with_included_minutes_says_how_many_are_used() -> None:
    sub = {"interval": "monthly", "status": "active", "period_end": "2026-12-13T00:00:00+00:00", "cancel_at_period_end": False, "price_locked_until": "2027-11-13T00:00:00+00:00"}
    w = copy.deepcopy(WALLET)
    w["lines"]["calls"].update(included_minutes=500, included_half_used=240, included_half_left=760, billed_half_minutes=240, charged_paise=0)
    client, _, _ = world(plan_id="pro", plan_name="Pro", monthly_paise=199900, subscription=sub, lines=w["lines"])
    body = client.get(f"{URL}/wallet", headers=auth("a_owner")).json()
    assert body["plan_id"] == "pro" and body["lines"]["calls"]["summary_text"] == "120 of 500 included minutes used" and body["lines"]["calls"]["included_minutes_left"] == 380
    assert body["subscription"]["price_locked_until"].startswith("2027-11-13")


def test_the_upgrade_hint_says_what_it_would_save() -> None:
    hint = {"has_hint": True, "current_plan": "payg", "suggested_plan": "pro", "current_cost_paise": 299900, "suggested_cost_paise": 199900, "saving_paise": 100000, "billed_half_minutes": 1000, "searches": 2, "days": 30}
    client, _, _ = world(hint=hint)
    h = client.get(f"{URL}/wallet", headers=auth("a_owner")).json()["hint"]
    assert h["text"] == "In the last 30 days you used 500 call minutes. Pro would have cost ₹1,999 instead of ₹2,999: you would save ₹1,000 a month." and h["suggested_plan"] == "pro" and h["billed_minutes"] == 500


def test_a_workspace_that_is_read_only_says_so_and_for_how_long() -> None:
    access = {"access": "read_only", "read_only_since": "2026-11-10T00:00:00+00:00", "delete_on": "2027-02-08T00:00:00+00:00", "data_days_left": 83}
    client, _, _ = world(access=access)
    a = client.get(f"{URL}/wallet", headers=auth("a_owner")).json()["access"]
    assert a["access"] == "read_only" and a["data_days_left"] == 83 and "read-only" in a["text"] and "83 more days" in a["text"]


def test_early_access_is_marked_so_the_screen_can_say_nothing_is_charged() -> None:
    client, _, _ = world(early_access=True)
    assert client.get(f"{URL}/wallet", headers=auth("a_owner")).json()["early_access"] is True


def test_any_member_reads_the_wallet_only_owner_and_admin_read_the_ledger() -> None:
    client, _, _ = world()
    for who in ("a_owner", "a_admin", "a_sales", "a_viewer"):
        assert client.get(f"{URL}/wallet", headers=auth(who)).status_code == 200
    assert client.get(f"{URL}/ledger", headers=auth("a_admin")).json()["items"][0] == {"feature": "calls", "at": "2026-11-19T10:00:00Z", "billed_minutes": 2.5, "included_minutes": 0.0, "charged_paise": 625, "charged_text": "₹6.25", "unpaid_paise": 0}
    assert client.get(f"{URL}/ledger", headers=auth("a_sales")).status_code == 403
    assert client.get(f"{URL}/ledger?limit=0", headers=auth("a_owner")).status_code == 422
    assert client.get(f"/v1/tenants/{uuid.uuid4()}/billing/v3/wallet", headers=auth("a_owner")).status_code == 404


def test_the_owner_sets_a_limit_per_feature_and_takes_it_away() -> None:
    client, repo, _ = world()
    r = client.put(f"{URL}/limits/calls", json={"limit_paise": 50000}, headers=auth("a_owner"))
    assert r.status_code == 200 and r.json() == {"feature": "calls", "limit_paise": 50000, "limit_text": "₹500"}
    r = client.put(f"{URL}/limits/lead_finder", json={"limit_paise": None}, headers=auth("a_owner"))
    assert r.json() == {"feature": "lead_finder", "limit_paise": None, "limit_text": None}
    assert repo.calls == [("limit_set", ("calls", 50000)), ("limit_set", ("lead_finder", None))]
    assert client.put(f"{URL}/limits/calls", json={"limit_paise": 50000}, headers=auth("a_admin")).status_code == 403
    assert client.put(f"{URL}/limits/ai_actions", json={"limit_paise": 50000}, headers=auth("a_owner")).status_code == 422
    assert client.put(f"{URL}/limits/calls", json={"limit_paise": 5}, headers=auth("a_owner")).status_code == 422
    repo.raise_next = SettingRefusedError("22023")
    refused = client.put(f"{URL}/limits/calls", json={"limit_paise": 50000}, headers=auth("a_owner"))
    assert refused.status_code == 422 and refused.json()["error"]["code"] == "setting_refused"


def test_the_automatic_top_up_is_optional_and_says_what_it_does() -> None:
    client, repo, _ = world()
    body = {"enabled": True, "amount_paise": 100000, "below_paise": 20000, "monthly_limit_paise": 300000}
    r = client.put(f"{URL}/auto-topup", json=body, headers=auth("a_owner"))
    assert r.status_code == 200, r.text
    assert r.json()["summary_text"] == "₹1,000 added when the wallet falls under ₹200, up to ₹3,000 a month" and repo.calls[-1] == ("auto_topup_set", (True, 100000, 20000, 300000))
    assert client.put(f"{URL}/auto-topup", json=body, headers=auth("a_admin")).status_code == 403
    assert client.put(f"{URL}/auto-topup", json={**body, "amount_paise": 100}, headers=auth("a_owner")).status_code == 422
    off = client.put(f"{URL}/auto-topup", json={**body, "enabled": False}, headers=auth("a_owner")).json()
    assert off["enabled"] is False and off["summary_text"].endswith("(switched off)")


def test_the_estimate_uses_the_plans_rate_and_included_minutes() -> None:
    client, _, _ = world(balance_paise=1000)
    r = client.post(f"{URL}/estimate", json={"calls": 10, "avg_minutes": 2.0}, headers=auth("a_owner")).json()
    assert r["cost_paise"] == 10000 and r["rate_text"] == "₹5 a minute" and r["enough"] is False and r["shortfall_text"] == "₹90 more needed"
    w = copy.deepcopy(WALLET)
    w["lines"]["calls"].update(included_minutes=500, included_half_left=1000)
    pro, _, _ = world(lines=w["lines"], plan_id="pro")
    r = pro.post(f"{URL}/estimate", json={"calls": 10, "avg_minutes": 2.0}, headers=auth("a_owner")).json()
    assert r["cost_paise"] == 0 and r["included_minutes_used"] == 20.0 and r["enough"] is True
    early, _, _ = world(early_access=True, balance_paise=0)
    assert early.post(f"{URL}/estimate", json={"calls": 10, "avg_minutes": 2.0}, headers=auth("a_owner")).json()["cost_paise"] == 0


def test_the_plan_ids_are_the_owners_in_and_out_and_the_internal_ones_stay_inside() -> None:
    assert INTERNAL == {"payg": "payg", "pro": "sales_assistant", "business": "sales_lead_finder"} and PUBLIC["sales_assistant"] == "pro"
    client, repo, pay = world()
    q = client.post(f"{URL}/change-quote", json={"plan_id": "business", "interval": "monthly"}, headers=auth("a_owner")).json()
    assert q["from_plan"] == "pro" and q["to_plan"] == "business" and q["total_text"] == "₹2,360" and q["needs_payment"] is True
    assert client.post(f"{URL}/change-quote", json={"plan_id": "sales_assistant", "interval": "monthly"}, headers=auth("a_owner")).status_code == 422
    assert client.post(f"{URL}/checkout", json={"plan_id": "enterprise", "interval": "monthly"}, headers=auth("a_owner")).status_code == 422
    co = client.post(f"{URL}/checkout", json={"plan_id": "pro", "interval": "yearly"}, headers=auth("a_owner"))
    assert co.status_code == 200 and co.json()["plan_id"] == "pro" and co.json()["amount_text"] == "₹19,990" and co.json()["total_text"] == "₹23,588.20"
    sub = client.post(f"{URL}/subscribe", json={"plan_id": "pro", "interval": "monthly", "checkout_ref": "pm_fake_ok"}, headers=auth("a_owner"))
    assert sub.status_code == 200, sub.text
    assert ("subscribe", ("sales_assistant", "monthly", "fake", "sub_fake_pm_fake_ok", "pay_sub_fake_pm_fake_ok")) in pay.calls and sub.json()["plan_id"] == "payg", "the wallet is read back after paying"
    assert client.post(f"{URL}/subscribe", json={"plan_id": "pro", "interval": "monthly", "checkout_ref": "pm_fake_ok"}, headers=auth("a_admin")).status_code == 403
    _ = repo


def test_a_top_up_is_an_order_priced_by_the_database_and_confirmed_once() -> None:
    client, _, pay = world()
    o = client.post(f"{URL}/orders", json={"purpose": "topup", "amount_paise": 100000}, headers=auth("a_owner"))
    assert o.status_code == 200, o.text
    order = o.json()
    assert order["amount_text"] == "₹1,000" and order["gst_text"] == "₹180" and order["total_text"] == "₹1,180" and order["total_paise"] == 118000
    assert client.post(f"{URL}/orders", json={"purpose": "topup", "amount_paise": 500}, headers=auth("a_owner")).status_code == 422
    assert client.post(f"{URL}/orders", json={"purpose": "plan_change", "plan_id": "business", "interval": "monthly"}, headers=auth("a_owner")).status_code == 200
    assert pay.orders[order["order_id"]]["purpose"] == "topup"
    bad = client.post(f"{URL}/orders/{order['order_id']}/confirm", json={"payment_id": "pay_TEST000001", "signature": "wrong"}, headers=auth("a_owner"))
    assert bad.status_code in (200, 402)
    assert client.get(f"{URL}/invoices", headers=auth("a_admin")).json()["items"][0]["total_text"] == "₹1,180"
    assert client.get(f"{URL}/invoices", headers=auth("a_sales")).status_code == 403


def test_the_free_start_is_the_owners() -> None:
    client, _, _ = world()
    assert client.post(f"{URL}/free-start", headers=auth("a_admin")).status_code == 403


def test_a_read_only_workspace_stops_every_change_and_spend_but_not_the_wallet_or_the_payment_routes() -> None:
    access = {"access": "read_only", "read_only_since": "2026-11-10T00:00:00+00:00", "delete_on": "2027-02-08T00:00:00+00:00", "data_days_left": 83}
    client, _, _ = world(access=access)
    locked = client.post(f"/v1/tenants/{TID}/leads", json={}, headers=auth("a_owner"))
    assert locked.status_code == 403 and locked.json()["error"]["code"] == "workspace_read_only"
    assert client.get(f"{URL}/wallet", headers=auth("a_owner")).status_code == 200
    assert client.post(f"{URL}/orders", json={"purpose": "topup", "amount_paise": 100000}, headers=auth("a_owner")).status_code == 200, "a read-only business can still add money and choose a plan"


def test_the_access_answer_is_remembered_for_a_moment_and_a_hiccup_lets_the_request_through() -> None:
    from app.tenancy.repository import UpstreamError

    class Counting(FakeV3Repo):
        n = 0

        def access(self, token: str, tenant_id: uuid.UUID) -> dict[str, Any]:
            Counting.n += 1
            if Counting.n == 3:
                raise UpstreamError("down")
            return super().access(token, tenant_id)

    svc = PricingV3Service(Counting(), None)
    svc.ensure("t", TID, "change")
    svc.ensure("t", TID, "change")
    assert Counting.n == 1
    svc.forget(TID)
    svc.ensure("t", TID, "change")
    svc.forget(TID)
    svc.ensure("t", TID, "change")   # the third ask fails: it goes through
    ro = FakeV3Repo(access={"access": "read_only", "read_only_since": None, "delete_on": None, "data_days_left": 1})
    with pytest.raises(WorkspaceReadOnlyError):
        PricingV3Service(ro, None).ensure("t", TID, "spend")


def test_the_systems_side_returns_what_the_database_says() -> None:
    svc = PricingV3Service(FakeV3Repo(), None)
    assert svc.call_gate("s", TID, uuid.uuid4()) == {"allowed": False, "queued": True, "reason": "wallet_empty"}
    texts = [w.text for w in svc.warnings_take("s", TID)]
    assert texts == ["You have reached your calls spending limit. It stops until next month or until you raise it.", "Your wallet is empty. New calls wait in a queue until you add money."]
    assert svc.charge_whatsapp("s", TID, uuid.uuid4(), 85) == {"charged_paise": 85}


@pytest.mark.parametrize(("exc", "status", "code"), [(SpendingLimitReachedError("SM993"), 409, "spending_limit_reached"), (WalletEmptyError("SM994"), 402, "wallet_empty"), (WorkspaceLapsedError("SM995"), 403, "workspace_read_only")])
def test_the_wallets_refusals_have_closed_words_and_fixed_sentences(exc: Exception, status: int, code: str) -> None:
    repo = FakeV3Repo()
    repo.raise_next = exc
    client, _ = make_client(pricing_v3=PricingV3Service(repo, None))
    # a route that asks the repository for something that can refuse: the limit setter stands for any caller of the system functions
    r = client.put(f"{URL}/limits/calls", json={"limit_paise": 50000}, headers=auth("a_owner"))
    assert r.status_code == status and r.json()["error"]["code"] == code
    assert "SM99" not in r.text
