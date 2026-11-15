"""15 Nov eval fixes: the words that open the work router, and a message whose OWN words look like a question is still an instruction."""

# ruff: noqa: E501

from __future__ import annotations

import pytest

from app.assistant_work.router import touches
from app.turns.intent import classify


@pytest.mark.parametrize("text", [
    "నా IndiaMART కనెక్ట్ చేయి",
    "నా వెబ్‌సైట్ ఫారమ్ టెస్ట్ చేయి",
    "నా Google Sheet డిస్కనెక్ట్ చేయి",
    "Show Kalyani's chat",
    "Open Anitha Hegde's conversation",
])
def test_source_and_chat_words_reach_the_work_router(text: str) -> None:
    assert touches(text)


@pytest.mark.parametrize("text", ["show me my leads", "How many chat messages came today?", "What is my balance"])
def test_plain_questions_do_not_open_the_router(text: str) -> None:
    assert not touches(text)


@pytest.mark.parametrize("text", [
    "అనిత హెగ్డేకి మెసేజ్ పంపు: ఎలా ఉన్నారు?",
    "Message Anitha Hegde: how are you?",
])
def test_a_message_with_how_are_you_in_its_words_is_still_an_instruction(text: str) -> None:
    assert classify(text).kind == "action"


def test_a_real_question_with_a_colon_stays_a_question() -> None:
    assert classify("ఎవరికి పంపాలి: Anitha లేదా Ravi?").kind != "action"
