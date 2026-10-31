"""The audio plumbing of the browser voice (job DV): the frames the browser sends, and the line back to it.

FrameBus   holds the microphone frames (16 kHz, 16-bit mono) between turns. The recogniser reads them with `frames()`; after the assistant spoke or was interrupted `drop_before()` throws away what the browser sent
           meanwhile (our own voice coming back through the microphone), keeping a short pre-roll so the first syllable of an interrupting caller is not lost.
BrowserPlayout  the Playout of the conversation loop: audio goes to the browser as binary messages; `stop()` tells the browser to flush what it queued (it plays faster than we send, so most of a reply is already
           in ITS buffer when the caller barges in)."""

from __future__ import annotations

import asyncio
import time
from collections import deque
from collections.abc import AsyncIterator, Awaitable, Callable

IN_RATE = 16000
OUT_RATE = 24000
MAX_BUFFERED_FRAMES = 1500  # about 30 s of 20 ms frames: more than that means the loop is not reading, and the oldest frames go
PREROLL_S = 0.3
SLICE_S = 0.10   # a paced write goes out in slices of this much audio


class FrameBus:
    def __init__(self, clock: Callable[[], float] = time.monotonic) -> None:
        self._clock = clock
        self._frames: deque[tuple[float, bytes]] = deque()
        self._wake = asyncio.Event()
        self._closed = False
        self.bytes_in = 0
        self.speech_ended_at: float | None = None  # AudioSource: set by the session when the browser says the caller stopped (or by the recogniser's end-of-speech)

    def push(self, frame: bytes) -> None:
        if self._closed:
            return
        self.bytes_in += len(frame)
        self._frames.append((self._clock(), frame))
        while len(self._frames) > MAX_BUFFERED_FRAMES:
            self._frames.popleft()
        self._wake.set()

    def close(self) -> None:
        self._closed = True
        self._wake.set()

    def drop_before(self, age_s: float = PREROLL_S) -> int:
        """Throw away frames older than `age_s` seconds. Returns how many."""
        cutoff = self._clock() - age_s
        dropped = 0
        while self._frames and self._frames[0][0] < cutoff:
            self._frames.popleft()
            dropped += 1
        return dropped

    async def frames(self) -> AsyncIterator[bytes]:
        while True:
            if self._frames:
                yield self._frames.popleft()[1]
                continue
            if self._closed:
                return
            self._wake.clear()
            await self._wake.wait()


class BrowserPlayout:
    """`send_audio(pcm)` and `send_stop()` are the socket's two operations."""

    def __init__(
        self,
        send_audio: Callable[[bytes], Awaitable[None]],
        send_stop: Callable[[], Awaitable[None]],
        clock: Callable[[], float] = time.monotonic,
        *,
        ahead_s: float | None = None,
        sleep: Callable[[float], Awaitable[None]] = asyncio.sleep,
    ) -> None:
        self._send_audio, self._send_stop, self._clock = send_audio, send_stop, clock
        # audio pacing (owner decision, 31 Oct 2026): the server sends no more than `ahead_s` of audio ahead of what the browser has played. A barge-in stop then does not wait behind seconds of audio that
        # were already in the socket (the stop message arrived ~500 ms late), and what a pause cuts off is at most that much. None: send as fast as the voice produces it (the phone loop, the old behaviour).
        self._ahead_s, self._sleep = ahead_s, sleep
        self._until = 0.0  # when the browser will have played everything sent so far
        self.bytes_out = 0

    @property
    def active(self) -> bool:
        return self._clock() < self._until

    def unplayed_seconds(self) -> float:
        """How much of what was sent the browser has not played yet (what a stop would cut off)."""
        return max(0.0, self._until - self._clock())

    async def write(self, pcm: bytes) -> None:
        if self._ahead_s is None:
            now = self._clock()
            self._until = max(self._until, now) + len(pcm) / 2 / OUT_RATE
            self.bytes_out += len(pcm)
            await self._send_audio(pcm)
            return
        step = int(OUT_RATE * SLICE_S) * 2
        for i in range(0, len(pcm), step):
            part = pcm[i : i + step]
            while True:   # wait until the browser has played enough that this slice is at most `ahead_s` ahead of it
                room = (self._until - self._clock()) - self._ahead_s
                if room <= 0.001:   # (a millisecond of slack: waiting for less than the clock can tell would only spin)
                    break
                await self._sleep(min(room, 0.05))
            now = self._clock()
            self._until = max(self._until, now) + len(part) / 2 / OUT_RATE
            self.bytes_out += len(part)
            await self._send_audio(part)

    async def stop(self) -> None:
        self._until = 0.0
        await self._send_stop()
