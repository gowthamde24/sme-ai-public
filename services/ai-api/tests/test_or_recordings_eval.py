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
                        semantic_turns=True, audio_turn=Recorded(case["audio_p_at_stops"]) if audio else None, audio_turn_mode="on" if audio else "off", audio_tail=(lambda: b"\x01\x00" * 16000) if audio else None)
    return await asyncio.wait_for(conv.listen(Src(), TurnTimings()), 20)


def by_status(status: str) -> list[dict[str, Any]]:
    return [c for c in CASES if c["status"] == status]


def test_the_cases_are_text_and_numbers_only() -> None:
    assert {c["recording"] for c in CASES} == {f"voice-{n}" for n in range(1, 9)}
    for c in CASES:
        assert set(c) >= {"id", "language", "segments", "audio_p_at_stops", "expect_joined", "status", "reference_unconfirmed"} and c["status"] in ("pass", "known_gap")
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
