"""The per-language voice config and the Cartesia-then-Bulbul-v4-Flash fallback (job natural-voice, owner decision of 28 Oct 2026). Fake engines only: no socket, no key."""

# ruff: noqa: E501

from __future__ import annotations

import asyncio
import copy
import dataclasses
import json
import logging
from collections.abc import AsyncIterator
from pathlib import Path
from typing import Any

import pytest

from app.conversation.fakes import FakeAudioSource, FakeLlm, FakePlayout, FakeStt
from app.conversation.fallback import FallbackTts
from app.conversation.parts import Session
from app.conversation.pipeline import Conversation
from app.conversation.voices import (
    CALL_LANGUAGES,
    DEFAULT_FILE,
    VoiceChoice,
    default_config,
    load_config,
    parse_config,
)
from app.voice.interface import VoiceError


def run(coro: Any) -> Any:
    return asyncio.run(coro)


# ---- the config -------------------------------------------------------------------------------------------------------------------------------------


def test_the_default_config_has_cartesia_first_and_bulbul_v4_flash_behind_it_for_every_call_language() -> None:
    cfg = default_config()
    assert set(cfg.languages) >= set(CALL_LANGUAGES) == {"te", "hi", "kn", "en"}
    for lang in CALL_LANGUAGES:
        v = cfg.for_language(lang)
        assert v.primary.engine == "cartesia" and v.primary.model == "sonic-3.6"
        assert v.fallback.engine == "sarvam_v4" and v.fallback.model == "bulbul:v4-flash" and v.fallback.voice.startswith(("kavitha", "kavya", "chaitra", "shalini"))
    assert cfg.first_audio_timeout_ms == 800


def test_bulbul_v3_is_not_a_choice_anywhere() -> None:
    raw = json.loads(DEFAULT_FILE.read_text(encoding="utf-8"))
    assert "bulbul:v3" not in json.dumps(raw) and "sarvam_v3" not in json.dumps(raw)
    bad = copy.deepcopy(raw)
    bad["catalogue"][0]["fallback"]["engine"] = "sarvam_v3"
    with pytest.raises(ValueError, match="engine must be one of"):
        parse_config(bad)


def test_the_config_is_data_a_voice_swaps_without_touching_code(tmp_path: Path) -> None:
    raw = json.loads(DEFAULT_FILE.read_text(encoding="utf-8"))
    next(e for e in raw["catalogue"] if e["id"] == "te-ramya")["primary"]["voice"] = "some-other-voice-id"
    next(e for e in raw["catalogue"] if e["id"] == "en-janvi")["fallback"]["voice"] = "ritu_en_latenight"
    raw["first_audio_timeout_ms"] = 600
    path = tmp_path / "voices.json"
    path.write_text(json.dumps(raw), encoding="utf-8")
    cfg = load_config(path)
    assert cfg.for_language("te").primary.voice == "some-other-voice-id" and cfg.for_language("en").fallback.voice == "ritu_en_latenight" and cfg.first_audio_timeout_ms == 600
    assert default_config().for_language("te").primary.voice != "some-other-voice-id"


@pytest.mark.parametrize(
    "mutate, message",
    [
        (lambda r: r.pop("catalogue"), "catalogue"),
        (lambda r: r.update(first_audio_timeout_ms=50), "first_audio_timeout_ms"),
        (lambda r: r["catalogue"][0]["primary"].pop("voice"), "model and voice are required"),
        (lambda r: r["catalogue"][0]["fallback"].update(engine="cartesia"), "different engine"),
        (lambda r: r["catalogue"].pop(0), "language en needs exactly one default"),
    ],
)
def test_a_broken_config_is_refused_with_a_reason(mutate: Any, message: str) -> None:
    raw = json.loads(DEFAULT_FILE.read_text(encoding="utf-8"))
    mutate(raw)
    with pytest.raises(ValueError, match=message):
        parse_config(raw)


def test_a_language_with_no_voice_is_a_constant_error_not_a_guess() -> None:
    with pytest.raises(VoiceError) as err:
        default_config().for_language("fr")
    assert err.value.code == "unsupported_language"


# ---- the fallback -----------------------------------------------------------------------------------------------------------------------------------


class Engine:
    """A fake voice: `mode` is ok | error | slow | silent | dies_after_first."""

    sample_rate = 24000

    def __init__(self, name: str, mode: str = "ok", delay: float = 0.0) -> None:
        self.name, self.mode, self.delay = name, mode, delay
        self.calls: list[tuple[str, str]] = []
        self.closed = 0
        self.prewarmed = 0

    async def prewarm(self) -> None:
        self.prewarmed += 1

    async def stream(self, text: str, language: str) -> AsyncIterator[bytes]:
        self.calls.append((text, language))
        try:
            if self.mode == "error":
                raise VoiceError("http_500")
            if self.mode == "slow":
                await asyncio.sleep(self.delay or 5)
            if self.mode == "silent":
                return
            yield b"\x00\x01" * 10
            if self.mode == "dies_after_first":
                raise VoiceError("unreachable")
            yield b"\x00\x01" * 10
        finally:
            self.closed += 1


def build(primary: Engine, fallback: Engine, *, timeout_ms: int = 800, clock: Any = None, cooldown_s: float = 30.0) -> FallbackTts:
    cfg = default_config()
    cfg = dataclasses.replace(cfg, first_audio_timeout_ms=timeout_ms, cooldown_s=cooldown_s)
    engines = {"cartesia": primary, "sarvam_v4": fallback}
    return FallbackTts(cfg, lambda choice, language: engines[choice.engine], clock=clock or (lambda: 0.0))


async def speak(tts: FallbackTts, text: str = "హా అండీ", language: str = "te") -> list[bytes]:
    return [c async for c in tts.stream(text, language)]


def test_the_primary_speaks_when_it_works_and_the_fallback_is_never_touched() -> None:
    primary, fallback = Engine("c"), Engine("s")
    tts = build(primary, fallback)
    tts.begin_turn()
    assert len(run(speak(tts))) == 2 and tts.served_engine == "cartesia" and tts.fallback_reason == "" and not fallback.calls


@pytest.mark.parametrize("mode, reason", [("error", "error"), ("silent", "error")])
def test_an_error_or_an_empty_answer_from_the_primary_goes_to_the_fallback(mode: str, reason: str) -> None:
    primary, fallback = Engine("c", mode), Engine("s")
    tts = build(primary, fallback)
    tts.begin_turn()
    assert len(run(speak(tts))) == 2 and tts.served_engine == "sarvam_v4" and tts.fallback_reason == reason and fallback.calls == [("హా అండీ", "te")]


def test_no_audio_within_the_timeout_goes_to_the_fallback_and_the_slow_primary_is_stopped() -> None:
    primary, fallback = Engine("c", "slow", delay=2.0), Engine("s")
    tts = build(primary, fallback, timeout_ms=200)
    tts.begin_turn()
    chunks = run(speak(tts))
    assert len(chunks) == 2 and tts.served_engine == "sarvam_v4" and tts.fallback_reason == "timeout" and primary.closed >= 1


def test_audio_that_arrives_in_time_is_not_a_fallback_even_if_the_rest_is_slow() -> None:
    primary, fallback = Engine("c"), Engine("s")
    tts = build(primary, fallback, timeout_ms=300)
    tts.begin_turn()
    run(speak(tts))
    assert tts.fallback_reason == "" and tts.first_audio_ms is not None and tts.first_audio_ms < 300


def test_once_the_fallback_speaks_in_a_turn_the_rest_of_the_turn_stays_on_it() -> None:
    primary, fallback = Engine("c", "error"), Engine("s")
    tts = build(primary, fallback)
    tts.begin_turn()
    run(speak(tts, "one"))
    primary.mode = "ok"  # the primary recovers in the middle of the turn: the voice must not change back
    run(speak(tts, "two"))
    assert [t for t, _ in fallback.calls] == ["one", "two"] and len(primary.calls) == 1


def test_after_a_failure_the_primary_is_skipped_for_the_cooldown_and_tried_again_after_it() -> None:
    now = [100.0]
    primary, fallback = Engine("c", "error"), Engine("s")
    tts = build(primary, fallback, clock=lambda: now[0], cooldown_s=30)
    tts.begin_turn()
    run(speak(tts, "a"))
    primary.mode = "ok"
    tts.begin_turn()
    run(speak(tts, "b"))  # a new turn, 0 s later: straight to the fallback, no slow try
    assert tts.served_engine == "sarvam_v4" and tts.fallback_reason == "cooldown" and len(primary.calls) == 1
    now[0] += 31
    tts.begin_turn()
    run(speak(tts, "c"))
    assert tts.served_engine == "cartesia" and tts.fallback_reason == "" and len(primary.calls) == 2


def test_a_failure_after_the_first_audio_ends_the_piece_and_the_next_piece_uses_the_fallback() -> None:
    primary, fallback = Engine("c", "dies_after_first"), Engine("s")
    tts = build(primary, fallback)
    tts.begin_turn()
    assert len(run(speak(tts, "first"))) == 1 and tts.fallback_reason == "mid_stream" and not fallback.calls
    assert len(run(speak(tts, "second"))) == 2 and fallback.calls == [("second", "te")]


def test_both_engines_failing_is_a_constant_error() -> None:
    tts = build(Engine("c", "error"), Engine("s", "error"))
    tts.begin_turn()
    with pytest.raises(VoiceError) as err:
        run(speak(tts))
    assert err.value.code == "tts_unavailable"


def test_each_language_gets_its_own_voice_from_the_config_and_the_engine_is_built_once() -> None:
    built: list[tuple[str, str, str]] = []

    def factory(choice: VoiceChoice, language: str) -> Engine:
        built.append((language, choice.engine, choice.voice))
        return Engine(choice.voice)

    tts = FallbackTts(default_config(), factory)
    for lang in ("te", "hi", "kn", "en", "te"):
        tts.begin_turn()
        run(speak(tts, "x", lang))
    assert [b[0] for b in built] == ["te", "hi", "kn", "en"] and len({b[2] for b in built}) == 4  # each language's own default voice


def test_prewarm_warms_only_the_primary() -> None:
    primary, fallback = Engine("c"), Engine("s")
    run(build(primary, fallback).prewarm())
    assert primary.prewarmed == 1 and fallback.prewarmed == 0


# ---- the loop records which engine served the turn ----------------------------------------------------------------------------------------------------


def test_every_turn_says_which_engine_served_it_in_its_timings_and_in_the_log(caplog: pytest.LogCaptureFixture) -> None:
    async def turn(primary: Engine, fallback: Engine) -> Any:
        conv = Conversation(stt=FakeStt(), llm=FakeLlm(), tts=build(primary, fallback), playout=FakePlayout(), session=Session(system="s", language="te"), models={"fast": "a", "strong": "b"})
        return await conv.run_turn(FakeAudioSource())

    with caplog.at_level(logging.INFO, logger="app.conversation"):
        ok = run(turn(Engine("c"), Engine("s")))
        failed = run(turn(Engine("c", "error"), Engine("s")))
    assert (ok.tts_engine, ok.tts_fallback) == ("cartesia", "") and (failed.tts_engine, failed.tts_fallback) == ("sarvam_v4", "error")
    lines = [r.getMessage() for r in caplog.records if r.getMessage().startswith("conversation_turn")]
    assert any("tts_engine=cartesia tts_fallback=-" in line for line in lines) and any("tts_engine=sarvam_v4 tts_fallback=error" in line for line in lines)
    assert all("ఈ saree" not in line and "హా" not in line for line in lines)  # no words of the call, ever
