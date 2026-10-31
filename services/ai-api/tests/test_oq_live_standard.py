"""The Live talk standard (owner, 31 Oct 2026, job live-conversation-standard): turn-taking, interruptions, the spoken-text honesty, the session's workflow, and the 40-dialogue eval run through the real loop with fakes.
The quality-bar table with the numbers is scripts/live_standard_eval.py; here each rule has a test and the eval's guarantees are pinned."""

# ruff: noqa: E501

from __future__ import annotations

import asyncio
import json
from collections.abc import AsyncIterator
from typing import Any

import pytest

from app.browser_voice.limits import Limits
from app.conversation import live_eval as ev
from app.conversation import turntaking as tt
from app.conversation.fakes import (
    FakeLlm,
    FakePlayout,
    FakeStt,
    FakeTts,
    ScriptedStt,
    Segment,
    silence,
    tone,
)
from app.conversation.parts import Session, TurnTimings
from app.conversation.pipeline import Conversation
from tests.test_dv_browser_voice import FakeSocket, arun, fake_parts, session_of, until

# ---- A1: is it a complete thought? ----------------------------------------------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("text", "language", "expected"),
    [
        ("I need 2000 sq ft of pavers.", "en", "complete"), ("What is the price of the blue saree?", "en", "complete"), ("hello", "en", "complete"), ("Ok", "en", "complete"),
        ("I want to know about", "en", "incomplete"), ("I need paver blocks and", "en", "incomplete"), ("so", "en", "incomplete"), ("hmm", "en", "incomplete"), ("I need 2000 sq ft ...", "en", "incomplete"), ("2000", "en", "unsure"), ("2000 sq ft", "en", "unsure"),
        ("నాకు 2000 sq ft కి", "te", "incomplete"), ("ధర గురించి", "te", "incomplete"), ("మా షాప్ లో", "te", "incomplete"), ("అంటే", "te", "incomplete"), ("నాకు పేవర్ బ్లాక్స్ కావాలి", "te", "complete"), ("ధర ఎంత?", "te", "complete"), ("అలాగే", "te", "complete"),
        ("naaku 2000 sq ft ki", "te", "incomplete"), ("naaku pavers kavali", "te", "complete"),
        ("मुझे टाइल्स चाहिए और", "hi", "incomplete"), ("मुझे टाइल्स चाहिए।", "hi", "complete"), ("मतलब", "hi", "incomplete"), ("मेरी दुकान में", "hi", "incomplete"),
        ("ನನಗೆ ಸೀರೆ ಬೇಕು ಮತ್ತು", "kn", "incomplete"), ("ನನಗೆ ಸೀರೆ ಬೇಕು", "kn", "complete"), ("ಅಂದ್ರೆ", "kn", "incomplete"),
        ("எனக்கு புடவை வேணும் மற்றும்", "ta", "incomplete"), ("எனக்கு புடவை வேணும்", "ta", "complete"), ("എനിക്ക് സാരി വേണം പക്ഷേ", "ml", "incomplete"), ("എനിക്ക് സാരി വേണം", "ml", "complete"),
        ("", "en", "incomplete"),
    ],
)
def test_a_thought_is_complete_unfinished_or_unsure(text: str, language: str, expected: str) -> None:
    assert tt.completeness(text, language) == expected


def test_the_wait_is_nothing_for_a_complete_thought_a_little_for_an_unsure_one_and_long_for_an_unfinished_one() -> None:
    assert tt.hold_ms("complete") == 0 and tt.hold_ms("unsure") == 900 and 2500 <= tt.hold_ms("incomplete") <= 3200


# ---- A2: the speaker's own pause -------------------------------------------------------------------------------------------------------------------


def test_someone_who_pauses_long_is_given_longer_before_their_turn_is_taken() -> None:
    pm = tt.PauseModel()
    assert pm.silence_ms(350) == 350, "nothing learned yet: the language's own value"
    for gap in (900, 1100, 1000):
        pm.observe_gap(gap)
    assert 700 <= pm.silence_ms(350) <= 900
    pm.observe_gap(40)
    pm.observe_gap(60000)
    assert len(pm.gaps_ms) == 3, "a click and a coffee break are not pauses"
    assert tt.PauseModel(gaps_ms=[5000, 5000]).silence_ms(350) == 900, "never more than 900 ms of quiet"
    assert tt.hold_ms("incomplete", tt.PauseModel(gaps_ms=[2200, 2300])) > tt.hold_ms("incomplete")


# ---- B: interruptions -------------------------------------------------------------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("speech_ms", "text", "expected"),
    [
        (180, None, "noise"), (90, None, "noise"), (900, None, "barge_in"), (250, "hmm", "backchannel"), (300, "ok", "backchannel"), (400, "అవును", "backchannel"), (300, "haan", "backchannel"), (350, "हाँ", "backchannel"), (300, "ಹೌದು", "backchannel"),
        (250, "ok sure", "backchannel"), (200, "wait a second", "barge_in"), (500, "stop please", "barge_in"), (700, "ఒక్క నిమిషం ధర చెప్పండి", "barge_in"), (150, "actually no", "barge_in"),
    ],
)
def test_a_cough_a_hmm_and_a_tv_do_not_take_the_turn_but_words_do(speech_ms: int, text: str | None, expected: str) -> None:
    assert tt.classify_interruption(speech_ms, text) == expected


def test_a_false_interruption_is_picked_up_again_only_after_a_moment_of_quiet() -> None:
    assert not tt.should_resume("barge_in", 5000) and not tt.should_resume("noise", 500) and tt.should_resume("noise", tt.RESUME_AFTER_MS) and tt.should_resume("backchannel", 2500)


def test_what_is_stored_is_what_was_heard() -> None:
    clauses = [("Sure, I can help with that.", 1.5), ("The price is two thousand six hundred rupees.", 2.0), ("Shall I send photos?", 1.0)]
    assert tt.spoken_prefix(clauses, 99) == " ".join(c[0] for c in clauses)
    assert tt.spoken_prefix(clauses, 1.5) == "Sure, I can help with that."
    assert tt.spoken_prefix(clauses, 2.5) == "Sure, I can help with that. The price is two…"
    assert tt.spoken_prefix(clauses, 0.0) == ""


# ---- D --------------------------------------------------------------------------------------------------------------------------------------------------


def test_the_check_in_comes_once_after_eight_seconds_and_the_end_after_thirty() -> None:
    assert [tt.silence_action(q, False) for q in (1, 7.9, 8, 20)] == ["wait", "wait", "check_in", "check_in"]
    assert [tt.silence_action(q, True) for q in (8, 29.9, 30, 60)] == ["wait", "wait", "end", "end"]
    assert all(len(v) > 3 for table in (tt.CHECK_IN, tt.GOODBYE_QUIET, tt.GOODBYE_REPLY, tt.SOFT_WARNING) for v in table.values()) and set(tt.CHECK_IN) == {"en", "te", "hi", "kn", "ta", "ml"}


@pytest.mark.parametrize("text", ["bye", "thank you, that's all", "Thanks, that is all", "ఇంక చాలు అండీ", "బై అండీ", "बस इतना ही", "ठीक है, बाय", "ಸಾಕು ಧನ್ಯವಾದ", "போதும்", "മതി"])
def test_goodbyes_in_every_language_end_the_session(text: str) -> None:
    assert tt.is_goodbye(text)


@pytest.mark.parametrize("text", ["thank you for the price", "what is the baby saree price", "ధర ఎంత", "tell me the total please", "थोड़ा और बताइए", ""])
def test_ordinary_sentences_do_not_end_the_session(text: str) -> None:
    assert not tt.is_goodbye(text)


def test_the_cap_warns_two_minutes_before_the_end_once() -> None:
    assert not tt.soft_warning_due(700, 900, False) and tt.soft_warning_due(780, 900, False) and not tt.soft_warning_due(800, 900, True) and not tt.soft_warning_due(10, 100, False)


# ---- the loop: hold, pause, resume, truth ---------------------------------------------------------------------------------------------------------


def conv_with(stt: Any, language: str = "en", **kw: Any) -> tuple[Conversation, FakePlayout]:
    playout = FakePlayout(rate=16000)
    conv = Conversation(stt=stt, llm=kw.pop("llm", FakeLlm(("One. ", "Two. ", "Three."))), tts=kw.pop("tts", FakeTts()), playout=playout, session=Session(system="", language=language), models={"fast": "f", "strong": "s"}, **kw)
    return conv, playout


class Src:
    speech_ended_at: float | None = None

    async def frames(self) -> AsyncIterator[bytes]:
        if False:
            yield b""


@arun
async def test_an_unfinished_thought_is_joined_to_the_rest_and_a_finished_one_is_not_held() -> None:
    stt = ScriptedStt([Segment("I want to know about", 800, 1500), Segment("the blue saree", 900, 600)], scale=0.05)
    conv, _ = conv_with(stt, semantic_turns=True)
    assert await asyncio.wait_for(conv.listen(Src(), TurnTimings()), 10) == "I want to know about the blue saree"
    stt2 = ScriptedStt([Segment("What is the price?", 800, 3000), Segment("Also the red one", 900, 600)], scale=0.05)
    conv2, _ = conv_with(stt2, semantic_turns=True)
    tm = TurnTimings()
    assert await asyncio.wait_for(conv2.listen(Src(), tm), 10) == "What is the price?" and tm.held_ms == 0


@arun
async def test_with_semantic_turns_off_the_first_final_ends_the_turn_as_before() -> None:
    stt = ScriptedStt([Segment("I want to know about", 800, 1500), Segment("the blue saree", 900, 600)], scale=0.05)
    conv, _ = conv_with(stt, semantic_turns=False)
    assert await asyncio.wait_for(conv.listen(Src(), TurnTimings()), 10) == "I want to know about"


@arun
async def test_a_speaker_who_never_finishes_is_still_answered() -> None:
    stt = ScriptedStt([Segment("and", 300, 800)] * 6, scale=0.05)
    conv, _ = conv_with(stt, semantic_turns=True)
    text = await asyncio.wait_for(conv.listen(Src(), TurnTimings()), 20)
    assert text == "and and and and", f"at most {tt.MAX_HOLD_PARTS} pieces are joined"


@arun
async def test_the_speakers_own_pause_is_learned_and_given_to_the_recogniser() -> None:
    stt = ScriptedStt([Segment("I want to know about", 100, 1200), Segment("two thousand sq ft of pavers", 100, 600)], scale=1.0)
    conv, _ = conv_with(stt, semantic_turns=True)
    await asyncio.wait_for(conv.listen(Src(), TurnTimings()), 10)
    assert conv.pauses.gaps_ms and 600 <= conv.pauses.gaps_ms[0] <= 2200 and stt.set_silence_calls


@arun
async def test_a_paused_reply_goes_on_where_it_stopped_with_the_cut_off_audio_said_again() -> None:
    tts = FakeTts(chunks=10, chunk_ms=100, chunk_gap=0.02)
    conv, playout = conv_with(ScriptedStt([]), tts=tts, llm=FakeLlm(("Sure, I can help. ", "The price is two thousand. "), gap=0.02))
    task = asyncio.ensure_future(conv.respond("hello"))
    for _ in range(400):
        if len(playout.writes) >= 4:
            break
        await asyncio.sleep(0.005)
    written_before = playout.bytes_written
    ms = await conv.pause()
    assert ms is not None and ms < 200 and conv.is_paused and playout.stopped_at
    await asyncio.sleep(0.15)
    assert playout.bytes_written == written_before, "nothing new reaches the line while paused"
    assert await conv.resume()
    tm = await asyncio.wait_for(task, 10)
    assert not tm.interrupted and tm.spoken_text == tm.reply_text and tm.paused == 1
    assert playout.bytes_written >= 20 * 3200 - 1, "all the audio of the reply was delivered, the cut-off part twice"


@arun
async def test_a_real_interruption_stores_only_what_the_caller_heard() -> None:
    tts = FakeTts(chunks=10, chunk_ms=100, chunk_gap=0.02)
    conv, playout = conv_with(ScriptedStt([]), tts=tts, llm=FakeLlm(("Sure, I can help with that. ", "The price is two thousand six hundred rupees. ", "Shall I send the photos?"), gap=0.02))
    task = asyncio.ensure_future(conv.respond("what is the price"))
    for _ in range(400):
        if len(playout.writes) >= 14:
            break
        await asyncio.sleep(0.005)
    await conv.interrupt()
    tm = await asyncio.wait_for(task, 10)
    assert tm.interrupted and tm.spoken_text and len(tm.spoken_text) < len(tm.reply_text)
    history = conv.session.history
    assert history[0] == {"role": "user", "content": "what is the price"} and history[-1]["content"] == tm.spoken_text != tm.reply_text


@arun
async def test_an_interruption_before_anything_was_heard_leaves_no_assistant_turn_in_the_history() -> None:
    conv, _ = conv_with(ScriptedStt([]), tts=FakeTts(first_audio_delay=0.3), llm=FakeLlm(("Hello there. ",)))
    task = asyncio.ensure_future(conv.respond("hi"))
    await asyncio.sleep(0.05)
    await conv.interrupt()
    await asyncio.wait_for(task, 10)
    assert conv.session.history == [{"role": "user", "content": "hi"}]


# ---- the session ----------------------------------------------------------------------------------------------------------------------------------------


class ThenStt:
    """The first listening hears `first`; every later one hears `later` (an empty final: a cough has no words)."""

    sample_rate = 16000

    def __init__(self, first: str, later: str) -> None:
        self.first, self.later, self.calls = first, later, 0

    def events(self, frames: Any) -> Any:
        self.calls += 1
        return FakeStt(self.first if self.calls == 1 else self.later, silence_ms=300).events(frames)


def long_answer_parts(first: str = "what time do you open?", later: str | None = None) -> Any:
    parts = fake_parts(llm=FakeLlm(("A long answer, ", "that keeps going, ", "and going. "), gap=0.2), tts=FakeTts(chunks=30, chunk_ms=100, chunk_gap=0.05))
    stt = ThenStt(first, first if later is None else later)
    parts.stt_for = lambda language: stt
    return parts


@arun
async def test_a_cough_while_the_assistant_speaks_pauses_it_and_it_goes_on() -> None:
    sock = FakeSocket()
    session = session_of(sock, long_answer_parts(later=""))
    run = asyncio.ensure_future(session.run())
    sock.feed_speech()
    await until(lambda: len(sock.audio) >= 2)
    sock.inbox.put_nowait(("text", {"type": "barge_in", "verify": True}))
    await until(lambda: "paused" in sock.types())
    for _ in range(9):
        sock.inbox.put_nowait(("bytes", tone(20)))   # a short cough
    for _ in range(40):
        sock.inbox.put_nowait(("bytes", silence(20)))
    await until(lambda: "resumed" in sock.types(), seconds=8)
    assert "interrupted" not in sock.types() and next(m for m in sock.json if m["type"] == "paused")["ms"] < 200
    await until(lambda: "timings" in sock.types(), seconds=15)
    assert next(m for m in sock.json if m["type"] == "timings")["interrupted"] is False
    sock.inbox.put_nowait(("close", None))
    await run


@arun
async def test_real_words_while_the_assistant_speaks_end_the_reply_and_become_the_next_turn() -> None:
    sock = FakeSocket()
    session = session_of(sock, long_answer_parts(later="wait I meant five hundred"))
    run = asyncio.ensure_future(session.run())
    sock.feed_speech()
    await until(lambda: len(sock.audio) >= 2)
    sock.inbox.put_nowait(("text", {"type": "barge_in", "verify": True}))
    await until(lambda: "paused" in sock.types())
    sock.feed_speech(speech_ms=900, quiet_ms=500)
    await until(lambda: "interrupted" in sock.types(), seconds=8)
    interrupted = next(m for m in sock.json if m["type"] == "interrupted")
    assert "spoken" in interrupted
    await until(lambda: sum(1 for m in sock.json if m["type"] == "caption" and m["who"] == "user" and m["text"] == "wait I meant five hundred") >= 1, seconds=8)
    sock.inbox.put_nowait(("close", None))
    await run
    assert session.usage.interrupts == 1


@arun
async def test_a_barge_in_without_verify_still_stops_for_good_at_once() -> None:
    sock = FakeSocket()
    session = session_of(sock, long_answer_parts())
    run = asyncio.ensure_future(session.run())
    sock.feed_speech()
    await until(lambda: len(sock.audio) >= 2)
    sock.inbox.put_nowait(("text", {"type": "barge_in"}))
    await until(lambda: "interrupted" in sock.types())
    assert "paused" not in sock.types()
    sock.inbox.put_nowait(("close", None))
    await run


@arun
async def test_saying_goodbye_ends_the_session_with_a_short_goodbye() -> None:
    sock = FakeSocket()
    parts = fake_parts()
    parts.stt_for = lambda language: FakeStt("thank you, that's all", silence_ms=300)
    session = session_of(sock, parts)
    run = asyncio.ensure_future(session.run())
    sock.feed_speech()
    assert await asyncio.wait_for(run, 10) == "goodbye"
    assert {"type": "limit", "reason": "goodbye", "fatal": True} in sock.json and any(m["type"] == "caption" and m["who"] == "assistant" and "Bye" in m["text"] for m in sock.json)


@arun
async def test_the_session_cap_warns_two_minutes_before_the_end() -> None:
    sock = FakeSocket()
    session = session_of(sock, fake_parts(), limits=Limits(session_seconds=125, greeting=False))
    now = [0.0]
    session.clock = lambda: now[0]
    session._started = 0.0  # noqa: SLF001
    run = asyncio.ensure_future(session.run())
    await asyncio.sleep(0.1)
    now[0] = 6.0
    await until(lambda: "notice" in sock.types(), seconds=5)
    note = next(m for m in sock.json if m["type"] == "notice")
    assert note["code"] == "session_ending" and 100 <= note["seconds_left"] <= 125
    sock.inbox.put_nowait(("close", None))
    await run


@arun
async def test_a_quiet_line_gets_one_check_in_and_then_the_end() -> None:
    mp = pytest.MonkeyPatch()
    mp.setattr(tt, "CHECK_IN_AFTER_S", 0.3)
    mp.setattr(tt, "END_AFTER_S", 1.2)
    sock = FakeSocket()
    session = session_of(sock, fake_parts(), limits=Limits(greeting=False))
    session.idle_s = 16   # (the real values are 8 and 30 s; the session checks in only when its idle limit allows it)
    run = asyncio.ensure_future(session.run())
    assert await asyncio.wait_for(run, 12) == "idle"
    said = [m["text"] for m in sock.json if m["type"] == "caption" and m["who"] == "assistant"]
    assert said[0] == tt.CHECK_IN["en"] and said[-1] == tt.GOODBYE_QUIET["en"] and said.count(tt.CHECK_IN["en"]) == 1
    assert {"type": "limit", "reason": "idle", "fatal": True} in sock.json
    mp.undo()


# ---- the eval -------------------------------------------------------------------------------------------------------------------------------------


def test_the_forty_dialogues_are_forty_in_the_right_languages_and_cover_every_rule() -> None:
    dialogues = ev.load()
    assert len(dialogues) == 40 and len({d["id"] for d in dialogues}) == 40
    by_lang = {lang: sum(1 for d in dialogues if d["lang"] == lang) for lang in ("te", "en", "kn", "hi")}
    assert by_lang == {"te": 15, "en": 10, "kn": 8, "hi": 7}
    rules = {r for d in dialogues for r in d["rules"]}
    assert {"A1", "A2", "A3", "B1", "B2", "B3", "B4", "C1", "C2", "C4", "C6", "C7", "C8", "C9", "C10", "D3", "D4"} <= rules, sorted(rules)


@arun
async def test_the_dialogues_meet_what_the_loop_guarantees() -> None:
    result = await ev.run_all()
    s = ev.summary(result)
    assert s["premature_cut_off_without_hard_pct"] == 0.0, "every pause that has a cue (a connective, a postposition, a filler) is waited out"
    assert s["over_hold_pct"] == 0.0, "a finished turn is never made to wait"
    assert s["real_interruptions_stopped_pct"] == 100.0 and s["false_interruption_without_tv_pct"] == 0.0 and s["mechanics_failures"] == 0
    assert s["pause_ms_max"] <= 200 and s["silence_ok"] == "3/3" and s["goodbye_ok"] == "7/7"
    assert s["premature_cut_off_pct"] <= 20.0, "the cue-less pauses are the known limit of a text classifier (the audio turn model is the next step)"


def test_the_style_checks_catch_what_they_should() -> None:
    p = ev.style_problems
    assert p("Sure. Sales are two lakh rupees this month.", ["short", "no_markup", "no_gender"], "en") == []
    assert "markup" in " ".join(p("**Sales** are 2 lakh", ["no_markup"], "en")) and p("See https://x.test", ["no_markup"], "en") and p("Great 😀", ["no_markup"], "en")
    assert p("Yes sir, one moment.", ["no_gender"], "en") and p("Sure. One. Two. Three. Four.", ["short"], "en")
    assert p("Sales are good", ["mirror_script"], "te") and not p("అమ్మకాలు బాగున్నాయి అండీ", ["mirror_script"], "te")
    assert p("Done.", ["readback_or_confirm"], "en", ["Ravi"]) and not p("Send 5000 rupees to Ravi, shall I?", ["readback_or_confirm"], "en", ["Ravi", "5000"])
    assert p("The supplier is Mehta Silks.", ["no_invent"], "en") and not p("I don't have a supplier name in the records.", ["no_invent"], "en")


def test_the_voice_prompt_carries_the_standard_s_speaking_rules() -> None:
    from app.conversation.style import conversation_style_block

    block = conversation_style_block("en", disclosure_on=False)
    for needle in ("Want the details?", "No markdown", "wait for their yes", "Ask ONCE", "Never invent", "shorter and warmer", "Never open two turns the same way"):
        assert needle in block, needle


def test_the_eval_file_is_valid_json_lines() -> None:
    for line in open(ev.DIALOGUES, encoding="utf-8"):
        assert json.loads(line)["beats"]
