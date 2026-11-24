# ruff: noqa: E501
"""The recording notice (owner decision 28 Nov 2026, option B): an inbound call's opening says it may be recorded, once, right after the greeting; only reviewed languages speak their own text."""

from __future__ import annotations

import pytest

from app.telephony import persona
from app.telephony.call_opening import call_opening


def opening(lang: str, notice: bool) -> str:
    return call_opening(lang, business="Sri Sai Homes", assistant="Priya", training=None, say_ai=False, recording_notice=notice)


def test_the_notice_sits_between_the_greeting_and_the_question_and_is_said_once() -> None:
    said = opening("en", True)
    assert said == "Hello, this is Priya from Sri Sai Homes. This call may be recorded to improve the service. How can I help you?"
    assert persona.with_recording_notice("en", said) == said, "an opening that already holds it is unchanged"
    assert opening("en", False) == "Hello, this is Priya from Sri Sai Homes. How can I help you?", "off by default: no notice"


def test_a_language_without_a_reviewed_text_says_the_english_sentence_until_the_owner_approves() -> None:
    for lang in ("te", "hi", "kn"):
        assert persona.RECORDING_NOTICE[lang] and persona.RECORDING_NOTICE[lang] != persona.RECORDING_NOTICE["en"]
        assert persona.RECORDING_NOTICE["en"] in opening(lang, True) and persona.RECORDING_NOTICE[lang] not in opening(lang, True)
    assert persona.RECORDING_NOTICE_APPROVED == frozenset({"en"})


def test_an_approved_draft_is_spoken_in_its_own_language(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(persona, "RECORDING_NOTICE_APPROVED", frozenset({"en", "te"}))
    said = opening("te", True)
    assert persona.RECORDING_NOTICE["te"] in said and persona.RECORDING_NOTICE["en"] not in said
    assert said.index(persona.RECORDING_NOTICE["te"]) < said.index("చెప్పండి"), "before the question"


def test_a_call_we_place_never_gets_the_inbound_notice_line() -> None:
    """The notice is for the person who rang in; the outbound opening is composed elsewhere and is not touched (outbound is sandbox-fenced)."""
    assert "recorded" not in persona.opening_line("en", business="X", assistant=None, customer=None, inbound=False)
