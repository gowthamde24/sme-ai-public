"""The chat's way into the Lead Finder (owner, 4 Nov 2026): "find new retailers/boutiques/contractors in <place>", typed or spoken, te/en/kn/hi -> the plan card; the owner's OK (the card or a "yes") runs the search.

Two parts:
  * the EVALS of the router's words (te and en, plus hi and kn): every request below becomes the plan, every question about the business's own records below stays what it was;
  * the turn, end to end through POST /assistant/turns (real routes, real router, the in-memory Lead Finder): no model is called, the card comes first, "yes" runs it, "no" cancels it, a Sales member cannot run it,
    a school never sees it, a replay and the stored chat show the card again."""

# ruff: noqa: E501

from __future__ import annotations

import json
import re
import uuid
from types import SimpleNamespace
from typing import Any

import pytest

from app.browser_voice.llm import AskLlm, AskTurns
from app.lead_finder import intent as lf_intent
from app.lead_finder import packdata
from app.lead_finder.service import LeadFinderService
from app.turns import lead_finder as lf_turn
from app.turns.intent import classify
from tests.dr_tasks_fakes import Scripted
from tests.ea_fakes import FakeTurnDb, chat
from tests.fakes import TENANT_A, auth, make_client
from tests.lf_fakes import MATERIAL_STOCK, NOW, FakeLeadFinderRepo
from tests.test_dv_browser_voice import FakeSocket, arun, fake_parts, session_of, sse

BASE = f"/v1/tenants/{TENANT_A.id}/assistant"
TEXTILES = packdata.for_pack("textiles")
MATERIALS = packdata.for_pack("construction_materials")

# ============================================================================================ the evals: the words
# (text, the place the plan searches, the category). Telugu and English are the owner's two; Hindi and Kannada are the others the owner named.
REQUESTS_EN = [
    ("find new retailers in Jayanagar", "Jayanagar", "retailer"),
    ("Find new retailers in Jayanagar Bengaluru", "Jayanagar Bengaluru", "retailer"),
    ("find new boutiques in Banjara Hills", "Banjara Hills", "boutique"),
    ("find boutiques near Banjara Hills", "Banjara Hills", "boutique"),
    ("find saree shops in HSR Layout", "HSR Layout", "retailer"),
    ("search for new textile shops in Anantapur please", "Anantapur", "retailer"),
    ("can you find new contractors in Anantapur", "Anantapur", "contractor"),
    ("look for new builders around Kurnool", "Kurnool", "builder"),
    ("find new retailers in jayanagar", "Jayanagar", "retailer"),   # a transcript in small letters
    ("show me new shops in Koramangala", "Koramangala", "retailer"),
]
REQUESTS_TE = [
    ("జయనగర్‌లో కొత్త రీటైలర్లను వెతకండి", "జయనగర్", "retailer"),
    ("జయనగర్ లో కొత్త షాపులు వెతుకు", "జయనగర్", "retailer"),
    ("Jayanagar లో కొత్త retailers వెతుకు", "Jayanagar", "retailer"),
    ("బంజారా హిల్స్‌లో కొత్త బొటిక్‌లు వెతుకు", "బంజారా హిల్స్", "boutique"),
    ("అనంతపురంలో కొత్త కాంట్రాక్టర్లను వెతకండి", "అనంతపురం", "contractor"),
    ("కర్నూలు లో కొత్త బిల్డర్లను కనుక్కో", "కర్నూలు", "builder"),
    ("ఫైండ్ న్యూ రీటైలర్స్ ఇన్ జయనగర్", "జయనగర్", "retailer"),   # spoken English, written by the recogniser in Telugu letters
    ("దయచేసి అనంతపురంలో కొత్త షాపులు వెతకండి", "అనంతపురం", "retailer"),
]
REQUESTS_HI_KN = [
    ("जयनगर में नए दुकानें ढूंढो", "जयनगर", "retailer"),
    ("अनंतपुर में नए ठेकेदार ढूंढो", "अनंतपुर", "contractor"),
    ("जयनगर के पास नए बुटीक खोजो", "जयनगर", "boutique"),
    ("ಜಯನಗರದಲ್ಲಿ ಹೊಸ ಅಂಗಡಿಗಳನ್ನು ಹುಡುಕಿ", "ಜಯನಗರ", "retailer"),
    ("ಜಯನಗರ ನಲ್ಲಿ ಹೊಸ ಅಂಗಡಿಗಳು ಹುಡುಕು", "ಜಯನಗರ", "retailer"),
    ("ಅನಂತಪುರದಲ್ಲಿ ಹೊಸ ಕಾಂಟ್ರಾಕ್ಟರ್‌ಗಳನ್ನು ಹುಡುಕಿ", "ಅನಂತಪುರ", "contractor"),
]
# the business's own records, and other things: NEVER a search (each keeps the kind it had before the Lead Finder came to the chat)
NOT_REQUESTS = [
    "find customers who have not paid", "find my customers in Jayanagar", "find the invoice of Ravi", "show me the stock in the shop", "how many orders today", "find leads from last week",
    "find pending quotes", "find enquiries from new customers", "who are my new customers?", "show me red sarees", "find the price of kanchi saree", "search orders of Ravi",
    "find a new supplier in Surat", "call the new leads", "what is the best saree shop in Jayanagar?",
    "నా కస్టమర్లను వెతుకు", "ఈరోజు కొత్త ఎంక్వైరీలు ఎన్ని", "జయనగర్‌లో మా పాత కస్టమర్లు ఎవరు", "కొత్త ఆర్డర్లు వెతుకు", "రవికి కాల్ చేయండి",
    "मेरे ग्राहक ढूंढो", "ಜಯನಗರದಲ್ಲಿ ನನ್ನ ಗ್ರಾಹಕರು ಯಾರು",
]


@pytest.mark.parametrize("text, area, category", REQUESTS_EN + REQUESTS_TE + REQUESTS_HI_KN)
def test_eval_a_request_to_find_new_businesses_becomes_the_plan(text: str, area: str, category: str) -> None:
    assert TEXTILES is not None and MATERIALS is not None
    assert lf_intent.is_find_request(text), text
    assert classify(text).reason == "find_new_customers" and classify(text).kind == "action"
    plan = lf_intent.parse(text, MATERIALS if category in ("contractor", "builder") else TEXTILES)
    assert plan is not None and plan.area == area and plan.category_hint == category and plan.query


@pytest.mark.parametrize("text", NOT_REQUESTS)
def test_eval_a_question_about_our_own_records_is_never_a_search(text: str) -> None:
    assert not lf_intent.is_find_request(text), text
    assert classify(text).reason != "find_new_customers"
    assert classify(text) == classify(text, find=False), "the kind is exactly what it was without the Lead Finder"


def test_eval_the_words_of_an_indian_language_request_search_with_the_business_types_english_words() -> None:
    assert TEXTILES is not None and MATERIALS is not None
    assert lf_intent.parse("జయనగర్‌లో కొత్త రీటైలర్లను వెతకండి", TEXTILES).query == "saree shops"  # type: ignore[union-attr]
    assert lf_intent.parse("బంజారా హిల్స్‌లో కొత్త బొటిక్‌లు వెతుకు", TEXTILES).query == "boutiques"  # type: ignore[union-attr]
    assert lf_intent.parse("అనంతపురంలో కొత్త కాంట్రాక్టర్లను వెతకండి", MATERIALS).query == "building contractors"  # type: ignore[union-attr]
    assert lf_intent.parse("find new boutiques in Banjara Hills", TEXTILES).query == "boutiques"  # type: ignore[union-attr]


@pytest.mark.parametrize("text, yes", [("yes", True), ("ok", True), ("OK.", True), ("go ahead", True), ("అవును", True), ("సరే", True), ("హా సరే", True), ("हाँ", True), ("ठीक है", True), ("ಹೌದು", True),
                                       ("no", False), ("cancel", False), ("వద్దు", False), ("नहीं", False), ("ಬೇಡ", False)])
def test_eval_a_bare_yes_or_no_in_each_language(text: str, yes: bool) -> None:
    assert lf_turn.is_answer(text)
    assert lf_turn.polarity(text) == ("yes" if yes else "no")


def test_eval_a_longer_message_is_not_an_answer_to_the_card() -> None:
    assert not lf_turn.is_answer("yes but first tell me how many enquiries came today")
    assert not lf_turn.is_answer("సరే ఈరోజు ఎన్ని ఎంక్వైరీలు వచ్చాయి చెప్పండి")


# ============================================================================================ the turn, end to end
def world(*answers: Any, pack: str = "textiles", module_on: bool = True, stock: list[dict[str, Any]] | None = None) -> tuple[Any, Scripted, FakeTurnDb, FakeLeadFinderRepo]:
    llm = Scripted(*answers)
    db = FakeTurnDb()
    repo = FakeLeadFinderRepo(pack, module_on=module_on, stock=stock)
    agents = SimpleNamespace(assistant_db=lambda token, run_id: db, assistant_llm=lambda: llm, llm_for=lambda job: (lambda: llm), unavailable=None)
    client, _ = make_client(agents=agents, lead_finder=LeadFinderService(repo, mode="fixture", clock=lambda: NOW))  # type: ignore[arg-type]
    return client, llm, db, repo


def events(response: Any) -> list[tuple[str, dict[str, Any]]]:
    assert response.status_code == 200, response.text
    out: list[tuple[str, dict[str, Any]]] = []
    for block in response.text.strip().split("\n\n"):
        lines = block.split("\n")
        out.append((lines[0][len("event: "):], json.loads(lines[1][len("data: "):])))
    return out


def turn(client: Any, text: str, *, conversation: uuid.UUID | None = None, message: uuid.UUID | None = None, user: str = "a_owner", **extra: Any) -> Any:
    body = {"message_id": str(message or uuid.uuid4()), "conversation_id": str(conversation) if conversation else None, "text": text, **extra}
    return client.post(f"{BASE}/turns", json=body, headers=auth(user))


def text_of(evs: list[tuple[str, dict[str, Any]]]) -> str:
    return "".join(d["delta"] for n, d in evs if n == "text").strip()


def card_of(evs: list[tuple[str, dict[str, Any]]]) -> dict[str, Any]:
    cards = [d for n, d in evs if n == "lead_finder"]
    assert len(cards) == 1, [n for n, _ in evs]
    return cards[0]


def test_the_request_shows_the_plan_card_without_a_model_call_and_searches_nothing_yet() -> None:
    client, llm, db, repo = world()
    evs = events(turn(client, "find new retailers in Jayanagar"))
    assert evs[0] == ("intent", {"type": "intent", "kind": "action"})
    card = card_of(evs)
    search = card["search"]
    assert search["state"] == "planned" and search["provider"] == "fixture" and search["area"] == "Jayanagar" and search["query"] == "saree shops" and search["est_cost_paise"] == 0
    assert card["can_approve"] is True
    assert text_of(evs) == "I can look for saree shops in Jayanagar: up to 20 made-up businesses for the demo. Nobody is called or messaged. Shall I search?"
    assert evs[-1][0] == "done" and evs[-1][1]["kind"] == "answer"
    assert llm.requests == [], "no model decides what is searched"
    assert repo.rows == {} and next(iter(repo.searches_rows.values()))["state"] == "planned", "nothing is searched before the OK"
    reply = next(m for m in db.messages if m["role"] == "assistant")
    assert str(reply["id"]) == search["id"], "the plan has the id of the reply that showed it"
    assert db.finished[-1] == ("succeeded", None)


def test_yes_runs_the_search_and_says_the_decision_split() -> None:
    client, llm, _, repo = world()
    conversation = uuid.uuid4()
    events(turn(client, "find new retailers in Jayanagar", conversation=conversation))
    evs = events(turn(client, "yes", conversation=conversation))
    card = card_of(evs)
    search = card["search"]
    assert search["state"] == "done" and search["found"] > 0
    counts = search["counts"]
    said = text_of(evs)
    assert said.startswith(f"Done: I found {counts['new']} businesses in Jayanagar.") and said.endswith("They are in Prospects; nobody was called.")
    if counts.get("needs_owner"):
        assert f"{counts['needs_owner']} need you" in said
    assert not re.search(r"(?<!\d)0 ", said), "a zero is never read out"
    assert llm.requests == [] and len(repo.rows) == counts["new"]
    assert all(r["source"] == "fixture" and str(r["phone"] or "+00").startswith("+00") for r in repo.rows.values()), "made-up businesses only"


def test_the_telugu_request_and_avunu_in_telugu() -> None:
    client, _, _, _ = world()
    conversation = uuid.uuid4()
    evs = events(turn(client, "జయనగర్‌లో కొత్త రీటైలర్లను వెతకండి", conversation=conversation))
    assert card_of(evs)["search"]["area"] == "జయనగర్"
    said = text_of(evs)
    assert said == "జయనగర్ లో చీరల షాపులు కోసం వెతకగలను: demo కోసం తయారు చేసిన 20 వ్యాపారాల వరకు. ఎవరికీ కాల్ లేదా మెసేజ్ చేయను. వెతకమంటారా?"
    assert evs[-1][1]["language"] == "te"
    evs2 = events(turn(client, "అవును", conversation=conversation))
    assert card_of(evs2)["search"]["state"] == "done"
    assert text_of(evs2).startswith("అయిపోయింది: జయనగర్ లో ") and text_of(evs2).endswith("అవి Prospects లో ఉన్నాయి; ఎవరికీ కాల్ చేయలేదు.")


def test_contractors_in_telugu_for_a_construction_business() -> None:
    client, _, _, _ = world(pack="construction_materials", stock=MATERIAL_STOCK)
    conversation = uuid.uuid4()
    evs = events(turn(client, "అనంతపురంలో కొత్త కాంట్రాక్టర్లను వెతకండి", conversation=conversation))
    assert card_of(evs)["search"]["query"] == "building contractors" and "బిల్డింగ్ కాంట్రాక్టర్లు" in text_of(evs)
    evs2 = events(turn(client, "సరే", conversation=conversation))
    assert card_of(evs2)["search"]["state"] == "done"


def test_no_cancels_the_plan_and_nothing_is_searched() -> None:
    client, _, _, repo = world()
    conversation = uuid.uuid4()
    events(turn(client, "find new boutiques in Banjara Hills", conversation=conversation))
    evs = events(turn(client, "no", conversation=conversation))
    assert card_of(evs)["search"]["state"] == "cancelled" and text_of(evs) == "OK, I cancelled the search."
    assert repo.rows == {}


def test_a_sales_member_sees_the_plan_but_cannot_run_it() -> None:
    client, _, _, repo = world()
    conversation = uuid.uuid4()
    evs = events(turn(client, "find new retailers in Jayanagar", conversation=conversation, user="a_sales"))
    assert card_of(evs)["can_approve"] is False and text_of(evs).endswith("The owner or an admin says OK.")
    evs2 = events(turn(client, "yes", conversation=conversation, user="a_sales"))
    assert text_of(evs2) == "Only the owner or an admin can start a search. I left the plan for them."
    assert next(iter(repo.searches_rows.values()))["state"] == "planned" and repo.rows == {}


def test_no_place_asks_where_and_plans_nothing() -> None:
    client, llm, _, repo = world()
    evs = events(turn(client, "find more customers"))
    assert text_of(evs) == "Where should I look? Say the place, for example: find new retailers in Jayanagar."
    assert "lead_finder" not in [n for n, _ in evs] and repo.searches_rows == {} and llm.requests == []


def test_a_school_never_gets_the_lead_finder_in_the_chat() -> None:
    # education: the module is off (and there is no pack data); the words are answered as they always were
    no_record = {"kind": "answer", "answer": "I have no record of shops in Anantapur.", "language": "en", "sources": []}
    client, llm, _, repo = world(no_record, no_record, pack="education", module_on=False)
    evs = events(turn(client, "find new shops in Anantapur"))
    assert "lead_finder" not in [n for n, _ in evs]
    assert evs[0][1]["kind"] == classify("find new shops in Anantapur", find=False).kind
    assert len(llm.requests) >= 1 and repo.searches_rows == {}, "the model answered, as it always did"


def test_the_lead_finder_switched_off_answers_as_usual() -> None:
    llm = Scripted(chat("Sure."))
    db = FakeTurnDb()
    repo = FakeLeadFinderRepo("textiles")
    agents = SimpleNamespace(assistant_db=lambda token, run_id: db, assistant_llm=lambda: llm, llm_for=lambda job: (lambda: llm), unavailable=None)
    client, _ = make_client(agents=agents, lead_finder=LeadFinderService(repo, mode="off", clock=lambda: NOW))  # type: ignore[arg-type]
    evs = events(turn(client, "find new retailers in Jayanagar"))
    assert "lead_finder" not in [n for n, _ in evs] and repo.searches_rows == {}


def test_a_replay_and_the_stored_chat_show_the_card_as_it_is_now() -> None:
    client, _, _, _ = world()
    conversation, message = uuid.uuid4(), uuid.uuid4()
    first = card_of(events(turn(client, "find new retailers in Jayanagar", conversation=conversation, message=message)))
    events(turn(client, "ok", conversation=conversation))
    again = card_of(events(turn(client, "find new retailers in Jayanagar", conversation=conversation, message=message)))
    assert again["search"]["id"] == first["search"]["id"] and again["search"]["state"] == "done", "the replay shows the card as it stands now"
    stored = client.get(f"{BASE}/conversations/{conversation}", headers=auth("a_owner"))
    assert stored.status_code == 200, stored.text
    cards = [m["lead_finder"] for m in stored.json()["messages"] if m.get("lead_finder")]
    assert len(cards) == 1 and cards[0]["search"]["state"] == "done", "one card per search, on the reply that showed the plan, in its state now"
    assert all(m.get("lead_finder") is None for m in stored.json()["messages"] if m["role"] == "user")


def test_a_plain_yes_with_no_card_waiting_is_the_usual_chat() -> None:
    client, llm, _, repo = world(chat("Happy to help."))
    evs = events(turn(client, "yes"))
    assert "lead_finder" not in [n for n, _ in evs] and len(llm.requests) == 1 and repo.searches_rows == {}


def test_the_days_search_cap_is_said_plainly() -> None:
    client, _, _, repo = world()
    repo.settings["searches_per_day"] = 1
    c1, c2 = uuid.uuid4(), uuid.uuid4()
    events(turn(client, "find new retailers in Jayanagar", conversation=c1))
    events(turn(client, "find new boutiques in Banjara Hills", conversation=c2))
    events(turn(client, "yes", conversation=c1))
    evs = events(turn(client, "yes", conversation=c2))
    assert text_of(evs) == "Today's searches are used up. Try again tomorrow." and card_of(evs)["search"]["state"] == "planned"


# ============================================================================================ by voice
@arun
async def test_by_voice_the_card_follows_the_spoken_plan_and_a_spoken_yes_goes_to_the_chats_turn() -> None:
    planned: dict[str, Any] = {"search": {"id": str(uuid.uuid4()), "state": "planned"}, "can_approve": True}
    seen: list[tuple[str, dict[str, Any]]] = []
    ask = AskLlm(AskTurns(lambda c, m, t: iter([sse("text", {"type": "text", "delta": "జయనగర్ లో చీరల షాపులు కోసం వెతకగలను. వెతకమంటారా?"}), sse("lead_finder", {"type": "lead_finder", **planned}),
                                                  sse("done", {"type": "done", "kind": "answer"})])), lambda k, d: seen.append((k, d)))
    spoken = [p async for p in ask.stream("", [{"role": "user", "content": "జయనగర్‌లో కొత్త రీటైలర్లను వెతకండి"}], "ask")]
    assert spoken == ["జయనగర్ లో చీరల షాపులు కోసం వెతకగలను. వెతకమంటారా?"]
    assert [k for k, _ in seen][:2] == ["caption", "lead_finder"], "said first, the card after"
    session = session_of(FakeSocket(), fake_parts())
    session.emit("lead_finder", dict(planned))
    assert session.pending_search is True
    assert session._route("అవును", True, 1) == "strong", "the spoken OK goes to the chat's own turn, which runs the search"
    assert not session._can_speculate("అవును")
    session.emit("lead_finder", {"search": {"id": planned["search"]["id"], "state": "done"}, "can_approve": True})
    assert session.pending_search is False


@pytest.mark.parametrize("text", ["call the parents who enquired about admission", "remind the parents about the campus visit tomorrow", "తల్లిదండ్రులకు అడ్మిషన్ గురించి కాల్ చేయండి"])
def test_a_schools_admission_calls_to_parents_who_asked_stay_on(text: str) -> None:
    """Owner, 4 Nov 2026: block ONLY the Lead Finder for a school. Reaching parents who enquired is the planner's action, untouched by rule 0."""
    intent = classify(text)
    assert intent.kind == "action" and intent.reason == "outreach_verb", text
