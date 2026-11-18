"""Lead Finder prospects are never called by the assistant (owner, 18 Nov 2026): "Call these 5 prospects" gets a plain answer, no plan card, no model call, nothing queued."""

# ruff: noqa: E501

from __future__ import annotations

import pytest

from app.turns.words import PROSPECT_NO_CALL, is_call_prospects
from tests.test_ea_turns import done, events, text_of, turn, world


@pytest.mark.parametrize("text", ["Call these 5 prospects", "call the prospects Lead Finder found", "Phone all prospects now", "ring my prospects", "ఈ prospects కి కాల్ చేయి"])
def test_a_request_to_call_prospects_is_recognised(text: str) -> None:
    assert is_call_prospects(text)


@pytest.mark.parametrize("text", ["Which prospects should I call?", "How many prospects did you find", "Show me the prospects", "call Ravi", "find new customers in Jayanagar", "who did you call today"])
def test_questions_and_other_requests_are_not(text: str) -> None:
    assert not is_call_prospects(text)


def test_the_answer_says_it_cannot_and_what_the_owner_can_do_and_makes_no_plan_card() -> None:
    client, llm, _, _ = world()   # a model with NO answers: a call would fail the test
    evs = events(turn(client, "Call these 5 prospects", language="en"))
    assert text_of(evs) == PROSPECT_NO_CALL["en"] and llm.requests == []
    assert done(evs)["kind"] == "answer", "an answer, never a plan card"
    assert not any(name in ("plan", "task", "confirm") for name, _ in evs), "nothing to approve"
    words = PROSPECT_NO_CALL["en"]
    assert "can't call prospects" in words and "from your phone" in words and "visit" in words and "normal lead" in words


def test_every_main_language_has_its_own_words() -> None:
    assert set(PROSPECT_NO_CALL) == {"en", "te", "hi", "kn", "ta", "ml", "mr"}
    assert len({PROSPECT_NO_CALL[lang] for lang in ("en", "te", "hi", "kn")}) == 4
