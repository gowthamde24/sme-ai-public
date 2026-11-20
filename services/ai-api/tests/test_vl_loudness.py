"""One loudness for every voice (owner finding of 19 Nov 2026: "Calm is only quieter"): synthetic PCM only, no engine, no key."""

# ruff: noqa: E501

from __future__ import annotations

import array
import asyncio
import math
from collections.abc import AsyncIterator

from app.conversation.fallback import FallbackTts
from app.conversation.voices import VoiceChoice, default_config
from app.voice import loudness as ld

RATE = 24000


def sine(amplitude: float, ms: int = 1000, freq: float = 220.0, rate: int = RATE) -> bytes:
    n = rate * ms // 1000
    return array.array("h", (int(amplitude * math.sin(2 * math.pi * freq * i / rate)) for i in range(n))).tobytes()


def db(a: float, b: float) -> float:
    return 20 * math.log10(a / b)


def test_two_voices_of_different_levels_end_at_the_same_rms() -> None:
    quiet, loud = sine(2500), sine(14000)
    a, b = ld.normalise_clip(quiet), ld.normalise_clip(loud)
    assert abs(db(ld.voiced_rms(a), ld.TARGET_RMS)) < 0.5
    assert abs(db(ld.voiced_rms(b), ld.TARGET_RMS)) < 1.0   # the loud one is limited a little at its peaks
    assert abs(db(ld.voiced_rms(a), ld.voiced_rms(b))) < 1.0


def test_the_peak_limiter_never_passes_the_ceiling() -> None:
    peaky = array.array("h", [0] * 2400 + [32767, -32768] * 1200 + [0] * 2400).tobytes()
    assert ld.peak_of(ld.normalise_clip(peaky)) <= ld.CEILING
    assert ld.peak_of(ld.normalise_clip(sine(32000))) <= ld.CEILING
    assert ld.limit(40000) <= ld.CEILING and ld.limit(-40000) >= -ld.CEILING and ld.limit(1000) == 1000   # soft knee: small samples are untouched


def test_silence_is_not_amplified() -> None:
    silence = array.array("h", [0, 3, -2, 5] * 6000).tobytes()
    assert ld.normalise_clip(silence) == silence
    assert ld.StreamNormaliser().process(silence) == silence


def test_gain_is_clamped_and_odd_bytes_are_kept_for_the_next_piece() -> None:
    assert ld.gain_for(10.0) == ld.MAX_GAIN and ld.gain_for(10**6) == ld.MIN_GAIN
    norm = ld.StreamNormaliser()
    clip = sine(1000, ms=100)
    first = norm.process(clip[:-1])      # one byte short
    second = norm.process(clip[-1:] + clip)
    assert len(first) % 2 == 0 and len(second) % 2 == 0
    assert len(first) + len(second) == 2 * len(clip)


def test_a_stream_in_pieces_reaches_the_target_for_a_quiet_and_a_loud_voice() -> None:
    for amplitude in (2500, 20000):
        norm = ld.StreamNormaliser()
        out = b"".join(norm.process(piece) for piece in (sine(amplitude, ms=100)[i : i + 4800] for i in range(0, 4800 * 10, 4800)) if piece)
        tail = out[-2 * RATE // 2 :]   # the last half second
        assert abs(db(ld.voiced_rms(tail), ld.TARGET_RMS)) < 1.5, amplitude
        assert ld.peak_of(out) <= ld.CEILING


def test_the_gain_moves_inside_a_piece_without_a_jump_at_the_join() -> None:
    norm = ld.StreamNormaliser()
    pieces = [norm.process(sine(2000, ms=100, freq=200)) for _ in range(6)]
    joined = array.array("h")
    joined.frombytes(b"".join(pieces))
    biggest = max(abs(joined[i + 1] - joined[i]) for i in range(len(joined) - 1))
    assert biggest < 2500   # a 200 Hz tone at about 4200 peak steps by at most ~220 a sample; a click would be thousands


class _Engine:
    sample_rate = 24000

    def __init__(self, amplitude: float) -> None:
        self.amplitude = amplitude
        self.pace: float | None = None

    def set_pace(self, speed: float) -> None:
        self.pace = speed

    async def prewarm(self) -> None:
        return None

    async def stream(self, text: str, language: str) -> AsyncIterator[bytes]:
        clip = sine(self.amplitude, ms=600)
        for i in range(0, len(clip), 4800):
            yield clip[i : i + 4800]


def test_the_call_voice_speaks_every_voice_at_the_same_level_and_tells_the_engine_the_speed() -> None:
    config = default_config()
    levels = {"te-ramya": 3000, "te-shanti": 15000}   # a quiet "calm" voice and a loud one

    def run(voice_id: str) -> tuple[bytes, _Engine]:
        made: list[_Engine] = []

        def factory(choice: VoiceChoice, language: str) -> _Engine:
            engine = _Engine(levels[voice_id] if choice.engine == "cartesia" else 5000)
            made.append(engine)
            return engine

        tts = FallbackTts(config, factory, chosen={"te": voice_id}, gender="female")
        tts.pace = 1.2
        tts.begin_turn()

        async def go() -> bytes:
            return b"".join([c async for c in tts.stream("నమస్కారం", "te")])

        return asyncio.run(go()), made[0]

    quiet, engine = run("te-ramya")
    loud, _ = run("te-shanti")
    assert engine.pace == 1.2
    assert abs(db(ld.voiced_rms(quiet[-24000:]), ld.voiced_rms(loud[-24000:]))) < 1.0
