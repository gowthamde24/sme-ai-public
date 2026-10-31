"""The owner's real recordings, as text and timings (tests/evals/recordings): do the turn-taking rules hand the assistant ONE turn? No audio is used or stored."""

# ruff: noqa: E501
from __future__ import annotations

import asyncio
import json
from pathlib import Path
from typing import Any

import pytest

from app.conversation import turntaking
from app.conversation.fakes import FakeLlm, FakePlayout, FakeTts, ScriptedStt, Segment
from app.conversation.parts import Session, TurnTimings
from app.conversation.pipeline import Conversation
from app.conversation.turntaking import COMMAND_HOLD_MS, classify_interruption, foreign_to_pin
from tests.test_oq_live_standard import Src

CASES = [json.loads(line) for line in (Path(__file__).resolve().parents[3] / "tests" / "evals" / "recordings" / "cases.jsonl").read_text(encoding="utf-8").splitlines() if line.strip()]
SCALE = 0.2   # the recorded durations at a fifth of their length; the hold of the rules is real time


class Recorded:
    """The audio turn model's answers as recorded, one per stop, in order."""

    def __init__(self, values: list[float | None]) -> None:
        self.values, self.calls = list(values), 0

    def probability_complete(self, pcm16_16k: bytes) -> float | None:
        value = self.values[min(self.calls, len(self.values) - 1)]
        self.calls += 1
        return value


async def heard(case: dict[str, Any], *, audio: bool) -> str | None:
    segments = [Segment(s["text"], int(s["speech_ms"]), int(s["gap_ms"])) for s in case["segments"]]
    conv = Conversation(stt=ScriptedStt(segments, scale=SCALE), llm=FakeLlm(("ok",)), tts=FakeTts(), playout=FakePlayout(rate=16000), session=Session(system="", language=case["language"]), models={"fast": "f", "strong": "s"},
                        semantic_turns=True, command_hold_ms=COMMAND_HOLD_MS, audio_turn=Recorded(case["audio_p_at_stops"]) if audio else None, audio_turn_mode="on" if audio else "off", audio_tail=(lambda: b"\x01\x00" * 16000) if audio else None)
    return await asyncio.wait_for(conv.listen(Src(), TurnTimings()), 20)


def by_status(status: str) -> list[dict[str, Any]]:
    return [c for c in CASES if c["status"] == status]


def test_the_cases_are_text_and_numbers_only() -> None:
    assert {c["recording"] for c in CASES} == {f"voice-{n}" for n in range(1, 9)}
    for c in CASES:
        assert set(c) >= {"id", "language", "segments", "audio_p_at_stops", "expect_joined", "status"} and ("reference_unconfirmed" in c or "reference_confirmed" in c) and c["status"] in ("pass", "known_gap")
        assert all(isinstance(s["text"], str) and s["speech_ms"] > 0 for s in c["segments"])
    audio = {".wav", ".m4a", ".mp3", ".ogg", ".opus", ".flac", ".aac", ".mp4", ".webm", ".caf", ".aiff"}
    assert not [p for p in (Path(__file__).resolve().parents[3] / "tests" / "evals" / "recordings").iterdir() if p.suffix.lower() in audio], "no audio file next to the cases"


@pytest.mark.parametrize("case", by_status("pass"), ids=lambda c: c["id"])
def test_the_text_rules_hand_over_one_turn_for_the_recordings_that_work_today(case: dict[str, Any]) -> None:
    assert asyncio.run(heard(case, audio=False)) == case["expect_joined"]


@pytest.mark.xfail(strict=True, reason="a known gap of the text rules (see the case's `gap`): when a fix lands this flips, and the case becomes `pass`")
@pytest.mark.parametrize("case", by_status("known_gap"), ids=lambda c: c["id"])
def test_the_known_gaps_of_the_text_rules(case: dict[str, Any]) -> None:
    assert asyncio.run(heard(case, audio=False)) == case["expect_joined"]


def test_the_audio_model_at_the_current_thresholds_changes_nothing_on_these_recordings() -> None:
    """Its numbers at the stops that matter (0.32, 0.56, 0.70) are not below the 0.2 'sure it is going on' line: in 'on' mode today it would not have helped, which is why it stays in shadow."""
    for case in CASES:
        assert asyncio.run(heard(case, audio=True)) == asyncio.run(heard(case, audio=False))


def test_at_a_0_6_threshold_the_audio_model_fixes_the_cough_and_the_tv_word_and_breaks_none(monkeypatch: pytest.MonkeyPatch) -> None:
    """The calibration the 31 Oct recordings suggest (8 recordings, one speaker and one phone: NOT enough to ship): a finished-looking stop with a chance below 0.6 waits a little for more."""
    monkeypatch.setattr(turntaking, "AUDIO_SURE_NOT_DONE", 0.6)
    for case in CASES:
        got = asyncio.run(heard(case, audio=True))
        if case["id"] in ("rec-5", "rec-6"):
            assert got == case["expect_joined"], case["id"]
        elif case["status"] == "pass":
            assert got == case["expect_joined"], f"{case['id']} must not change"
        else:
            assert got != case["expect_joined"], f"{case['id']}: the model says 'finished' at {case['audio_p_at_stops'][0]}, so it is still cut"


# ---- the interruption windows, scored with the owner's labels ----------------------------------------------------------------------------------

WINDOWS = [json.loads(line) for line in (Path(__file__).resolve().parents[3] / "tests" / "evals" / "recordings" / "interruptions.jsonl").read_text(encoding="utf-8").splitlines() if line.strip()]


def decision(window: dict[str, Any], gate: bool = True) -> str:
    foreign = gate and foreign_to_pin(window["text"], window.get("pin"))
    return "stop" if classify_interruption(int(window["speech_ms"]), window["text"], foreign=foreign) == "barge_in" else "ignore"


@pytest.mark.parametrize("window", [w for w in WINDOWS if w["status"] == "pass"], ids=lambda w: w["id"])
def test_a_cough_a_single_tv_word_and_the_owner_are_told_apart(window: dict[str, Any]) -> None:
    assert decision(window) == window["expect"]


@pytest.mark.xfail(strict=True, reason="a TV phrase in the owner's own language (Telugu or Tenglish) is read as a person (known limit; the speaker check is the proposed fix)")
@pytest.mark.parametrize("window", [w for w in WINDOWS if w["status"] == "known_gap"], ids=lambda w: w["id"])
def test_a_tv_phrase_of_two_or_more_words_does_not_stop_the_reply(window: dict[str, Any]) -> None:
    assert decision(window) == window["expect"]


def test_the_scores_of_the_labelled_windows() -> None:
    tv = [w for w in WINDOWS if w["label"] == "tv"]
    assert (len(tv), sum(decision(w) == "ignore" for w in tv)) == (4, 3), "3 of 4 TV windows ignored with the language gate (2 before), 1 still wrongly stops the reply"
    assert sum(decision(w, gate=False) == "ignore" for w in tv) == 2, "without the gate: 2 of 4"
    assert all(decision(w) == "ignore" for w in WINDOWS if w["label"] == "cough") and all(decision(w) == "stop" for w in WINDOWS if w["label"] == "owner")


@pytest.mark.parametrize("name", ["rec-1", "rec-7", "rec-3"])
def test_a_question_gets_no_added_delay_and_the_command_gets_the_wait(name: str) -> None:
    case = next(c for c in CASES if c["id"] == name)
    segments = [Segment(x["text"], int(x["speech_ms"]), int(x["gap_ms"])) for x in case["segments"]]
    conv = Conversation(stt=ScriptedStt(segments, scale=SCALE), llm=FakeLlm(("ok",)), tts=FakeTts(), playout=FakePlayout(rate=16000), session=Session(system="", language=case["language"]), models={"fast": "f", "strong": "s"},
                        semantic_turns=True, command_hold_ms=COMMAND_HOLD_MS)
    tm = TurnTimings()
    asyncio.run(asyncio.wait_for(conv.listen(Src(), tm), 20))
    assert not tm.command_turn and tm.held_ms == 0, name


def test_the_gate_changes_nothing_for_what_the_owner_said_in_the_recordings() -> None:
    """Every piece the recogniser wrote for the owner's eight recordings, as an interruption with the pill the owner would have set (Telugu for voices 1 to 6, English for 7 and 8): same decision with the gate as without it."""
    for case in CASES:
        pin = "en" if case["recording"] in ("voice-7", "voice-8") else "te"
        for segment in case["segments"]:
            window = {"text": segment["text"], "speech_ms": segment["speech_ms"], "pin": pin}
            if case["id"] == "rec-6" and segment["text"] == "Cubic":
                continue   # the TV's word (scored with the windows)
            assert decision(window) == decision(window, gate=False), (case["id"], segment["text"])
