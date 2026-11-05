"""The Lead Finder for a school (owner decision, 4 Nov 2026): ORGANISATIONS only (associations, companies and their HR, coaching centres, transport and event vendors, institutions), never individuals
or families ("parents in Anantapur" is refused politely); families are reached only from the school's own enquiry list. No stock is matched: the kind of organisation, its size and distance decide.
The qualifying call (simulated) offers a visit or a notice for the members, never a quote. The plan's switch still applies (AI Workforce)."""

# ruff: noqa: E501

from __future__ import annotations

import uuid
from pathlib import Path
from types import SimpleNamespace
from typing import Any

import pytest

from app.lead_finder import intent, packdata
from app.lead_finder.service import LeadFinderService
from tests.dr_tasks_fakes import Scripted
from tests.ea_fakes import FakeTurnDb
from tests.fakes import TENANT_A, auth, make_client
from tests.lf_fakes import NOW, FakeLeadFinderRepo
from tests.test_lf_router import events, text_of, turn

URL = f"/v1/tenants/{TENANT_A.id}"
PACKS = Path(__file__).resolve().parents[3] / "packages" / "packs"


class SchoolRepo(FakeLeadFinderRepo):
    def stock(self, token: str, tenant_id: uuid.UUID) -> list[dict[str, Any]]:
        raise AssertionError("a school's Lead Finder read the catalogue (a school sells no stock)")


def school() -> tuple[Any, FakeLeadFinderRepo]:
    repo = SchoolRepo("education", stock=[])
    client, _ = make_client(lead_finder=LeadFinderService(repo, mode="fixture", clock=lambda: NOW))
    return client, repo


def test_a_school_has_the_lead_finder_for_organisations() -> None:
    client, _ = school()
    assert client.get(f"{URL}/lead-finder/availability", headers=auth("a_owner")).json() == {"available": True, "source": "fixture", "reason": "ok", "upgrade_to": None, "audience": "organisations"}


def test_a_school_finds_organisations_and_never_reads_stock() -> None:
    client, repo = school()
    plan = client.post(f"{URL}/lead-finder/plan", json={"text": "find new apartment associations in Anantapur"}, headers=auth("a_owner"))
    assert plan.status_code == 201, plan.text
    done = client.post(f"{URL}/lead-finder/searches/{plan.json()['id']}/approve", headers=auth("a_owner")).json()
    rows = list(repo.rows.values())
    assert done["state"] == "done" and rows
    by_name = {r["name"]: r for r in rows}
    association = next(r for n, r in by_name.items() if "Residents Welfare Association" in n)
    assert association["decision_reason"] in ("first_calls", "fit_high") and association["fit_reason"].startswith("Residents' association") and "stock" not in association["fit_reason"]
    other_school = next(r for n, r in by_name.items() if n.endswith("Public School"))
    assert other_school["status"] == "needs_owner" and other_school["decision_reason"] == "competitor", "another school is the Owner's call"
    assert not any(r["decision_reason"] in ("no_stock_match", "low_stock") for r in rows), "a school is never held for stock"


@pytest.mark.parametrize("text", ["find parents in Anantapur", "find new families near me", "find students in Kukatpally", "అనంతపురంలో తల్లిదండ్రులను వెతకండి", "अनंतपुर में नए अभिभावक ढूँढो"])
def test_a_request_for_individuals_or_families_is_refused_politely(text: str) -> None:
    client, repo = school()
    r = client.post(f"{URL}/lead-finder/plan", json={"text": text}, headers=auth("a_owner"))
    assert r.status_code == 422 and r.json()["error"]["code"] == "individuals_not_allowed", (text, r.text)
    assert "enquiry list" in r.json()["error"]["message"] and repo.searches_rows == {}


def test_a_parents_association_is_an_organisation() -> None:
    assert not intent.names_individuals("find the parents association in Kukatpally") and intent.is_find_request("find the parents association in Kukatpally")
    assert intent.names_individuals("find parents in Anantapur") and intent.is_find_request("find parents in Anantapur")
    assert not intent.is_find_request("how many parents paid the fees"), "a question about the school's own records is never a search"


def test_a_shop_never_searches_for_people_either() -> None:
    repo = FakeLeadFinderRepo("textiles")
    client, _ = make_client(lead_finder=LeadFinderService(repo, mode="fixture", clock=lambda: NOW))
    r = client.post(f"{URL}/lead-finder/plan", json={"text": "find new families in Jayanagar"}, headers=auth("a_owner"))
    assert r.status_code == 422 and r.json()["error"]["code"] == "individuals_not_allowed" and "enquiry list" not in r.json()["error"]["message"]


@pytest.mark.parametrize(("text", "language", "words"), [("find parents in Anantapur", "en", "organisations only"), ("అనంతపురంలో తల్లిదండ్రులను వెతకండి", "te", "సంస్థలను మాత్రమే")])
def test_in_the_chat_a_school_is_told_kindly_and_nothing_is_searched(text: str, language: str, words: str) -> None:
    llm, db = Scripted(), FakeTurnDb()
    repo = SchoolRepo("education", stock=[])
    agents = SimpleNamespace(assistant_db=lambda token, run_id: db, assistant_llm=lambda: llm, llm_for=lambda job: (lambda: llm), unavailable=None)
    client, _ = make_client(agents=agents, lead_finder=LeadFinderService(repo, mode="fixture", clock=lambda: NOW))  # type: ignore[arg-type]
    evs = events(turn(client, text, message=uuid.uuid4(), language=language))
    assert words in text_of(evs) and "lead_finder" not in [n for n, _ in evs]
    assert llm.requests == [] and repo.searches_rows == {}


def test_the_qualifying_call_with_an_organisation_offers_a_visit_never_a_quote() -> None:
    client, repo = school()
    plan = client.post(f"{URL}/lead-finder/plan", json={"text": "find new apartment associations in Anantapur"}, headers=auth("a_owner")).json()
    client.post(f"{URL}/lead-finder/searches/{plan['id']}/approve", headers=auth("a_owner"))
    target = next(r for r in sorted(repo.rows.values(), key=lambda r: -r["fit_score"]) if r["decision_reason"] == "first_calls")
    client.post(f"{URL}/prospects/actions", json={"ids": [target["id"]], "action": "call"}, headers=auth("a_owner"))
    call = client.post(f"{URL}/prospects/{target['id']}/simulated-call", json={"persona": "interested", "language": "en"}, headers=auth("a_owner"))
    assert call.status_code == 200, call.text
    out = call.json()
    said = " ".join(t["text"] for t in out["transcript"] if t["who"] == "assistant")
    assert out["outcome"] == "qualified" and "visit" in said and "quote" not in said.lower() and out["quote_suggestion"] == []
    assert out["summary"].startswith("About: ") and "school should call to plan" in out["summary"]
    assert "AI assistant" in out["transcript"][0]["text"], "the call still says it is an AI"


def test_the_schools_data_names_only_organisations() -> None:
    data = packdata.for_pack("education", PACKS)
    assert data is not None
    words = " ".join(w for b in data.buyer_types for w in b.words)
    assert not any(intent.names_individuals(f"find {w}") for b in data.buyer_types for w in b.words[:1]), "no buyer type is a kind of person"
    assert "parent" not in words and "famil" not in words and "student" not in words
