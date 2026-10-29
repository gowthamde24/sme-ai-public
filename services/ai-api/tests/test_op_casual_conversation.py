"""Casual conversation (owner, 30 Oct 2026): greetings, how are you, tiredness, jokes and general-knowledge questions ("tell me about Dharmavaram silk") in Telugu, Tenglish and English are small talk or general help: warm, short, answered
by the model, never the records path ("I looked, there is nothing to show") and never steered back to leads. The 10 cases are data (tests/evals/casual/cases.jsonl, also run live on staging by the owner's check); here the ROUTER is
pinned for each, and the chat prompt is pinned to say it. Real questions about the records and instructions stay what they were."""

# ruff: noqa: E501

from __future__ import annotations

import json
from pathlib import Path

import pytest

from app.assistant import prompts
from app.turns.intent import classify

CASES = [json.loads(line) for line in (Path(__file__).resolve().parents[3] / "tests" / "evals" / "casual" / "cases.jsonl").read_text(encoding="utf-8").splitlines() if line.strip()]


def test_there_are_ten_casual_cases_in_telugu_tenglish_and_english() -> None:
    assert len(CASES) == 10 and len({c["id"] for c in CASES}) == 10
    assert {c["language"] for c in CASES} == {"te", "en"}
    assert any(c["text"].isascii() and c["language"] == "te" for c in CASES), "romanised Telugu (Tenglish) is covered"


@pytest.mark.parametrize("case", CASES, ids=[c["id"] for c in CASES])
def test_each_casual_message_is_small_talk_or_general_help_never_the_records_path(case: dict[str, object]) -> None:
    got = classify(str(case["text"]))
    assert got.kind == case["kind"], (case["text"], got)


@pytest.mark.parametrize(
    "text,kind",
    [
        ("ఈ రోజు ఎన్ని లీడ్స్ వచ్చాయి?", "business"),
        ("ధర ఎంత?", "business"),
        ("ఎంత మంది కస్టమర్లు బకాయి?", "business"),
        ("Today kotha leads em vachayi?", "business"),
        ("రవికి కాల్ చేయండి", "action"),
        ("Ravi ki call cheyyi", "action"),
        ("Call Ramesh and remind him about the payment", "action"),
    ],
)
def test_real_questions_about_the_records_and_instructions_stay_what_they_were(text: str, kind: str) -> None:
    assert classify(text).kind == kind


def test_a_place_that_holds_a_price_word_is_not_a_price_question() -> None:
    assert classify("ధర్మవరం ఎక్కడ ఉంది?").kind == "general"
    assert classify("ధర్మవరం చీరల ధర ఎంత?").kind == "business", "a real price question about them still goes to the records"


def test_the_chat_prompt_welcomes_casual_talk_and_does_not_steer_back_to_work() -> None:
    text = prompts.CHAT_SYSTEM_PROMPT
    assert "never refuse it" in text and "Do not steer back to leads" in text and "general-knowledge" in text
    assert "no mention of the business" in prompts.CHAT_SMALLTALK_CLAUSE
