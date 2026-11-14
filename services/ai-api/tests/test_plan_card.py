"""The plan card, as the owner reviewed it on 14 Nov 2026 (talk-plan-test/plan-card.png): every word in the conversation's language and spoken (no bookish forms), WHICH group the plan is for,
and a big plan (more than 50 people) that reaches only people with consent, lists who is left out, and needs a second yes the SERVER enforces."""

# ruff: noqa: E501

from __future__ import annotations

import uuid
from typing import Any

from app.agents import register
from app.tasks.planner import build_plan
from app.tasks.resolver import Person
from app.turns import words
from app.turns.service import second_confirm_words
from tests.dr_tasks_fakes import plan_answer
from tests.fakes import TENANT_A, auth
from tests.test_dr_tasks import draft
from tests.test_ea_turns import done, events, turn, world

BASE = f"/v1/tenants/{TENANT_A.id}"
TELUGU_TURN = "అందరికీ కాల్ చెయ్యండి"
TE_QUESTIONS = [{"key": "need", "text": "మీకు ఏం కావాలి?", "type": "text"}]   # the planner writes the customers' questions in the customers' language (checked by code)


def _strings(value: Any) -> list[str]:
    if isinstance(value, str):
        return [value]
    if isinstance(value, dict):
        return [s for v in value.values() for s in _strings(v)]
    if isinstance(value, (list, tuple)):
        return [s for v in value for s in _strings(v)]
    return []


def test_every_telugu_word_of_the_plan_card_is_spoken_not_bookish() -> None:
    lines = _strings(words.PLAN_ASK["te"]) + _strings(words.HOW["te"]) + _strings(words.PLAN_SENTENCE["te"]) + _strings(words.TITLE["te"]) + _strings(words.SECOND_CONFIRM["te"])
    lines += _strings(words.AUDIENCE["te"]) + _strings(words.GOAL["te"]) + _strings(words.NOTE["te"]) + _strings(words.STEP_WHO["te"]) + _strings(words.STEP_HOW["te"]) + _strings(words.STEP_WHEN["te"])
    from app.tasks.compose import CONSENT_ASK

    lines += [words.DAILY_CAP_EXCEEDED["te"], CONSENT_ASK["te"]]
    assert len(lines) > 30
    for line in lines:
        assert register.bookish_in("te", line) == [], line
    # the three the owner named on 14 Nov 2026 are in the list, so they can never come back
    stems = {stem for stem, _, _ in register.bookish_list("te")}
    assert {"ద్వారా", "కొనసాగించ", "విచారణ", "చేయవచ్చునా"} <= stems
    assert register.bookish_in("te", "ఫోన్ కాల్ ద్వారా. కొనసాగించమంటారా?") != []


def test_a_telugu_plan_card_says_the_goal_and_the_question_in_spoken_telugu() -> None:
    client, _, _, _ = world(plan_answer(questions=TE_QUESTIONS))   # the planner's goal is English: "Find out what each new lead needs"
    evs = events(turn(client, TELUGU_TURN, language="te"))
    card = next(d for n, d in evs if n == "confirm_action")
    assert card["language"] == "te"
    assert "Find out" not in card["summary"] and card["summary"].endswith("కాల్ చెయ్యనా?"), card["summary"]
    assert not [w for w in card["summary"].split() if w.isascii() and w.isalpha() and w.lower() not in {"interest", "leads", "enquiries"}], card["summary"]
    for line in [card["summary"], card["title"], *card["steps"]]:
        assert register.bookish_in("te", line) == [], line
    assert card["audience"]["kind"] == "new_enquiries" and card["audience"]["label"] == "కొత్త enquiries" and card["audience"]["count"] == card["count"] + (card["consent"]["skipped"])
    assert card["needs_second_confirm"] is False and card["second_confirm_text"] is None
    assert card["daily_cap"] == {"limit": 100, "used": 0, "remaining": 100}
    assert done(evs)["kind"] == "confirm_action"


def _person(i: int, phone_consent: str) -> Person:
    return Person(uuid.UUID(int=i), uuid.UUID(int=1000 + i), f"Lead {i}", f"+91900000{i:04d}", "new", "2026-11-14T00:00:00Z", phone_consent, phone_consent, False, False, False)


class _Source:
    def __init__(self, n: int, granted: int) -> None:
        self._people = [_person(i, "granted" if i < granted else "unknown") for i in range(n)]

    def by_segment(self, segment: str, days: int | None, limit: int) -> list[Person]:
        return self._people[:limit]

    def by_name(self, name: str, limit: int) -> list[Person]:
        return []

    def by_phone_tails(self, tails: list[str]) -> list[Person]:
        return []


def test_a_big_plan_reaches_only_people_with_consent_and_says_so() -> None:
    planned = build_plan(draft(selectors=[{"segment": "all_leads"}]), source=_Source(60, 45), language="te", provided=None, school=False)
    plan = planned.plan or {}
    assert plan["contacts_total"] == 45 and plan["needs_second_confirm"] is True
    assert plan["consent"] == {"callable": 45, "skipped": 15, "reason_counts": {"no_consent": 15}}
    assert plan["audience"] == {"kind": "all_leads", "count": 60} and "big_batch" in plan["notes"] and "some_skipped" in plan["notes"]
    assert sorted(set(planned.skips.values())) == ["no_consent"] and len(planned.skips) == 15


def test_a_small_plan_is_unchanged_and_needs_no_second_yes() -> None:
    planned = build_plan(draft(selectors=[{"segment": "all_leads"}]), source=_Source(50, 10), language="te", provided=None, school=False)
    plan = planned.plan or {}
    assert plan["needs_second_confirm"] is False and "big_batch" not in plan["notes"]
    assert plan["contacts_total"] == 10 and plan["consent"] == {"callable": 10, "skipped": 40, "reason_counts": {"no_consent": 40}}, "STRICT consent at every size: unknown consent is not called"


def test_the_audience_is_named_for_every_kind_of_group() -> None:
    kinds = {
        "all_leads": [{"segment": "all_leads"}], "new_enquiries": [{"segment": "new_leads"}], "old_leads": [{"segment": "old_leads"}], "recent_leads": [{"segment": "recent_leads", "days": 7}],
        "one": [{"name": "Anu"}], "mixed": [{"segment": "new_leads"}, {"segment": "old_leads"}],
    }
    for kind, selectors in kinds.items():
        got = (build_plan(draft(selectors=selectors), source=_Source(5, 5), language="en", provided=None, school=False).plan or {})["audience"]["kind"]
        assert got == kind, kind


def test_a_yes_to_a_big_plan_needs_the_second_yes_and_the_server_says_so_in_the_owners_language() -> None:
    client, _, _, repo = world(plan_answer(questions=TE_QUESTIONS))
    card = next(d for n, d in events(turn(client, TELUGU_TURN, language="te")) if n == "confirm_action")
    task = repo.tasks[uuid.UUID(card["action_id"])]
    task["plan"]["needs_second_confirm"] = True
    task["plan"]["contacts_total"] = 255
    repo.day_limit = 1000
    url = f"{BASE}/assistant/actions/{card['action_id']}/confirm"
    first = client.post(url, json={"decision": "yes"}, headers=auth("a_owner"))
    assert first.status_code == 409 and first.json()["error"]["code"] == "second_yes_required"
    assert first.json()["error"]["message"] == second_confirm_words("te", "call", 255) == "నిజంగా 255 మందికి కాల్ చెయ్యనా?"
    assert repo.tasks[uuid.UUID(card["action_id"])]["status"] == "planned", "nothing started"
    no = client.post(url, json={"decision": "no"}, headers=auth("a_owner"))
    assert no.status_code == 200, "a no never needs a second answer"


def test_the_second_yes_starts_the_plan() -> None:
    client, _, _, repo = world(plan_answer())
    card = next(d for n, d in events(turn(client, "call the new leads")) if n == "confirm_action")
    repo.tasks[uuid.UUID(card["action_id"])]["plan"]["needs_second_confirm"] = True
    repo.day_limit = 1000
    url = f"{BASE}/assistant/actions/{card['action_id']}/confirm"
    assert client.post(url, json={"decision": "yes"}, headers=auth("a_owner")).status_code == 409
    second = client.post(url, json={"decision": "yes", "second_confirm": True}, headers=auth("a_owner"))
    assert second.status_code == 200 and second.json()["status"] == "confirmed", second.text
