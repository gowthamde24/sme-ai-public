"""Fake parts for the conversation loop (job natural-voice): no socket, no key, no model. Each fake has the delays a test asks for, so the CI latency eval can hold the loop to a timing budget per component and
prove the streaming property (the first audio comes before the model has finished) without a provider."""

# ruff: noqa: E501

from __future__ import annotations

import asyncio
import time
from collections.abc import AsyncIterator, Callable, Sequence
from dataclasses import dataclass, field

from app.conversation.endpointing import EnergyEndpointer
from app.conversation.parts import SttEvent

FRAME_MS = 20


def tone(ms: int, rate: int = 16000, amplitude: int = 4000) -> bytes:
    """A loud square wave: what the energy detector hears as speech."""
    n = rate * ms // 1000
    half = 20
    out = bytearray()
    for i in range(n):
        out += (amplitude if (i // half) % 2 == 0 else -amplitude).to_bytes(2, "little", signed=True)
    return bytes(out)


def silence(ms: int, rate: int = 16000) -> bytes:
    return bytes(rate * ms // 1000 * 2)


class FakeAudioSource:
    """`speech_ms` of sound then `trailing_ms` of quiet, in 20 ms frames; `pace` seconds between frames (0 = as fast as possible)."""

    def __init__(self, speech_ms: int = 800, trailing_ms: int = 600, pace: float = 0.0, clock: Callable[[], float] = time.perf_counter, lead_ms: int = 0) -> None:
        self.speech_ms, self.trailing_ms, self.pace, self.clock, self.lead_ms = speech_ms, trailing_ms, pace, clock, lead_ms
        self.speech_ended_at: float | None = None
        self.speech_started_at: float | None = None

    async def frames(self) -> AsyncIterator[bytes]:
        loud, quiet = tone(FRAME_MS), silence(FRAME_MS)
        for _ in range(self.lead_ms // FRAME_MS):
            yield quiet
            if self.pace:
                await asyncio.sleep(self.pace)
        for i in range(self.speech_ms // FRAME_MS):
            if i == 0:
                self.speech_started_at = self.clock()
            yield loud
            if self.pace:
                await asyncio.sleep(self.pace)
        self.speech_ended_at = self.clock()
        for _ in range(self.trailing_ms // FRAME_MS):
            yield quiet
            if self.pace:
                await asyncio.sleep(self.pace)


class FakeStt:
    """Runs the real energy detector over the frames (so endpointing is part of the test), then returns `text` after `final_delay` seconds."""

    sample_rate = 16000

    def __init__(self, text: str = "ఈ saree ధర ఎంత అండీ?", final_delay: float = 0.0, silence_ms: int = 300) -> None:
        self.text, self.final_delay, self.silence_ms = text, final_delay, silence_ms

    async def events(self, frames: AsyncIterator[bytes]) -> AsyncIterator[SttEvent]:
        endpointer = EnergyEndpointer(silence_ms=self.silence_ms)
        async for frame in frames:
            for name in endpointer.feed(frame):
                if name == "speech_start":
                    yield SttEvent("speech_start")
                else:
                    yield SttEvent("speech_end")
                    if self.final_delay:
                        await asyncio.sleep(self.final_delay)
                    yield SttEvent("final", self.text)
                    return


class FakeLlm:
    def __init__(self, pieces: Sequence[str] = ("హా అండీ, ", "ఆ saree రెండు వేల ఆరు వందలండీ. ", "Photos WhatsApp లో పంపనా?"), first_token_delay: float = 0.0, gap: float = 0.0) -> None:
        self.pieces, self.first_token_delay, self.gap = list(pieces), first_token_delay, gap
        self.models: list[str] = []
        self.finished = False
        self.cancelled = False

    async def stream(self, system: str, messages: list[dict[str, str]], model: str) -> AsyncIterator[str]:
        self.models.append(model)
        self.finished = self.cancelled = False
        try:
            await asyncio.sleep(self.first_token_delay)
            for i, piece in enumerate(self.pieces):
                if i and self.gap:
                    await asyncio.sleep(self.gap)
                yield piece
            self.finished = True
        except asyncio.CancelledError:
            self.cancelled = True
            raise


class FakeTts:
    sample_rate = 16000

    def __init__(self, first_audio_delay: float = 0.0, chunks: int = 3, chunk_gap: float = 0.0, chunk_ms: int = 100) -> None:
        self.first_audio_delay, self.chunks, self.chunk_gap, self.chunk_ms = first_audio_delay, chunks, chunk_gap, chunk_ms
        self.pieces: list[str] = []
        self.characters = 0
        self.prewarmed = 0

    async def prewarm(self) -> None:
        self.prewarmed += 1

    async def stream(self, text: str, language: str) -> AsyncIterator[bytes]:
        self.pieces.append(text)
        self.characters += len(text)
        await asyncio.sleep(self.first_audio_delay)
        for i in range(self.chunks):
            if i and self.chunk_gap:
                await asyncio.sleep(self.chunk_gap)
            yield silence(self.chunk_ms)


@dataclass
class FakePlayout:
    """Counts what reached the line. `active` is true while queued audio would still be playing (a real line plays in real time)."""

    clock: Callable[[], float] = time.perf_counter
    rate: int = 16000
    writes: list[tuple[float, int]] = field(default_factory=list)
    stopped_at: list[float] = field(default_factory=list)
    _busy_until: float = 0.0

    @property
    def active(self) -> bool:
        return self.clock() < self._busy_until

    def unplayed_seconds(self) -> float:
        return max(0.0, self._busy_until - self.clock())

    async def write(self, pcm: bytes) -> None:
        now = self.clock()
        self.writes.append((now, len(pcm)))
        self._busy_until = max(self._busy_until, now) + len(pcm) / 2 / self.rate

    async def stop(self) -> None:
        self._busy_until = 0.0
        self.stopped_at.append(self.clock())

    @property
    def bytes_written(self) -> int:
        return sum(n for _, n in self.writes)


@dataclass
class Segment:
    """One stretch of a caller's talk: what the recogniser writes for it, how long they speak, and the quiet that FOLLOWS before they go on (the last one's is the quiet until the end)."""

    text: str
    speech_ms: int = 800
    gap_ms: int = 600


class ScriptedStt:
    """A recogniser that follows a script on a time scale (live conversation eval, 31 Oct 2026). It behaves like the real one: speech_start, partials, speech_end after `silence_ms` of quiet, then a final and the
    stream ENDS; the next `events()` call (a new connection) carries on with the next segment, waiting for it to begin. When the script is over it waits (the caller says nothing more) until it is cancelled.
    `scale` shrinks every duration (0.05 = twenty times faster) so a 3 s thinking pause costs 150 ms in a test."""

    sample_rate = 16000

    def __init__(self, segments: Sequence[Segment], *, silence_ms: int = 350, scale: float = 0.05) -> None:
        self.segments, self.silence_ms, self.scale = list(segments), silence_ms, scale
        self.index = 0
        self._quiet_since: float | None = None   # when the last segment ended, on the loop's clock
        self.set_silence_calls: list[int] = []

    def set_silence_ms(self, ms: int) -> None:
        self.silence_ms = ms
        self.set_silence_calls.append(ms)

    def _s(self, ms: float) -> float:
        return ms / 1000.0 * self.scale

    async def events(self, frames: AsyncIterator[bytes]) -> AsyncIterator[SttEvent]:
        loop = asyncio.get_running_loop()
        if self.index >= len(self.segments):
            await asyncio.sleep(3600)
            return
        seg = self.segments[self.index]
        prev_gap = self.segments[self.index - 1].gap_ms if self.index else 0
        if self.index and self._quiet_since is not None:
            # they were quiet for the previous segment's gap; part of it has passed already (the silence that ended the last turn, the time spent deciding)
            waited = loop.time() - self._quiet_since
            await asyncio.sleep(max(0.0, self._s(prev_gap) - waited))
        yield SttEvent("speech_start")
        words = seg.text.split()
        steps = max(1, min(4, len(words)))
        for k in range(1, steps + 1):
            await asyncio.sleep(self._s(seg.speech_ms) / steps)
            yield SttEvent("partial", " ".join(words[: max(1, len(words) * k // steps)]))
        self._quiet_since = loop.time()
        await asyncio.sleep(self._s(self.silence_ms))
        yield SttEvent("speech_end")
        self.index += 1
        yield SttEvent("final", seg.text)
