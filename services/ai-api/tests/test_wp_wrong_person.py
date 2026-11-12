"""Owner, 12 Nov 2026: a call that reaches someone the goal does not allow to hear its subject ends as category "wrong_person", not "not_interested"."""

# ruff: noqa: E501

from __future__ import annotations

import asyncio
import json
from typing import Any

from app.conversation.fakes import FakeLlm
from app.telephony import outcome as oc

GOAL = "Call the parents of Yashreddy about his marks; only a parent may hear them."
LINES = [
    {"who": "assistant", "text": "Hello, I am an AI assistant of Gowtham High School. May I speak with Yashreddy's parent?"},
    {"who": "caller", "text": "I am his uncle. Tell me the marks."},
    {"who": "assistant", "text": "I can only discuss this with the right person."},
    {"who": "caller", "text": "Okay, bye."},
]


def judged(reply: dict[str, Any]) -> oc.CallOutcome:
    base = oc.CallOutcome("completed", "goodbye", "unclear", None, transcript=list(LINES))
    return asyncio.run(oc.from_model(FakeLlm((json.dumps(reply),)), "m", base, "te", "2026-11-12", goal=GOAL))


def test_the_new_word_is_on_the_list_and_a_wrong_person_call_is_negative_and_not_done() -> None:
    assert "wrong_person" in oc.CATEGORIES and "wrong_number" in oc.CATEGORIES
    out = judged({"summary": "Not done: caller is an uncle, not a parent.", "outcome": "unclear", "category": "wrong_person", "goal_result": "not_done", "agreed": None})
    assert out.category == "wrong_person" and out.outcome == "negative" and out.captured["goal_result"] == "not_done"
    out = judged({"summary": "x", "outcome": "positive", "category": "wrong_person"})
    assert out.outcome == "negative", "a call that reached the wrong person is never positive"


def test_the_goal_prompt_tells_the_model_when_to_use_it() -> None:
    system, _ = oc.prompt(LINES, "te", "2026-11-12", goal=GOAL)
    assert '"wrong_person" when the call reached someone the goal does not allow to hear its subject' in system and 'never "not_interested" for that' in system
    assert "wrong_person" in oc.validate(json.dumps({"summary": "s", "outcome": "negative", "category": "wrong_person"}))["category"]  # type: ignore[index]
    assert "category" not in (oc.validate(json.dumps({"summary": "s", "category": "made_up"})) or {}), "a word that is not on the list is dropped"
