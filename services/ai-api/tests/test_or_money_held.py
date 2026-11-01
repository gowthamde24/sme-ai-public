"""Owner decision 1 Nov 2026: a question about the money held or pending, when nothing is held, is answered "No money is pending" (te: "బాకీ డబ్బు ఏమీ లేదు"), not with the general "nothing to show yet". The general line stays for questions with no specific answer."""

# ruff: noqa: E501
from __future__ import annotations

import uuid
from types import SimpleNamespace
from typing import Any

import pytest

from app.assistant.language import (
    NO_ANSWER,
    NO_MONEY_PENDING,
    NO_RECORD_HELP,
    PLAIN_WORDS,
    reply_matches,
)
from app.assistant.runner import AssistantRunner, Reply
from app.assistant.tools import State
from app.assistant.wording import is_money_held_question, reads_a_zero

MONEY_QUESTIONS = [
    "How much customer money is held?", "how much money is pending", "What money is outstanding?", "How much cash is held on closed orders", "How much money is held for customers?",
    "కస్టమర్ల డబ్బు ఎంత ఆపి ఉంది?", "ఎంత డబ్బు బాకీ ఉంది", "డబ్బు పెండింగ్ ఎంత ఉంది", "ग्राहकों का कितना पैसा रुका है?", "कितना पैसा बाकी है", "ಎಷ್ಟು ಹಣ ಬಾಕಿ ಇದೆ?", "dabbu enta baaki undi",
]
OTHER_QUESTIONS = ["Who hasn't paid?", "What needs me today?", "What is the price of the saree?", "How many new enquiries came today?", "Tell me a joke", "ఈరోజు కొత్త ఎంక్వైరీలు ఎన్ని వచ్చాయి?", "आज कितने ऑर्डर आए", "Send the quote to Ramesh", "How much does the saree cost?", "మా షాప్ ఎన్ని గంటలకు తెరుస్తారు?"]


@pytest.mark.parametrize("text", MONEY_QUESTIONS)
def test_these_are_questions_about_the_money_held(text: str) -> None:
    assert is_money_held_question(text), text


@pytest.mark.parametrize("text", OTHER_QUESTIONS)
def test_other_questions_are_not(text: str) -> None:
    assert not is_money_held_question(text), text


def test_the_specific_answers_are_in_every_language_the_owners_telugu_among_them_and_read_no_zero() -> None:
    assert NO_MONEY_PENDING["en"] == "No money is pending." and NO_MONEY_PENDING["te"] == "బాకీ డబ్బు ఏమీ లేదు."
    for language, line in NO_MONEY_PENDING.items():
        assert reply_matches(line, language) and not reads_a_zero(line) and line != NO_ANSWER[language] and line not in NO_RECORD_HELP[language], language


def runner(question: str, money_held_none: bool, help_on_empty: bool = True) -> AssistantRunner:
    state = State()
    state.money_held_none = money_held_none
    ctx = SimpleNamespace(run_id=uuid.uuid4(), state=state)
    r = AssistantRunner(db=None, llm=None, ctx=ctx, help_on_empty=help_on_empty)  # type: ignore[arg-type]
    r._question = question   # noqa: SLF001
    return r


def model_answer(language: str, text: str | None = None, kind: str = "answer") -> dict[str, Any]:
    return {"kind": kind, "answer": text or PLAIN_WORDS[language], "language": language, "sources": []}  # type: ignore[index]


@pytest.mark.parametrize("language", ["en", "te", "hi", "kn", "ta", "ml"])
def test_the_money_question_with_nothing_held_gets_the_specific_answer_whatever_the_model_wrote(language: str) -> None:
    for written in (None, "No customer money is held. Today's summary shows none held, and 3 open orders.", "₹0.00 is held"):
        out = runner("How much customer money is held?", True)._judge(model_answer(language, written), language, set(), 2, searched=True)  # type: ignore[arg-type]
        assert isinstance(out, Reply) and out.text == NO_MONEY_PENDING[language] and out.kind == "answer", (language, written)  # type: ignore[index]


def test_the_general_line_stays_for_questions_with_no_specific_answer() -> None:
    out = runner("How many new enquiries came today?", True)._judge(model_answer("en", "There are 3 of them, see Priya"), "en", set(), 2, searched=True)
    assert isinstance(out, Reply) and out.text == NO_RECORD_HELP["en"] and out.kind == "refusal"
    out = runner("What needs me today?", True)._judge(model_answer("en", "Nothing 3"), "en", set(), 2, searched=True)
    assert isinstance(out, Reply) and out.text == NO_RECORD_HELP["en"]


def test_when_money_is_held_the_money_question_is_not_overridden() -> None:
    out = runner("How much customer money is held?", False)._judge(model_answer("en", "Nothing to say"), "en", set(), 2, searched=True)
    assert isinstance(out, Reply) and out.text == "Nothing to say" and out.kind == "answer"


def test_a_money_question_whose_run_never_looked_at_todays_figures_is_left_alone() -> None:
    """(`money_held_none` is only set when the figures were read.)"""
    out = runner("How much customer money is held?", False)._judge(model_answer("en", "Nothing to say 3"), "en", set(), 2, searched=True)
    assert isinstance(out, Reply) and out.text == NO_RECORD_HELP["en"]
