"""The quiet background bed under OUR voice (owner, 20 Nov 2026): level, limiter, seam, no added latency, a missing file is no bed, the AI disclosure is untouched. Synthetic PCM only."""

# ruff: noqa: E501

from __future__ import annotations

import array
import asyncio
import base64
import json
import math
from pathlib import Path
from types import SimpleNamespace
from typing import Any

from app.telephony import ambience, persona
from app.telephony import tone as tone_mod
from app.telephony.line import PhoneLine
from app.voice import loudness as ld


def sine(amplitude: float, ms: int = 1000, freq: float = 300.0, rate: int = 8000) -> bytes:
    n = rate * ms // 1000
    return array.array("h", (int(amplitude * math.sin(2 * math.pi * freq * i / rate)) for i in range(n))).tobytes()


def db(a: float, b: float) -> float:
    return 20 * math.log10(a / b)


def test_the_bed_is_28_db_under_the_voice_and_never_louder() -> None:
    assert abs(db(ambience.bed_rms(), ld.TARGET_RMS) + 28.0) < 0.01 and ambience.bed_rms() < ld.TARGET_RMS
    bed = ambience.Bed(ambience.scale_to(ambience.placeholder("quiet_office"), ambience.bed_rms()))
    heard = bed.frame(len(ambience.placeholder("quiet_office")))   # the whole loop
    assert abs(db(ld.rms_of(heard), ld.TARGET_RMS) + 28.0) < 0.6
    voice = sine(ld.TARGET_RMS * math.sqrt(2))   # a voice at the target level
    mixed = ambience.mix(voice, bed.frame(len(voice)))
    assert abs(db(ld.rms_of(mixed), ld.rms_of(voice))) < 0.3   # the bed adds almost nothing to the level


def test_a_file_of_any_level_gives_the_same_bed() -> None:
    raw = ambience.placeholder("shop")
    loud = ambience.scale_to(raw, 9000.0)
    for pcm in (raw, loud):
        assert abs(ld.rms_of(ambience.scale_to(ambience.make_loop(pcm), ambience.bed_rms())) - ambience.bed_rms()) < 1.5


def test_the_sum_never_clips() -> None:
    voice = array.array("h", [32767, -32768] * 2000).tobytes()
    loud_bed = array.array("h", [32767, -32768] * 2000).tobytes()
    assert ld.peak_of(ambience.mix(voice, loud_bed)) <= ld.CEILING


def test_the_loop_has_no_seam() -> None:
    raw = ambience.placeholder("quiet_office", seconds=4.0)
    loop = array.array("h")
    loop.frombytes(ambience.make_loop(raw))
    assert len(loop) == len(raw) // 2 - 8000 * ambience.CROSSFADE_MS // 1000
    steps = [abs(loop[i + 1] - loop[i]) for i in range(len(loop) - 1)]
    seam = abs(loop[0] - loop[-1])
    assert seam <= 3 * max(steps)   # the wrap-around step is an ordinary step of the bed, not a click


def test_the_bed_adds_no_latency_the_same_length_in_and_out_and_pieces_equal_the_whole() -> None:
    loop = ambience.scale_to(ambience.make_loop(ambience.placeholder("shop")), ambience.bed_rms())
    voice = sine(100, ms=1000)   # below the duck threshold: a breath, not speech (speech is ducked chunk by chunk: test_the_bed_ducks_...)
    whole = ambience.mix(voice, ambience.Bed(loop).frame(len(voice)))
    bed = ambience.Bed(loop)
    frame = 320   # 20 ms at 8 kHz
    pieces = [bed.mix_into(voice[i : i + frame]) for i in range(0, len(voice), frame)]
    assert all(len(p) == len(voice[i * frame : (i + 1) * frame]) for i, p in enumerate(pieces))
    assert b"".join(pieces) == whole
    odd = ambience.Bed(loop)
    assert len(odd.mix_into(b"\x01\x00\x02\x00\x03")) == 5   # a stray byte is kept, never dropped
    assert ambience.Bed(loop).mix_into(b"") == b""


def test_the_bed_runs_round_the_loop() -> None:
    bed = ambience.Bed(array.array("h", [1, 2, 3]).tobytes())
    assert array.array("h", bed.frame(16)).tolist() == [1, 2, 3, 1, 2, 3, 1, 2]


def test_a_missing_short_or_unknown_bed_is_no_bed_and_never_an_error(tmp_path: Path) -> None:
    assert ambience.load_bed("off") is None and ambience.load_bed("nonsense") is None
    assert ambience.load_bed("shop", directory=tmp_path) is None   # no file
    (tmp_path / "shop.pcm").write_bytes(b"\x01\x02" * 100)         # too short
    assert ambience.load_bed("shop", directory=tmp_path) is None
    (tmp_path / "quiet_office.pcm").write_bytes(ambience.placeholder("quiet_office", seconds=3.0))
    assert ambience.load_bed("quiet_office", 16000, tmp_path) is not None


def test_the_shipped_beds_load_at_both_line_rates_and_match_the_script() -> None:
    for name in ("quiet_office", "shop"):
        for rate in (8000, 16000):
            bed = ambience.load_bed(name, rate)
            assert bed is not None
            assert abs(ld.rms_of(bed.frame(rate * 2 * 4)) - ambience.bed_rms()) < 8, (name, rate)
        shipped = (ambience.DATA / f"{name}.pcm").read_bytes()
        again = ambience.placeholder(name)
        assert len(shipped) == len(again)
        a, b = array.array("h"), array.array("h")
        a.frombytes(shipped)
        b.frombytes(again)
        assert max(abs(x - y) for x, y in zip(a, b, strict=True)) <= 2   # deterministic (a last-digit difference of the platform's math library is allowed)
    assert ambience.placeholder("shop") == ambience.placeholder("shop") and ambience.placeholder("shop") != ambience.placeholder("quiet_office")


def test_the_setting_words_and_labels() -> None:
    assert ambience.BACKGROUNDS == ("off", "quiet_office", "busy_office", "call_centre", "shop", "market", "showroom", "clinic_reception", "home", "street") and ambience.DEFAULT_BACKGROUND == "off"
    assert ambience.valid(None) == "off" and ambience.valid("loud") == "off" and ambience.valid("off") == "off" and ambience.valid("shop") == "shop"
    for word in ambience.BACKGROUNDS:
        assert set(ambience.LABELS[word]) == set(ambience.LANGUAGES) and all(ambience.LABELS[word].values())


class _Wire:
    def __init__(self) -> None:
        self.sent: list[str] = []

    async def send_text(self, data: str) -> None:
        self.sent.append(data)

    async def receive_text(self) -> str | None:
        return None


def _line() -> tuple[PhoneLine, _Wire]:
    wire = _Wire()

    async def nap(_s: float) -> None:
        return None

    line = PhoneLine(wire, sleep=nap)
    line.start = SimpleNamespace(stream_sid="S1")   # type: ignore[assignment]
    return line, wire


def _payloads(wire: _Wire) -> list[bytes]:
    return [base64.b64decode(json.loads(m)["media"]["payload"]) for m in wire.sent if json.loads(m).get("event") == "media"]


def test_the_line_mixes_the_bed_into_its_own_audio_only_and_with_no_bed_changes_nothing() -> None:
    voice = sine(6000, ms=20)
    line, wire = _line()
    asyncio.run(line._emit(voice))
    assert _payloads(wire) == [voice]   # no bed: the bytes go out as they came
    line, wire = _line()
    loop: Any = ambience.scale_to(ambience.make_loop(ambience.placeholder("quiet_office")), ambience.bed_rms())
    line.ambience = ambience.Bed(loop)
    asyncio.run(line._emit(voice))
    asyncio.run(line._emit(voice, bed=False))   # the owner's voice and a fade tail carry no bed
    first, second = _payloads(wire)
    assert len(first) == len(voice) and first != voice and second == voice
    assert abs(db(ld.rms_of(first), ld.rms_of(voice))) < 0.3


def test_the_ai_disclosure_words_are_exactly_as_they_were() -> None:
    # copied from the opening and honesty lines on the day the bed was added (20 Nov 2026): nothing about a background may change what the caller is told
    assert persona.INBOUND_OPENING["en"] == "Hello, I'm {assistant}, the AI assistant from {business}. Do you have a minute to talk?"
    assert persona.INBOUND_OPENING["te"] == "హలో, నేను {business} నుంచి {assistant}, AI అసిస్టెంట్\u200cని. ఇప్పుడు ఒక నిమిషం మాట్లాడొచ్చా?"
    assert tone_mod.HONEST_EN["friendly"] == "Yes, I'm an AI assistant."
    assert tone_mod.HONEST_TE["friendly"] == "అవును, నేను AI assistant ని."
    assert tone_mod.OPENERS_EN["friendly"] == "Hello, this is the AI assistant of {business}. Is this a good time to talk?"
    assert tone_mod.OPENERS_TE["friendly"] == "హలో, నేను {business} నుంచి AI assistant ని. ఒక్క నిమిషం మాట్లాడొచ్చా?"


def test_the_bed_ducks_while_the_voice_speaks_and_comes_back_after() -> None:
    """25 Nov 2026: the voice always wins. A speech chunk takes the bed DUCK_DB lower within the chunk; silence brings it back over RELEASE_CHUNKS chunks; the length never changes."""
    bed = ambience.Bed(ambience.scale_to(ambience.make_loop(ambience.placeholder("market")), ambience.bed_rms()))
    voice = sine(ld.TARGET_RMS * math.sqrt(2), ms=20)
    quiet = bytes(640)
    plain = ambience.Bed(bed._loop).frame(len(quiet))   # noqa: SLF001 - the bed's own samples, for the comparison
    start = ld.rms_of(bed.mix_into(quiet))
    assert abs(db(start, ld.rms_of(plain))) < 0.2, "silence in, the whole bed out"
    for _ in range(3):
        out = bed.mix_into(voice)
        assert len(out) == len(voice)
    assert bed._gain == 10 ** (ambience.DUCK_DB / 20)   # noqa: SLF001 - fully ducked after speech
    gains = []
    for _ in range(ambience.RELEASE_CHUNKS + 1):
        bed.mix_into(quiet)
        gains.append(bed._gain)   # noqa: SLF001
    assert gains == sorted(gains) and gains[-1] == 1.0 and gains[0] < 0.6, gains
