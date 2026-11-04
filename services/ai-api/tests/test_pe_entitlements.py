"""Plans as feature switches (owner decision, 4 Nov 2026): AI Workforce = every feature; Lead Desk = every feature except the Lead Finder. No price, no charge: a Lead Desk workspace asking to find
new businesses gets the friendly "part of AI Workforce" card with the Plans page's link. The database side is supabase/tests/database/156_pe_entitlements.test.sql."""

# ruff: noqa: E501

from __future__ import annotations

import json
import uuid
from pathlib import Path
from types import SimpleNamespace
from typing import Any

import pytest

from app.billing.fake import FakeBillingProvider
from app.billing.service import BillingService
from app.lead_finder.service import LeadFinderService
from tests.di_fakes import FakeBillingRepository
from tests.dr_tasks_fakes import Scripted
from tests.ea_fakes import FakeTurnDb
from tests.fakes import TENANT_A, auth, make_client
from tests.lf_fakes import NOW, FakeLeadFinderRepo
from tests.test_lf_router import events, text_of, turn

ROOT = Path(__file__).resolve().parents[3]
URL = f"/v1/tenants/{TENANT_A.id}"


def catalogue() -> dict[str, Any]:
    out: dict[str, Any] = json.loads((ROOT / "packages" / "plans" / "plans.json").read_text(encoding="utf-8"))
    return out


def test_the_catalogue_names_two_products_and_every_plan_is_one_of_them() -> None:
    cat = catalogue()
    assert set(cat["products"]) == {"ai_workforce", "lead_desk"}
    assert cat["products"]["ai_workforce"]["features"] == ["lead_desk", "lead_finder"], "AI Workforce: every feature"
    assert cat["products"]["lead_desk"]["features"] == ["lead_desk"], "Lead Desk: every feature except the Lead Finder"
    product = {p["id"]: p["product"] for p in cat["plans"]}
    assert product == {"free_trial": "ai_workforce", "starter": "ai_workforce", "growth": "ai_workforce", "business": "ai_workforce",
                       "calls_payg": "lead_desk", "calls_300": "lead_desk", "calls_1000": "lead_desk"}
    assert all(p["price_paise_monthly"] is None for p in cat["plans"]), "switches, not prices: nothing is priced"


def finder(plan_has_lead_finder: bool, pack: str = "textiles") -> tuple[Any, FakeLeadFinderRepo]:
    repo = FakeLeadFinderRepo(pack, plan_has_lead_finder=plan_has_lead_finder)
    client, _ = make_client(lead_finder=LeadFinderService(repo, mode="fixture", clock=lambda: NOW))
    return client, repo


def test_a_lead_desk_workspace_has_no_lead_finder_and_is_told_where_it_is() -> None:
    client, repo = finder(False)
    avail = client.get(f"{URL}/lead-finder/availability", headers=auth("a_owner")).json()
    assert avail == {"available": False, "source": None, "reason": "not_in_plan", "upgrade_to": "ai_workforce"}
    refused = client.post(f"{URL}/lead-finder/plan", json={"text": "find new retailers in Jayanagar"}, headers=auth("a_owner"))
    assert refused.status_code == 403 and refused.json()["error"]["code"] == "not_in_plan"
    assert repo.searches_rows == {}, "nothing searched, nothing charged"


def test_an_ai_workforce_workspace_keeps_the_lead_finder() -> None:
    client, _ = finder(True)
    assert client.get(f"{URL}/lead-finder/availability", headers=auth("a_owner")).json()["available"] is True


@pytest.mark.parametrize("text", ["find new retailers in Jayanagar", "జయనగర్‌లో కొత్త రీటైలర్లను వెతకండి"])
def test_in_the_chat_a_lead_desk_workspace_gets_the_part_of_ai_workforce_card(text: str) -> None:
    llm = Scripted()
    db = FakeTurnDb()
    repo = FakeLeadFinderRepo("textiles", plan_has_lead_finder=False)
    agents = SimpleNamespace(assistant_db=lambda token, run_id: db, assistant_llm=lambda: llm, llm_for=lambda job: (lambda: llm), unavailable=None)
    client, _ = make_client(agents=agents, lead_finder=LeadFinderService(repo, mode="fixture", clock=lambda: NOW))  # type: ignore[arg-type]
    evs = events(turn(client, text, message=uuid.uuid4()))
    cards = [d["card"] for n, d in evs if n == "work_card"]
    assert len(cards) == 1 and cards[0]["kind"] == "cant_do" and cards[0]["reason"] == "not_in_plan" and cards[0]["upgrade_to"] == "ai_workforce" and cards[0]["screen"]["href"] == "/plans"
    assert "AI Workforce" in text_of(evs) and "lead_finder" not in [n for n, _ in evs]
    assert llm.requests == [] and repo.searches_rows == {}, "no model call, nothing searched"


def billing(plan: str | None) -> Any:
    repo = FakeBillingRepository()
    if plan is not None:
        repo.subs[TENANT_A.id] = {"status": "active", "plan_id": plan, "provider": "fake", "provider_ref": "x", "trial_ends_at": None, "current_period_end": None, "cancel_at_period_end": False,
                                  "grace_until": None, "payment_method_on_file": True, "trial_waiting_for": None}
    client, _ = make_client(billing=BillingService(repo, FakeBillingProvider()))
    return client


@pytest.mark.parametrize(("plan", "product", "finder_on"), [("growth", "ai_workforce", True), ("calls_300", "lead_desk", False), (None, "ai_workforce", True)])
def test_every_member_reads_the_workspaces_switches(plan: str | None, product: str, finder_on: bool) -> None:
    client = billing(plan)
    for user in ("a_owner", "a_admin", "a_sales", "a_viewer"):
        out = client.get(f"{URL}/billing/entitlements", headers=auth(user))
        assert out.status_code == 200, (user, out.text)
        body = out.json()
        assert body["product"] == product and body["features"] == {"lead_desk": True, "lead_finder": finder_on}, user
        assert (body["upgrade"] is None) == finder_on and (finder_on or body["upgrade"]["product"] == "ai_workforce")
    assert client.get(f"{URL}/billing/entitlements", headers=auth("outsider")).status_code in (403, 404)
