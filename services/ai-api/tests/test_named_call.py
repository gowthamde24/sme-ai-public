"""Calling ONE named person (owner, 14 Nov 2026: "Yashwanth Reddy ki call cheyyi" answered "I can't call"): the name is matched in any script, a person who is not there is asked for (the number is the
instruction to save him), one person the Owner names counts as consent on their yes, and a plan with nobody never becomes a card to say yes to."""

# ruff: noqa: E501

from __future__ import annotations

import uuid
from types import SimpleNamespace
from typing import Any

import pytest

from app.tasks import names
from app.tasks.dialer import FakeDialer
from app.tasks.knowledge import FixedKnowledge
from app.tasks.planner import build_plan, phone_in
from app.tasks.resolver import Person
from app.tasks.service import TasksService
from app.turns.intent import classify
from tests.dr_tasks_fakes import FakeTasksRepository, plan_answer, uid
from tests.test_call_limit_and_consent import assistant
from tests.test_dr_tasks import draft
from tests.test_ea_turns import done, events, turn


def _person(n: int, name: str, consent: str = "unknown") -> Person:
    return Person(uuid.UUID(int=n), uuid.UUID(int=1000 + n), name, f"+91900000{n:04d}", "new", "2026-11-14T00:00:00Z", consent, consent, False, False, False)


class _Source:
    def __init__(self, people: list[Person]) -> None:
        self.people = people

    def by_segment(self, segment: str, days: int | None, limit: int) -> list[Person]:
        return self.people[:limit]

    def by_name(self, name: str, limit: int) -> list[Person]:
        return [p for p in self.people if names.matches(name, p.name or "")][:limit]

    def by_phone_tails(self, tails: list[str]) -> list[Person]:
        return []


# ============================================================================ names in any script
def test_a_name_matches_across_scripts_and_spellings() -> None:
    assert names.matches("యశ్వంత్ రెడ్డి", "Yashwanth Reddy") and names.matches("Yashwanth Reddy", "యశ్వంత్ రెడ్డి")
    assert names.matches("Yashwant Reddi", "Yashwanth Reddy") and names.matches("Yashwanth", "Yashwanth Reddy")
    assert names.matches("Yashwanth Reddyకి", "Yashwanth Reddy"), "a Telugu ending glued to the name is not part of it"
    assert names.matches("Ravi ki", "Ravi Kumar"), "Tenglish 'ki' is not part of the name"
    assert not names.matches("Ramesh", "Ravi Kumar") and not names.matches("Reddy", "Ravi Teja")
    assert names.score("Yashwanth", "Yashwanth") > names.score("Yashwanth", "Yashwanth Reddy") > 0


def test_a_phone_number_is_found_in_the_owners_words() -> None:
    assert phone_in("98765 43210") == "9876543210" and phone_in("+91 98765-43210 please") == "9876543210"
    assert phone_in("9 8 7 6 5 4 3 2 1 0") == "9876543210" and phone_in("no number here") is None and phone_in("12345") is None


def test_the_router_reads_the_owners_phrasings_as_calls() -> None:
    for text in ("Yashwanth Reddyకి కాల్ చేసి", "ఇప్పుడు యశ్వంత్ రెడ్డికి కాల్ చెయ్యి.", "ఎవరికైనా కాల్ చెయ్యి.", "Yashwanth Reddy ki call cheyyi"):
        assert classify(text, None).kind == "action", text
    assert classify("ఎవరికి కాల్ చేయాలి", None).kind != "action", "a real question about whom to call stays a question"


# ============================================================================ the plan
def test_one_named_person_is_planned_and_their_yes_is_the_consent() -> None:
    planned = build_plan(draft(selectors=[{"name": "యశ్వంత్ రెడ్డి"}]), source=_Source([_person(1, "Yashwanth Reddy")]), language="te", provided=None, school=False)
    plan = planned.plan or {}
    assert plan["contacts_total"] == 1 and plan["consent"] == {"callable": 1, "skipped": 0, "reason_counts": {}, "owner_named": True} and plan["audience"] == {"kind": "one", "count": 1}


def test_a_person_who_stopped_is_never_called_even_when_named() -> None:
    planned = build_plan(draft(selectors=[{"name": "Yashwanth"}]), source=_Source([_person(1, "Yashwanth Reddy", "withdrawn")]), language="en", provided=None, school=False)
    plan = planned.plan or {}
    assert plan["contacts_total"] == 0 and plan["consent"]["reason_counts"] == {"opted_out": 1} and plan["consent"]["owner_named"] is False


def test_a_person_who_is_not_there_is_asked_for_in_the_conversation_language_with_the_offer_to_save() -> None:
    planned = build_plan(draft(selectors=[{"name": "Yashwanth Reddy"}]), source=_Source([]), language="te", provided=None, school=False, instruction="Yashwanth Reddyకి కాల్ చేసి")
    assert planned.question is not None and "Yashwanth Reddy" in planned.question and "సేవ్" in planned.question and planned.plan is None
    english = build_plan(draft(selectors=[{"name": "Yashwanth Reddy"}]), source=_Source([]), language="en", provided=None, school=False, instruction="call Yashwanth Reddy")
    assert english.question == "I don't have Yashwanth Reddy's number. Tell me the number and I'll save Yashwanth Reddy and call."


def test_the_number_the_owner_gives_is_saved_and_the_plan_is_made() -> None:
    source = _Source([])
    saved: list[tuple[str, str]] = []

    def save(name: str, phone: str) -> str:
        saved.append((name, phone))
        source.people.append(_person(9, name))
        return ""

    planned = build_plan(draft(selectors=[{"name": "Yashwanth Reddy"}]), source=source, language="en", provided=None, school=False,
                         instruction="call Yashwanth Reddy\n(The owner was asked: number? Answer: 98765 43210)", save_person=save)
    assert saved == [("Yashwanth Reddy", "9876543210")] and (planned.plan or {})["contacts_total"] == 1 and planned.question is None
    refused = build_plan(draft(selectors=[{"name": "Yashwanth Reddy"}]), source=_Source([]), language="en", provided=None, school=False, instruction="call Yashwanth Reddy 9876543210", save_person=lambda n, p: "error")
    assert refused.question is not None, "a number that could not be saved asks again, it never makes an empty plan"


def test_a_workspace_that_takes_no_real_numbers_yet_says_so_plainly() -> None:
    planned = build_plan(draft(selectors=[{"name": "Yashwanth Reddy"}]), source=_Source([]), language="en", provided=None, school=False, instruction="call Yashwanth Reddy 9876543210", save_person=lambda n, p: "gate")
    assert planned.question is not None and "cannot keep real phone numbers" in planned.question


def test_two_people_with_the_same_name_are_asked_which_one() -> None:
    both = _Source([_person(1, "Ravi Kumar"), _person(2, "Ravi Teja")])
    planned = build_plan(draft(selectors=[{"name": "Ravi"}]), source=both, language="en", provided=None, school=False)
    assert planned.question == "Which Ravi? Ravi Kumar, Ravi Teja"
    exact = _Source([_person(1, "Ravi"), _person(2, "Ravi Teja")])
    assert (build_plan(draft(selectors=[{"name": "Ravi"}]), source=exact, language="en", provided=None, school=False).plan or {})["contacts_total"] == 1


# ============================================================================ the conversation
def test_a_call_to_a_named_person_is_made_at_once_and_the_consent_is_recorded() -> None:
    client, repo, _ = assistant(plan_answer(selectors=[{"name": "Babu Rao"}], goal="Say hello", questions=[], template="custom"))   # Babu: consent unknown in the synthetic workspace
    evs = events(turn(client, "call Babu Rao"))
    assert not [n for n, _d in evs if n == "confirm_action"], "the instruction IS the approval: no card to say yes to"
    assert {c["p_channel"] for c in repo.consents} == {"phone"} and all(c["p_status"] == "granted" and c["p_evidence_type"] == "verbal" and c["p_contact_id"] == uid(2) for c in repo.consents)
    assert done(evs)["kind"] == "answer"


def test_a_plan_with_nobody_in_it_is_never_a_card_to_say_yes_to() -> None:
    client, _, _ = assistant(plan_answer(selectors=[{"segment": "old_leads"}], goal="Call the old leads"), who=[])
    evs = events(turn(client, "call the old leads"))
    assert not [n for n, _d in evs if n == "confirm_action"]
    reply = next(d for n, d in evs if n == "done")
    assert reply["kind"] == "clarify"


# ============================================================================ the call itself
def test_one_named_person_is_rung_for_real_only_on_a_sandbox_number() -> None:
    from app.telephony.wiring import NamedCallDialer

    seen: list[str] = []

    class _D:
        def __init__(self, label: str) -> None:
            self.label = label

        def call(self, **kw: object) -> str:
            seen.append(f"{self.label}:{kw.get('phone')}")
            return self.label

    dialer = NamedCallDialer(_D("real"), _D("fake"), lambda p: p.endswith("0001"))
    assert dialer.call(phone="+919876500001") == "real" and dialer.call(phone="+919876500002") == "fake" and dialer.call(phone="") == "fake"
    assert seen == ["real:+919876500001", "fake:+919876500002", "fake:"]


def test_a_plan_the_owner_named_runs_on_the_named_dialer_and_any_other_plan_does_not(monkeypatch: pytest.MonkeyPatch) -> None:
    chosen: list[str] = []

    class _Named(FakeDialer):
        def __init__(self) -> None:
            super().__init__()
            self.name = "named"

    class _Service(TasksService):
        def get(self, token: str, tenant_id: uuid.UUID, task_id: uuid.UUID) -> Any:
            return SimpleNamespace(plan=SimpleNamespace(consent=SimpleNamespace(owner_named=task_id.int == 1)))

    class _Runner:
        def __init__(self, repo: object, dialer: object, outbox: object) -> None:
            chosen.append(str(getattr(dialer, "name", "?")))

        def run(self, *args: object) -> None:
            return None

    monkeypatch.setattr("app.tasks.service.TaskRunner", _Runner)
    service = _Service(FakeTasksRepository(), FakeDialer(), FixedKnowledge([]), named_dialer=_Named())
    runtime: Any = SimpleNamespace(outbox=None)
    service.run(runtime, "t", uuid.uuid4(), "Shop", uuid.UUID(int=1))
    service.run(runtime, "t", uuid.uuid4(), "Shop", uuid.UUID(int=2))
    assert chosen == ["named", "fake"]


def test_a_call_that_finds_something_out_is_a_call_plan_first_with_the_questions_and_the_opening_line() -> None:
    client, repo, _ = assistant(plan_answer(selectors=[{"name": "Babu Rao"}], goal="Find out if he wants the 2BHK and a site visit", questions=[{"key": "interest", "text": "Are you interested in the 2BHK?", "type": "yesno"}, {"key": "visit", "text": "Can you visit on Saturday?", "type": "yesno"}]))
    card = next(d for n, d in events(turn(client, "ask Babu Rao if he is interested in the 2BHK and wants a site visit")) if n == "confirm_action")
    plan = card["call_plan"]
    assert plan["people"] and plan["people"][0]["name"] and plan["goal"].startswith("Find out") and [q["text"] for q in plan["questions"]] == ["Are you interested in the 2BHK?", "Can you visit on Saturday?"]
    assert "AI assistant" in plan["opening_line"] and len(plan["outcomes"]) == 2 and plan["outcomes"][0]["when"] == "They answer" and "answer" in plan["outcomes"][0]["then"]
    assert repo.consents == [], "nothing is called or recorded before the owner's yes"


def test_telugu_and_hindi_ask_requests_are_actions_and_the_telugu_call_limit_is_routed() -> None:
    from app.assistant_work.router import touches

    for text in ("అనిత హెగ్డేని అడగండి ఆమెకి కొత్త కాంచీపట్టు కావాలా అని", "रवि से पूछिए कि वह आएगा"):
        assert classify(text, None).kind == "action", text
    assert classify("ఏమి అడగాలి?", None).kind != "action", "a question about what to ask is a question"
    assert touches("రోజుకు కాల్స్ లిమిట్ 150 చేయండి")


def test_a_new_complete_instruction_is_never_taken_as_the_answer_to_a_question_left_waiting() -> None:
    from app.turns.service import is_fresh_instruction

    for text in ("call Yashwanth Reddy", "send Kalyani: hi there", "Ask Anitha if she wants a visit", "start a campaign for the new silk collection"):
        assert is_fresh_instruction(text), text
    for text in ("Kalyani Gowda", "tomorrow", "yes", "the second one", "98480 12345"):
        assert not is_fresh_instruction(text), text
    client, repo, _ = assistant(plan_answer(selectors=[{"name": "Babu Rao"}], clarifying_question="Which one?"), plan_answer(selectors=[{"name": "Babu Rao"}], goal="Hello", questions=[], template="custom"))
    first = events(turn(client, "ask Babu Rao about the order"))
    conversation = next(d["conversation_id"] for n, d in first if "conversation_id" in d)
    second = events(turn(client, "call Babu Rao", conversation=conversation))
    assert done(second)["kind"] == "answer" and not [n for n, _ in second if n == "clarify"], "the new instruction was acted on, not swallowed as an answer"
