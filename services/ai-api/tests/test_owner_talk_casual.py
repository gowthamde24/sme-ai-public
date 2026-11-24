# ruff: noqa: E501
"""28 Nov 2026, the owner asking the assistant "ఏం చేస్తున్నావ్?" (what are you doing?) got the fixed "nothing to show" sentence: the colloquial wording was not recognised as chat, so the turn took the records path and ended in the no-record template. Casual and meta turns are chat; records questions stay records."""

from __future__ import annotations

import pytest

from app.assistant.language import NO_ANSWER, NO_RECORD_HELP
from app.browser_voice.routes import OWNER_GREETING
from app.turns.intent import classify


@pytest.mark.parametrize(
    ("text", "kind"),
    [
        ("ఏం చేస్తున్నావ్?", "smalltalk"), ("ఏంటి చేస్తున్నావ్ ఇప్పుడు", "smalltalk"), ("ఎలా ఉన్నావ్", "smalltalk"), ("థాంక్యూ", "smalltalk"), ("హాయ్ ఎలా ఉన్నావ్", "smalltalk"),
        ("ఏం చేయగలవ్?", "general"), ("నువ్వు ఎవరు?", "general"), ("what are you doing?", "general"), ("what can you do for me", "general"),
        ("ఈరోజు ఎన్ని leads వచ్చాయి?", "business"), ("రమేష్ ఎక్కడ?", "business"),
    ],
)
def test_casual_and_meta_turns_are_chat_and_records_questions_stay_records(text: str, kind: str) -> None:
    assert classify(text).kind == kind, text


def test_the_telugu_greeting_is_the_owners_own_phrase_and_the_fixed_sentences_are_spoken_words() -> None:
    assert OWNER_GREETING["te"] == "చెప్పండి, నేను మీకు ఎలా help చేయగలను?"
    for text in (NO_ANSWER["te"], NO_RECORD_HELP["te"]):
        assert not any(w in text for w in ("చూపించడానికి", "డ్రాఫ్ట్ చేయమని అడగండి", "తెలియజేయండి", "దయచేసి")), text
    assert "Customer" in NO_RECORD_HELP["te"] and "Follow-up draft" in NO_RECORD_HELP["te"], "everyday English business words stay English"
