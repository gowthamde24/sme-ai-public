"""What we send Exotel, byte for byte (owner, 6 Nov 2026: on both real calls Exotel closed the stream right after our first audio). The greeting already in memory and the same greeting streamed by the
voice engine must reach the line as the SAME frames: Exotel's documented message shape and nothing more, raw 16-bit mono PCM at the call's rate (8 kHz) with no WAV header, 100 ms per message
(a multiple of 320 bytes), sent at the pace it plays, never the whole clip at once."""

# ruff: noqa: E501

from __future__ import annotations

import asyncio
import base64
import json
import math
import struct
from typing import Any

from app.browser_voice.audio import OUT_RATE, BrowserPlayout
from app.telephony import exotel
from app.telephony.greeting_audio import GreetingAudio, strip_wav
from app.telephony.line import LEAD_S, PhoneLine
from tests.test_dv_browser_voice import arun

SID = "XP1"


class Clock:
    def __init__(self) -> None:
        self.t = 0.0

    def __call__(self) -> float:
        return self.t

    async def sleep(self, s: float) -> None:
        self.t += max(0.0, s)
        await asyncio.sleep(0)


class Wire:
    def __init__(self, clock: Clock, rate: int | None = 8000) -> None:
        fmt: dict[str, Any] = {"encoding": "base64", "sample_rate": str(rate)} if rate else {}
        start: dict[str, Any] = {"stream_sid": SID, "call_sid": "CA1", "account_sid": "a", "from": "09502380998", "to": "04045903172", **({"media_format": fmt} if fmt else {})}
        self.inbox: asyncio.Queue[str | None] = asyncio.Queue()
        for m in ({"event": "connected"}, {"event": "start", "stream_sid": SID, "start": start}):
            self.inbox.put_nowait(json.dumps(m))
        self.sent: list[tuple[float, dict[str, Any]]] = []
        self.clock = clock

    async def send_text(self, data: str) -> None:
        self.sent.append((self.clock(), json.loads(data)))

    async def receive_text(self) -> str | None:
        return await self.inbox.get()


def greeting_pcm(seconds: float = 2.0) -> bytes:
    """A 24 kHz tone, the voice engine's own format."""
    n = int(OUT_RATE * seconds)
    return b"".join(struct.pack("<h", int(8000 * math.sin(2 * math.pi * 440 * i / OUT_RATE))) for i in range(n))


async def play(pieces: list[bytes], rate: int | None = 8000) -> tuple[PhoneLine, Wire, Clock]:
    clock = Clock()
    wire = Wire(clock, rate)
    line = PhoneLine(wire, clock=clock, sleep=clock.sleep)
    assert await line.open() is not None
    playout = BrowserPlayout(line.send_bytes, line.flush, clock=clock)   # the phone loop's playout: no pacing of its own
    for piece in pieces:
        await playout.write(piece)
        await asyncio.sleep(0)
    await line.flush()
    await line.close()
    return line, wire, clock


def streamed(pcm: bytes) -> list[bytes]:
    """How the voice engine hands audio over: uneven pieces, an odd byte count among them."""
    sizes = [1235, 7001, 480, 9600, 333, 24_000]
    out: list[bytes] = []
    i = 0
    while i < len(pcm):
        n = sizes[len(out) % len(sizes)]
        out.append(pcm[i:i + n])
        i += n
    return out


def cached(pcm: bytes) -> list[bytes]:
    """How the session plays a greeting already in memory (app/browser_voice/session.py `_greet`)."""
    return [pcm[i:i + 4800] for i in range(0, len(pcm), 4800)]


def media(wire: Wire) -> list[tuple[float, dict[str, Any]]]:
    return [(t, m) for t, m in wire.sent if m.get("event") == "media"]


@arun
async def test_the_greeting_from_memory_reaches_exotel_exactly_as_the_streamed_greeting_does() -> None:
    pcm = greeting_pcm()
    _, a, _ = await play(streamed(pcm))
    _, b, _ = await play(cached(pcm))
    pa = [base64.b64decode(m["media"]["payload"]) for _, m in media(a)]
    pb = [base64.b64decode(m["media"]["payload"]) for _, m in media(b)]
    assert pa == pb, "the same frames, byte for byte, whichever way the greeting arrived"
    assert [m for _, m in a.sent if m["event"] != "media"] == [m for _, m in b.sent if m["event"] != "media"], "the same marks"


@arun
async def test_every_frame_is_exotels_documented_shape_8khz_pcm_100ms_and_a_multiple_of_320() -> None:
    pcm = greeting_pcm()
    line, wire, _ = await play(cached(pcm))
    frames = media(wire)
    assert line.rate == 8000 and line.chunk == 1600
    for _, m in frames:
        assert set(m) == {"event", "stream_sid", "media"} and set(m["media"]) == {"payload"} and m["stream_sid"] == SID
        raw = base64.b64decode(m["media"]["payload"], validate=True)
        assert len(raw) == 1600 and len(raw) % 320 == 0 and exotel.valid_out_chunk(raw), "100 ms of 8 kHz 16-bit mono per message"
    first = base64.b64decode(frames[0][1]["media"]["payload"])
    assert first[:4] != b"RIFF", "raw PCM, no WAV header"
    total = sum(len(base64.b64decode(m["media"]["payload"])) for _, m in frames)
    assert abs(total - len(pcm) // 3) <= 1600, "resampled 24 kHz -> 8 kHz: a third of the bytes (plus the last frame's padding)"
    marks = [m for _, m in wire.sent if m["event"] == "mark"]
    assert marks and all(set(m) == {"event", "stream_sid", "mark"} and set(m["mark"]) == {"name"} for m in marks)


@arun
async def test_frames_go_out_at_the_pace_they_play_not_as_one_burst() -> None:
    pcm = greeting_pcm(3.0)
    _, wire, clock = await play(cached(pcm))
    frames = media(wire)
    for k, (t, _) in enumerate(frames):
        assert k * 0.1 - t <= LEAD_S + 1e-6, f"frame {k} sent {k * 0.1 - t:.2f} s ahead of the ear (at most {LEAD_S})"
    assert clock() >= 3.0 - LEAD_S - 0.1, "three seconds of audio took about three seconds to send"


@arun
async def test_a_start_without_a_rate_means_8khz_and_16khz_is_honoured() -> None:
    line, _, _ = await play(cached(greeting_pcm(0.5)), rate=None)
    assert line.rate == 8000 and line.chunk == 1600
    line16, wire16, _ = await play(cached(greeting_pcm(0.5)), rate=16000)
    assert line16.rate == 16000 and all(len(base64.b64decode(m["media"]["payload"])) == 3200 for _, m in media(wire16))


def test_a_wav_header_is_never_played_and_another_rate_is_never_kept() -> None:
    body = b"\x01\x00" * 100
    wav = b"RIFF" + struct.pack("<I", 36 + len(body)) + b"WAVEfmt " + struct.pack("<IHHIIHH", 16, 1, 1, 24000, 48000, 2, 16) + b"data" + struct.pack("<I", len(body)) + body
    assert strip_wav(wav) == body and strip_wav(body) == body

    class Tts16:
        sample_rate = 16000

        async def stream(self, text: str, language: str) -> Any:
            yield b"\x00\x00" * 1600

    cache = GreetingAudio()
    assert asyncio.run(cache.render(Tts16(), "te", "x")) is None and cache.get("te", "x") is None


@arun
async def test_the_warm_up_never_asks_the_voice_engine_after_start() -> None:
    """Owner, 6 Nov 2026: no voice credits to spare. Start-up renders ONE greeting (the line's language); the keep-warm ping only reads Exotel's account record."""
    from app.telephony import greeting_audio as G

    asked: list[str] = []
    warmed: list[int] = []

    class Tts:
        sample_rate = OUT_RATE

        async def stream(self, text: str, language: str) -> Any:
            asked.append(language)
            yield b"\x00\x00" * 2400

    class Calls:
        async def warm(self) -> None:
            warmed.append(1)
            if len(warmed) >= 3:
                stop.set()

    class Service:
        language, business, llm_choice, calls, store = "te", "Stack19", "auto", Calls(), None

    import app.telephony.inbound_routes as R

    stop = asyncio.Event()
    G.GREETINGS = GreetingAudio()
    original = R.phone_parts
    R.phone_parts = lambda *a, **k: (type("P", (), {"tts": Tts()})(), "m")
    original_every = G.KEEP_WARM_S
    G.KEEP_WARM_S = 0.01
    try:
        await asyncio.wait_for(G.start_warm(Service(), object(), stop=stop), 5)
    finally:
        R.phone_parts = original
        G.KEEP_WARM_S = original_every
    assert asked == ["te"], "one rendering at start, in the line's language, and no voice request while keeping warm"
    assert len(warmed) >= 3
