"""Apologising after a mishearing (humanness audit item 4, 23 Nov 2026): the planner rule and a whole call with a recogniser that returns nothing after real speech."""

# ruff: noqa: E501
from __future__ import annotations

from app.browser_voice.session import VoiceSession
from app.conversation.parts import TurnTimings
from app.telephony import apology as ap
from app.telephony.call_session import CallVoiceSession
from tests.test_dv_browser_voice import arun


def test_a_short_sound_or_real_words_get_no_apology() -> None:
    a = ap.Apology()
    assert not a.should(500, None, 100.0) and not a.should(2000, "what time do you open", 100.0)
    assert a.should(900, "", 100.0) and a.should(900, "  ", 100.0) and a.should(900, None, 100.0)


def test_once_in_thirty_seconds_never_twice_in_a_row_and_at_most_three_a_call() -> None:
    a = ap.Apology()
    assert a.should(1000, None, 100.0)
    a.spoke(100.0)
    assert not a.should(1000, None, 140.0), "a real turn has not come in between: never twice in a row"
    a.heard()
    assert not a.should(1000, None, 120.0), "20 s later: too soon"
    assert a.should(1000, None, 131.0)
    a.spoke(131.0)
    a.heard()
    assert a.should(1000, None, 170.0)
    a.spoke(170.0)
    a.heard()
    assert not a.should(1000, None, 400.0), "three is the most in one call"


def test_every_call_language_has_two_different_lines_and_they_alternate() -> None:
    for lang in ("en", "te", "hi", "kn", "ta", "ml", "mr"):
        first, second = ap.lines_of(lang)
        assert first.strip() and second.strip() and first != second
        a = ap.Apology()
        assert a.line(lang) == first
        a.spoke(0.0)
        assert a.line(lang) == second
    assert ap.lines_of("xx") == ap.LINES["en"]


def test_the_disabled_planner_never_speaks() -> None:
    assert not ap.Apology(enabled=False).should(5000, None, 100.0)


class _Bus:
    def __init__(self) -> None:
        self.dropped = 0

    def drop_before(self, _t: float) -> None:
        self.dropped += 1


class _Stub:
    """Just what VoiceSession._maybe_apologise touches."""

    def __init__(self, planner: ap.Apology | None, language: str = "en") -> None:
        self.apology, self.language, self.bus, self.now = planner, language, _Bus(), 1000.0
        self.said: list[str] = []

    def clock(self) -> float:
        return self.now

    async def _say(self, text: str) -> None:
        self.said.append(text)


def _tm(start: float | None, end: float | None) -> TurnTimings:
    tm = TurnTimings()
    tm.speech_start_at, tm.eot_at = start, end
    return tm


@arun
async def test_a_long_sound_with_no_words_is_apologised_for_once_in_the_call_language() -> None:
    for lang in ("te", "hi", "en"):
        s = _Stub(ap.Apology(), lang)
        await VoiceSession._maybe_apologise(s, _tm(10.0, 11.5))  # type: ignore[arg-type]
        assert s.said == [ap.lines_of(lang)[0]] and s.bus.dropped == 1
        await VoiceSession._maybe_apologise(s, _tm(10.0, 11.5))  # type: ignore[arg-type]
        assert len(s.said) == 1, "not twice in a row"


@arun
async def test_no_apology_for_a_short_sound_missing_times_a_live_talk_session_or_a_disabled_planner() -> None:
    for planner, tm in ((ap.Apology(), _tm(10.0, 10.5)), (ap.Apology(), _tm(None, 11.0)), (ap.Apology(), _tm(10.0, None)), (None, _tm(10.0, 12.0)), (ap.Apology(enabled=False), _tm(10.0, 12.0))):
        s = _Stub(planner)
        await VoiceSession._maybe_apologise(s, tm)  # type: ignore[arg-type]
        assert s.said == []


def test_a_phone_session_has_a_planner_but_not_while_a_person_has_the_call_or_after_the_closing_line() -> None:
    s = object.__new__(CallVoiceSession)
    assert isinstance(s.apology, ap.Apology) and s.apology is s.apology
    s.closing = True
    assert s.apology is None
    assert VoiceSession.apology is None, "Live talk in the browser never apologises"
