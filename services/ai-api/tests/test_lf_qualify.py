"""Lead Finder part C (ADR 0119): the qualifying call in the SIMULATOR. 6 retailer personas x 2 business types x te/en = 24 calls; every eval passes on every call (A4): the AI disclosure in the
first 10 seconds, never an out-of-stock pitch, never an invented price, a stop on "don't call", the call's language, WhatsApp only with an explicit yes, one question per turn, and the expected outcome."""

# ruff: noqa: E501
from __future__ import annotations

import uuid
from pathlib import Path
from typing import Any

import pytest

from app.lead_finder import packdata, qualify
from app.lead_finder.service import LeadFinderService, stock_lines
from tests.fakes import TENANT_A, auth, make_client
from tests.lf_fakes import MATERIAL_STOCK, NOW, TEXTILE_STOCK, FakeLeadFinderRepo

PACKS = Path(__file__).resolve().parents[3] / "packages" / "packs"
CASES = [("textiles", "textile", TEXTILE_STOCK, "Lakshmi Silks"), ("construction_materials", "materials", MATERIAL_STOCK, "Sri Sai Cements")]


def run(pack: str, domain: str, stock_rows: list[dict[str, Any]], business: str, persona: str, lang: str) -> tuple[qualify.CallResult, list[qualify.EvalResult]]:
    data = packdata.for_pack(pack, PACKS)
    assert data is not None
    stock = stock_lines(stock_rows)
    likely = data.buyer_types[0].likely
    result = qualify.simulate(business=business, data=data, stock=stock, language=lang, persona=persona, domain=domain, likely=likely)  # type: ignore[arg-type]
    return result, qualify.evaluate(result, stock)


@pytest.mark.parametrize("pack, domain, stock, business", CASES, ids=[c[0] for c in CASES])
@pytest.mark.parametrize("persona", qualify.PERSONAS)
@pytest.mark.parametrize("lang", ["en", "te"])
def test_every_persona_every_pack_both_languages(pack: str, domain: str, stock: list[dict[str, Any]], business: str, persona: str, lang: str) -> None:
    result, evals = run(pack, domain, stock, business, persona, lang)
    failed = [f"{e.name} ({e.detail})" for e in evals if not e.passed]
    assert not failed, f"{pack}/{persona}/{lang}: {failed}\n" + "\n".join(f"{t.who}: {t.text}" for t in result.turns)
    assert result.outcome == qualify.EXPECTED_OUTCOME[persona], (persona, result.outcome)
    assert len(result.turns) <= 2 * qualify.Qualifier.MAX_TURNS + 1
    if persona == "wants_whatsapp":
        assert result.whatsapp_ok
    else:
        assert not result.whatsapp_ok, "nobody else agreed to WhatsApp"
    if persona == "busy_call_later":
        assert result.callback
    if result.outcome == "qualified":
        assert result.pitched and result.quote_suggestion and all(q["item"] in result.pitched for q in result.quote_suggestion)


def test_the_pitch_names_only_in_stock_items_with_their_catalogue_price() -> None:
    result, _ = run("textiles", "textile", TEXTILE_STOCK, "Lakshmi Silks", "interested", "en")
    pitch = next(t.text for t in result.turns if t.kind == "pitch")
    assert "Kanchi Pattu Bridal at 8,500 rupees per piece" in pitch and "Dharmavaram Silk Classic at 4,500 rupees per piece" in pitch
    assert "Banarasi" not in pitch and "Soft Silk Daily" not in pitch, "made to order and few-left items are not pitched"


def test_an_item_without_a_set_price_is_never_given_one() -> None:
    result, evals = run("construction_materials", "materials", MATERIAL_STOCK, "Sri Sai Cements", "interested", "en")
    pitch = next(t.text for t in result.turns if t.kind == "pitch")
    assert "TMT Steel 12mm" in pitch and "The owner will share the exact price" in pitch
    assert "TMT Steel 12mm at" not in pitch
    assert all(e.passed for e in evals)


def test_a_question_about_an_out_of_stock_item_is_answered_honestly() -> None:
    result, _ = run("textiles", "textile", TEXTILE_STOCK, "Lakshmi Silks", "price_shopper", "en")
    said = [t for t in result.turns if t.kind == "not_in_stock"]
    assert said and "Banarasi Georgette is not in stock right now" in said[0].text


def test_asked_whether_it_is_a_robot_it_says_it_is_an_ai() -> None:
    result, _ = run("textiles", "textile", TEXTILE_STOCK, "Lakshmi Silks", "interested", "te")
    assert any(t.kind == "ai_yes" and "AI assistant" in t.text for t in result.turns)


def test_the_opening_says_ai_in_the_first_sentence_in_both_languages() -> None:
    for lang in ("en", "te"):
        result, _ = run("textiles", "textile", TEXTILE_STOCK, "Lakshmi Silks", "interested", lang)
        first = result.turns[0]
        assert first.who == "assistant" and first.t == 0 and "AI assistant" in first.text.split(".")[0] + first.text.split("?")[0]


def test_the_evals_catch_a_bad_call() -> None:
    """The evals are not vacuous: a made-up price, an out-of-stock pitch and a call that goes on after "don't call" all fail."""
    stock = stock_lines(TEXTILE_STOCK)
    bad = qualify.CallResult(language="en", persona="x", outcome="contacted", end_reason="goodbye", turns=[
        qualify.Turn("assistant", "Hello, this is Lakshmi Silks.", 0.0, "intro"),
        qualify.Turn("business", "Please don't call this number again.", 3.0),
        qualify.Turn("assistant", "We have Banarasi Georgette at 999 rupees.", 5.0, "pitch"),
        qualify.Turn("assistant", "What do you sell?", 8.0, "question:sells"),
    ], pitched=["Banarasi Georgette"])
    failed = {e.name for e in qualify.evaluate(bad, stock) if not e.passed}
    assert {"disclosure_first_10s", "never_pitches_out_of_stock", "never_invents_prices", "stops_on_dont_call"} <= failed


def test_the_simulated_call_api_writes_the_result_and_a_qualified_one_becomes_a_lead() -> None:
    repo = FakeLeadFinderRepo("textiles")
    c, _ = make_client(lead_finder=LeadFinderService(repo, mode="fixture", clock=lambda: NOW))
    url = f"/v1/tenants/{TENANT_A.id}"
    card = c.post(f"{url}/lead-finder/plan", json={"text": "find saree shops in Jayanagar"}, headers=auth("a_owner")).json()
    c.post(f"{url}/lead-finder/searches/{card['id']}/approve", headers=auth("a_owner"))
    waiting = c.get(f"{url}/prospects?status=needs_owner", headers=auth("a_owner")).json()["items"]
    target = next(p for p in waiting if p["decision_reason"] == "first_calls")
    assert c.post(f"{url}/prospects/{target['id']}/simulated-call", json={"persona": "interested"}, headers=auth("a_owner")).status_code == 409, "only a call-ready business is called"
    c.post(f"{url}/prospects/actions", json={"ids": [target["id"]], "action": "call"}, headers=auth("a_owner"))
    assert c.post(f"{url}/prospects/{target['id']}/simulated-call", json={"persona": "interested"}, headers=auth("a_sales")).status_code == 403
    r = c.post(f"{url}/prospects/{target['id']}/simulated-call", json={"persona": "interested", "language": "te"}, headers=auth("a_owner"))
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["simulated"] is True and body["outcome"] == "qualified" and all(body["evals"].values())
    assert body["prospect"]["status"] == "qualified" and body["prospect"]["lead_id"] and repo.leads
    assert body["quote_suggestion"] and body["transcript"][0]["who"] == "assistant"
    stored = repo.calls[-1][1]
    assert stored["simulated"] is True and "transcript" not in stored, "the transcript is not kept in the database"
    # do not call
    other = next(p for p in waiting if p["id"] != target["id"])
    c.post(f"{url}/prospects/actions", json={"ids": [other["id"]], "action": "call"}, headers=auth("a_owner"))
    stop = c.post(f"{url}/prospects/{other['id']}/simulated-call", json={"persona": "not_interested"}, headers=auth("a_owner")).json()
    assert stop["outcome"] == "do_not_call" and stop["prospect"]["suppressed"] is True
    assert c.post(f"{url}/prospects/{other['id']}/simulated-call", json={"persona": "interested"}, headers=auth("a_owner")).status_code == 409, "never called again"
    assert c.post(f"{url}/prospects/{uuid.uuid4()}/simulated-call", json={"persona": "robot"}, headers=auth("a_owner")).status_code == 422
