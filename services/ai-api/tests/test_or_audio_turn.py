"""The audio turn model (Indic Smart Turn): the one-step blend, the log-mel front end against the reference values, loading that fails soft, and the loop in off / shadow / on (owner decision, 31 Oct 2026:
"build the Indic Smart Turn audio model into the turn detector, fall back to the text classifier if it fails to load")."""

# ruff: noqa: E501
from __future__ import annotations

import asyncio
import os
import time
from pathlib import Path
from typing import Any

import pytest

from app.browser_voice.audio import RECENT_BYTES, FrameBus
from app.conversation import audio_turn
from app.conversation.fakes import FakeLlm, FakePlayout, FakeTts, ScriptedStt, Segment
from app.conversation.parts import Session, TurnTimings
from app.conversation.pipeline import Conversation
from app.conversation.turntaking import blend, completeness
from tests.test_dv_browser_voice import arun
from tests.test_oq_live_standard import Src

# ---- the blend --------------------------------------------------------------------------------------------------------------------------------


def test_no_opinion_from_the_audio_leaves_the_text_reading_as_it_is() -> None:
    for state in ("complete", "unsure", "incomplete"):
        assert blend(state, None) == state 


def test_the_audio_moves_the_text_reading_by_one_step_and_never_more() -> None:
    assert blend("complete", 0.05) == "unsure", "finished words, a voice that trails off: wait a little, not as for half a sentence"
    assert blend("complete", 0.5) == "complete" and blend("complete", 0.99) == "complete"
    assert blend("unsure", 0.9) == "complete" and blend("unsure", 0.1) == "incomplete" and blend("unsure", 0.5) == "unsure"
    assert blend("incomplete", 0.99) == "unsure", "a dangling word is never answered on the audio's say-so alone"
    assert blend("incomplete", 0.5) == "incomplete" and blend("incomplete", 0.01) == "incomplete"


# ---- the front end ----------------------------------------------------------------------------------------------------------------------------


def test_the_log_mel_matches_whispers_feature_extractor() -> None:
    np = pytest.importorskip("numpy")
    t = np.arange(int(1.5 * 16000)) / 16000
    x = (0.3 * np.sin(2 * np.pi * 220 * t) + 0.05 * np.sin(2 * np.pi * 3100 * t) * np.sin(2 * np.pi * 3 * t)).astype(np.float32)
    pcm = (x * 32767).astype("<i2").tobytes()
    f = audio_turn.log_mel(pcm, np)
    assert f.shape == (1, 80, 800) and f.dtype == np.float32
    # values from transformers' WhisperFeatureExtractor(chunk_length=8) with do_normalize=True, padding="max_length", on the same samples
    assert float(f.mean()) == pytest.approx(-0.30743059515953064, abs=1e-4)
    assert float(f.std()) == pytest.approx(0.25939062237739563, abs=1e-4)
    assert float(f[0, 0, 5]) == pytest.approx(0.3706350326538086, abs=1e-4)
    assert float(f[0, 10, 100]) == pytest.approx(0.44378459453582764, abs=1e-4)
    assert float(f[0, 40, 200]) == pytest.approx(-0.3629404306411743, abs=1e-4), "after the audio ends: the floor value"


def test_only_the_last_eight_seconds_count() -> None:
    np = pytest.importorskip("numpy")
    tail = (np.random.default_rng(1).normal(0, 0.1, 16000 * 8) * 32767).astype("<i2").tobytes()
    lead = b"\x10\x00" * (16000 * 5)
    assert np.allclose(audio_turn.log_mel(lead + tail, np), audio_turn.log_mel(tail, np))


# ---- loading fails soft -----------------------------------------------------------------------------------------------------------------------


def test_a_missing_file_a_junk_file_and_no_path_all_mean_no_model(tmp_path: Path) -> None:
    audio_turn._cache.clear()   # noqa: SLF001
    junk = tmp_path / "junk.onnx"
    junk.write_bytes(b"not a model")
    assert audio_turn.load("") is None
    assert audio_turn.load(str(tmp_path / "nothing.onnx")) is None
    assert audio_turn.load(str(junk)) is None


def test_the_real_model_answers_when_it_is_there() -> None:
    path = os.environ.get("AUDIO_TURN_MODEL_FOR_TESTS", "")
    if not path or not os.path.isfile(path):
        pytest.skip("set AUDIO_TURN_MODEL_FOR_TESTS to the ONNX file to run this")
    np = pytest.importorskip("numpy")
    pytest.importorskip("onnxruntime")
    audio_turn._cache.clear()   # noqa: SLF001
    model = audio_turn.load(path)
    assert model is not None
    rng = np.random.default_rng(2)
    started = time.perf_counter()
    p = model.probability_complete((rng.normal(0, 0.05, 16000 * 3) * 32767).astype("<i2").tobytes())
    assert p is not None and 0.0 <= p <= 1.0 and time.perf_counter() - started < 2.0
    assert model.probability_complete(b"\x00\x00" * 100) is None, "less than a fraction of a second is not a turn to judge"


# ---- the audio tap ----------------------------------------------------------------------------------------------------------------------------


@arun
async def test_the_bus_keeps_the_last_eight_seconds_and_forgets_our_own_voice() -> None:
    bus = FrameBus()
    for i in range(500):
        bus.push(bytes([i % 250]) * 640)   # 20 ms frames, 10 s
    assert len(bus.recent()) == RECENT_BYTES
    bus.drop_before(0.0)
    assert bus.recent() == b"", "the greeting came back through the microphone: not the caller's words"


# ---- the loop: off, shadow, on ----------------------------------------------------------------------------------------------------------------


class FakeAudioTurn:
    def __init__(self, value: float | None = 0.9, delay_s: float = 0.0, boom: bool = False) -> None:
        self.value, self.delay_s, self.boom, self.calls = value, delay_s, boom, 0

    def probability_complete(self, pcm16_16k: bytes) -> float | None:
        self.calls += 1
        if self.delay_s:
            time.sleep(self.delay_s)
        if self.boom:
            raise RuntimeError("the model broke")
        return self.value


def loop(model: Any, mode: str, segments: list[Segment] | None = None) -> Conversation:
    stt = ScriptedStt(segments or [Segment("two thousand sq ft", 100, 600)], scale=0.05)
    return Conversation(stt=stt, llm=FakeLlm(("Ok. ",)), tts=FakeTts(), playout=FakePlayout(rate=16000), session=Session(system="", language="en"), models={"fast": "f", "strong": "s"},
                        semantic_turns=True, audio_turn=model, audio_turn_mode=mode, audio_tail=lambda: b"\x01\x00" * 16000)


@arun
async def test_off_never_asks_the_model() -> None:
    model = FakeAudioTurn()
    conv = loop(model, "off")
    tm = TurnTimings()
    assert await asyncio.wait_for(conv.listen(Src(), tm), 10) == "two thousand sq ft"
    assert model.calls == 0 and tm.audio_p is None and conv.audio_turn is None


@arun
async def test_shadow_records_what_the_model_says_and_changes_nothing() -> None:
    model = FakeAudioTurn(0.05)
    conv = loop(model, "shadow")
    tm = TurnTimings()
    assert await asyncio.wait_for(conv.listen(Src(), tm), 10) == "two thousand sq ft"
    await asyncio.sleep(0.05)
    assert model.calls == 1 and tm.audio_p == 0.05 and tm.audio_run_ms is not None, "the model's own time is recorded too"
    assert conv._hold_s("two thousand sq ft") == conv._hold_s("two thousand sq ft")   # noqa: SLF001
    text = "price for 2000 sq ft"
    plain = loop(None, "off")
    assert conv._hold_s(text) == plain._hold_s(text), "shadow leaves the hold as the text rules make it"   # noqa: SLF001


@arun
async def test_on_lets_a_confident_audio_shorten_or_lengthen_the_hold_by_one_step() -> None:
    text = "2000 sq ft"
    assert completeness(text, "en") == "unsure"
    for p, longer in ((0.95, False), (0.05, True)):
        model = FakeAudioTurn(p)
        conv = loop(model, "on", [Segment(text, 100, 600)])
        tm = TurnTimings()
        await asyncio.wait_for(conv.listen(Src(), tm), 10)
        assert tm.audio_p == p and tm.audio_turn_ms is not None
        baseline = loop(None, "off")._hold_s(text)   # noqa: SLF001
        assert (conv._hold_s(text) > baseline) is longer and conv._hold_s(text) != baseline   # noqa: SLF001


@arun
async def test_a_model_that_breaks_or_is_slow_never_holds_up_or_breaks_the_turn() -> None:
    broken = loop(FakeAudioTurn(boom=True), "on")
    assert await asyncio.wait_for(broken.listen(Src(), TurnTimings()), 10) == "two thousand sq ft"
    slow = loop(FakeAudioTurn(0.9, delay_s=3.0), "on")   # (a model far slower than the quarter-second wait: the bound below is half of its delay, so a busy machine cannot flip it)
    started = time.perf_counter()
    tm = TurnTimings()
    assert await asyncio.wait_for(slow.listen(Src(), tm), 10) == "two thousand sq ft"
    assert time.perf_counter() - started < 2.0, "the final transcript waits for the model for a quarter of a second at most"
    assert tm.audio_p is None
    assert slow._hold_s("2000 sq ft") == loop(None, "off")._hold_s("2000 sq ft")   # noqa: SLF001
