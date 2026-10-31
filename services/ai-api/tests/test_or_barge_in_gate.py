"""Owner decision 31 Oct 2026: the language gate (barge-in only, only with the pill set, Tenglish never English) and the stop words (always interrupt)."""

# ruff: noqa: E501
from __future__ import annotations

import asyncio

import pytest

from app.browser_voice.limits import Limits
from app.browser_voice.session import Parts, VoiceSession
from app.conversation.fakes import silence, tone
from app.conversation.turntaking import (
    STOP_WORDS,
    classify_interruption,
    foreign_to_pin,
    looks_english,
    stop_word_heard,
)
from tests.test_dv_browser_voice import FakeSocket, arun, session_of, until
from tests.test_oq_live_standard import long_answer_parts

STOPS = ["stop", "Wait", "one minute", "hold on", "Hold on please", "aagu", "Aagandi", "oka nimisham", "ఆగు", "ఆగండి", "ఒక నిమిషం", "ನಿಲ್ಲಿಸಿ", "ruko", "रुको", "అక్కడ ఆగు", "stop, I meant five hundred"]
TENGLISH = ["Ramesh ki", "2000 square feet ki", "Lakshmi gaariki coat pampinchu", "Repu podduna call cheyyi", "Maatlu ippudu edaina", "ippudu edaina cheddam", "naaku quote kavali", "nenu repu call chesta"]
ENGLISH = ["Let's find out the dates", "Who should I call first today?", "I want to send a follow up to all leads from the last week", "what time is it", "the news is on"]


@pytest.mark.parametrize("text", STOPS)
def test_a_stop_word_always_interrupts_in_any_language_even_a_blip_even_gated(text: str) -> None:
    assert stop_word_heard(text)
    assert classify_interruption(0, text) == "barge_in" and classify_interruption(40, text, foreign=True) == "barge_in", text


def test_the_default_stop_list_has_the_owners_words() -> None:
    for word in ("stop", "wait", "one minute", "hold on", "aagu", "ఆగు", "aagandi", "ఆగండి", "oka nimisham", "ನಿಲ್ಲಿಸಿ", "ruko", "रुको"):
        assert word in STOP_WORDS, word


def test_ordinary_words_are_not_stop_words() -> None:
    for text in ("bus stopped", "waiting room", "ఆగస్టు", "price of the saree", "", None):
        assert not stop_word_heard(text), text


@pytest.mark.parametrize("text", TENGLISH)
def test_tenglish_in_latin_letters_counts_as_telugu_never_as_foreign(text: str) -> None:
    assert not looks_english(text) and not foreign_to_pin(text, "te") and classify_interruption(900, text, foreign=foreign_to_pin(text, "te")) == "barge_in", text


@pytest.mark.parametrize("text", ENGLISH)
def test_clear_english_is_foreign_to_a_telugu_pill_and_not_to_an_english_one(text: str) -> None:
    assert looks_english(text) and foreign_to_pin(text, "te") and foreign_to_pin(text, "hi") and not foreign_to_pin(text, "en")
    assert classify_interruption(1500, text, foreign=True) == "noise"


def test_an_indian_script_is_foreign_to_an_english_pill_and_to_another_indian_pill() -> None:
    assert foreign_to_pin("ఇప్పుడు ఏదైనా చేద్దాం", "en") and not foreign_to_pin("ఇప్పుడు ఏదైనా చేద్దాం", "te")
    assert foreign_to_pin("अभी कुछ करते हैं", "te") and not foreign_to_pin("अभी कुछ करते हैं", "hi")
    assert not foreign_to_pin("Ramesh ki", "en"), "Latin letters are not an Indian script"


def test_with_auto_or_no_pill_the_gate_never_applies() -> None:
    for pin in (None, "", "auto", "xx"):
        assert not foreign_to_pin("Let's find out the dates", pin), pin


def test_single_words_and_short_fragments_are_not_called_english() -> None:
    for text in ("Cubic", "music", "Peddam", "hello", "ok"):
        assert not looks_english(text), text


# ---- the session --------------------------------------------------------------------------------------------------------------------------------


RUNNING: list[asyncio.Future[str]] = []


def pinned_parts(later: str) -> Parts:
    """The language pill set to Telugu."""
    parts: Parts = long_answer_parts(later=later)
    parts.pinned_language = lambda: "te"
    return parts


async def interrupt_with(sock: FakeSocket, session: VoiceSession, speech_ms: int) -> None:
    RUNNING.append(asyncio.ensure_future(session.run()))   # (kept: a task nobody refers to can be collected)
    sock.feed_speech()
    await until(lambda: len(sock.audio) >= 2)
    sock.inbox.put_nowait(("text", {"type": "barge_in", "verify": True}))
    await until(lambda: "paused" in sock.types())
    for _ in range(speech_ms // 20):
        sock.inbox.put_nowait(("bytes", tone(20)))
    for _ in range(40):
        sock.inbox.put_nowait(("bytes", silence(20)))


@arun
async def test_english_television_while_the_telugu_pill_is_set_does_not_stop_the_reply() -> None:
    sock = FakeSocket()
    session = session_of(sock, pinned_parts("Let's find out the dates"), Limits(greeting=False, language_gate=True))
    await interrupt_with(sock, session, 900)
    await until(lambda: "resumed" in sock.types(), seconds=8)
    assert "interrupted" not in sock.types()
    sock.inbox.put_nowait(("close", None))


@arun
async def test_the_same_words_stop_the_reply_when_the_gate_is_off() -> None:
    sock = FakeSocket()
    session = session_of(sock, pinned_parts("Let's find out the dates"), Limits(greeting=False, language_gate=False))
    await interrupt_with(sock, session, 900)
    await until(lambda: "interrupted" in sock.types(), seconds=8)
    sock.inbox.put_nowait(("close", None))


@arun
async def test_stop_in_english_during_telugu_speech_stops_the_reply_even_gated_even_short() -> None:
    sock = FakeSocket()
    session = session_of(sock, pinned_parts("stop"), Limits(greeting=False, language_gate=True))
    await interrupt_with(sock, session, 200)
    await until(lambda: "interrupted" in sock.types(), seconds=8)
    sock.inbox.put_nowait(("close", None))


@arun
async def test_tenglish_in_latin_letters_stops_the_reply_with_the_gate_on() -> None:
    sock = FakeSocket()
    session = session_of(sock, pinned_parts("Ramesh ki repu call cheyyi"), Limits(greeting=False, language_gate=True))
    await interrupt_with(sock, session, 900)
    await until(lambda: "interrupted" in sock.types(), seconds=8)
    sock.inbox.put_nowait(("close", None))


def test_the_english_stop_words_are_found_as_a_telugu_pinned_recogniser_writes_them() -> None:
    """Measured 31 Oct 2026 with Sarvam pinned to te-IN: the English words come back in Telugu script."""
    for heard in ("స్టాప్.", "స్టాప్ స్టాప్", "వెయిట్.", "వెయిట్ వన్ మినిట్.", "హోల్డన్", "వన్ సెకండ్.", "Holden", "स्टॉप", "ಸ್ಟಾಪ್"):
        assert stop_word_heard(heard) and classify_interruption(0, heard) == "barge_in", heard
