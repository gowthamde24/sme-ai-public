"""The owner means THEMSELF (owner, 14 Nov 2026: "me / myself / my number / send Gowtham" must reach the owner's own phone from their profile, never ask for it)."""

# ruff: noqa: E501

from __future__ import annotations

import uuid
from typing import Any

import pytest

from app.tasks.planner import Myself, build_plan, is_self_word, person_question
from app.tasks.resolver import Person
from app.turns.intent import classify
from tests.test_dr_tasks import draft

OWN = "+919848012345"


def _p(n: int, name: str, phone: str, consent: str = "unknown") -> Person:
    return Person(uuid.UUID(int=n), uuid.UUID(int=1000 + n), name, phone, "new", "2026-11-14T00:00:00Z", consent, consent, False, False, False)


class Source:
    """Contacts of the workspace; `save_person` adds the saved one (as the database function does)."""

    def __init__(self, people: list[Person]) -> None:
        self.people = list(people)

    def by_segment(self, segment: str, days: int | None, limit: int) -> list[Person]:
        return self.people[:limit]

    def by_name(self, name: str, limit: int) -> list[Person]:
        from app.tasks import names

        return [p for p in self.people if names.matches(name, p.name or "")][:limit]

    def by_phone_tails(self, tails: list[str]) -> list[Person]:
        return [p for p in self.people if any((p.phone or "").endswith(t[-10:]) for t in tails)]


def saver(source: Source, calls: list[tuple[str, str]], result: str = "") -> Any:
    def save(name: str, phone: str) -> str:
        calls.append((name, phone))
        if result == "":
            source.people.append(_p(900, name, phone))
        return result

    return save


def plan(asked: str, source: Source, me: Myself | None, calls: list[tuple[str, str]] | None = None, *, channel: str = "whatsapp", language: str = "en", result: str = "") -> Any:
    return build_plan(draft(selectors=[{"name": asked}], channel=channel), source=source, language=language, provided=None, school=False, instruction="send me: test",
                      save_person=saver(source, calls if calls is not None else [], result), myself=lambda: me)


@pytest.mark.parametrize("asked", ["me", "myself", "my number", "My Number", "నాకు", "मुझे", "ನನಗೆ", "my whatsapp"])
def test_self_words_in_any_language(asked: str) -> None:
    assert is_self_word(asked)


@pytest.mark.parametrize("asked", ["Gowtham", "Kalyani", "my brother", "మీకు"])
def test_other_words_are_not_self_words(asked: str) -> None:
    assert not is_self_word(asked)


def test_me_is_the_number_in_the_profile_saved_once_and_never_asked_for() -> None:
    source, calls = Source([_p(1, "Anitha Hegde", "+919000000001")]), []
    planned = plan("me", source, Myself("Gowtham Reddy", OWN), calls)
    assert planned.question is None and [p.phone for p in planned.people] == [OWN]
    assert calls == [("Gowtham Reddy", OWN)], "saved as a contact like any named person"
    assert planned.plan["consent"]["owner_named"] is True and planned.plan["audience"]["count"] == 1
    assert plan("me", source, Myself("Gowtham Reddy", OWN), calls).people[0].phone == OWN and len(calls) == 1, "a second time finds the contact, saves nothing"


def test_the_owners_own_name_means_them_when_no_other_contact_has_it() -> None:
    planned = plan("Gowtham", Source([_p(1, "Anitha Hegde", "+919000000001")]), Myself("Gowtham Reddy", OWN))
    assert planned.question is None and planned.people[0].phone == OWN


def test_a_customer_who_shares_the_first_name_stays_a_customer() -> None:
    planned = plan("Gowtham", Source([_p(1, "Gowtham Naidu", "+919000000002")]), Myself("Gowtham Reddy", OWN))
    assert planned.question is None and planned.people[0].phone == "+919000000002"


def test_the_owners_own_contact_is_the_one_when_it_is_the_only_gowtham() -> None:
    planned = plan("Gowtham", Source([_p(1, "Gowtham R", OWN)]), Myself("Gowtham Reddy", OWN))
    assert [p.phone for p in planned.people] == [OWN]


def test_a_profile_without_a_number_gets_one_plain_sentence_not_a_question_for_the_number() -> None:
    for language in ("en", "te", "hi", "kn"):
        planned = plan("me", Source([]), Myself("Gowtham Reddy", None), language=language)
        assert planned.question == person_question(language, "no_own_phone", "me", "whatsapp") and planned.people == []
    assert "profile" in person_question("en", "no_own_phone", "me", "whatsapp").lower() and "?" not in person_question("en", "no_own_phone", "me", "whatsapp")


def test_a_workspace_that_takes_no_real_numbers_says_so() -> None:
    planned = plan("me", Source([]), Myself("Gowtham Reddy", OWN), result="gate")
    assert planned.question is not None and planned.people == []


def test_no_profile_read_means_the_usual_name_matching() -> None:
    source = Source([_p(1, "Kalyani Gowda", "+919000000003")])
    planned = build_plan(draft(selectors=[{"name": "Kalyani"}]), source=source, language="en", provided=None, school=False, instruction="send Kalyani: hi", myself=lambda: None)
    assert [p.name for p in planned.people] == ["Kalyani Gowda"]


@pytest.mark.parametrize("text", [
    "send me: test", "Send me a WhatsApp: test", "WhatsApp me: test", "message me: hello", "text myself: hi",
    "send to my number: test", "నాకు WhatsApp పంపు: test", "నాకు మెసేజ్ పంపు: test", "मुझे WhatsApp भेजो: test", "ನನಗೆ WhatsApp ಕಳುಹಿಸು: test",
])
def test_a_message_to_oneself_is_an_action(text: str) -> None:
    assert classify(text, None).kind == "action", text


@pytest.mark.parametrize("text", ["send me the price list", "send me a quote for 20 sarees", "what is my number of leads"])
def test_asking_the_business_to_send_something_is_not_a_message_to_oneself(text: str) -> None:
    assert classify(text, None).reason != "action_send_self", text


def test_the_owners_own_words_are_not_refused_for_their_language() -> None:
    from app.tasks.planner import check_draft

    d = draft(channel="whatsapp", message_text="test", selectors=[{"name": "me"}])
    assert "message_language" not in check_draft(d, instruction="నాకు WhatsApp పంపు: test", facts=[], language="te", school=False)
    assert "message_language" in check_draft(d, instruction="నాకు WhatsApp పంపు", facts=[], language="te", school=False), "words the owner did not type still have to be in their language"
