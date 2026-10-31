"""The phone line as a socket (job phone-calls part 2): the same `Socket` the browser WebSocket is to the Live-talk session, so a call runs the same session loop, with a different wire.

  from the provider   media (any line rate) -> 16 kHz PCM frames for the recogniser;  dtmf -> {"type": "dtmf"};  stop or a closed wire -> close
  to the provider     the voice's 24 kHz audio -> the line rate, in chunks the provider accepts (multiples of 320 bytes, 3200 or more);  audio_stop -> `clear` (the barge-in);  audio_end -> the rest of the audio and a mark
  from the session    only `caption` lines with final=True are kept (the transcript); every other message of the browser protocol means nothing on a phone and is dropped
  barge-in            a browser decides when the caller starts talking over the assistant; on a phone the line does: sound above a threshold, for long enough, while our audio is still playing, becomes {"type": "barge_in",
                      "verify": true}, and the session's own verification (the recogniser must hear words) decides whether it was a person, a cough or the line's echo

Nothing is logged here and no audio is kept."""

# ruff: noqa: E501

from __future__ import annotations

import asyncio
import time
from collections.abc import Awaitable, Callable
from contextlib import suppress
from typing import Any, Literal, Protocol

from app.browser_voice.audio import OUT_RATE
from app.conversation.endpointing import EnergyEndpointer
from app.telephony import exotel
from app.telephony.pcm import Resampler, pad_to_multiple

Kind = Literal["text", "bytes", "close"]
STT_RATE = 16000
FRAME_BYTES = STT_RATE * 2 * 20 // 1000   # 20 ms at 16 kHz
OPEN_TIMEOUT_S = 10.0


class Wire(Protocol):
    """The provider's WebSocket, text frames only."""

    async def send_text(self, data: str) -> None: ...
    async def receive_text(self) -> str | None: ...   # None: the provider closed the connection


class PhoneLine:
    def __init__(self, wire: Wire, *, clock: Callable[[], float] = time.monotonic, sleep: Callable[[float], Awaitable[None]] = asyncio.sleep, barge_threshold: float = 700.0, barge_ms: int = 160,
                 line_rate: int | None = None, hang_up_wait_s: float = 10.0) -> None:
        self._wire, self._clock, self._sleep = wire, clock, sleep
        self.hang_up_wait_s = hang_up_wait_s
        self.end_reason: str | None = None       # why the call ended, in the words of phone_calls.end_reason: caller_hung_up | goodbye | silence | longest_call | stopped | error
        self._forced_rate = line_rate
        self.rate = line_rate or exotel.DEFAULT_RATE
        self.start: exotel.Start | None = None
        self.transcript: list[dict[str, Any]] = []
        self.dtmf: list[str] = []
        self.bytes_in = 0
        self.bytes_out = 0
        self._q: asyncio.Queue[tuple[Kind, Any]] = asyncio.Queue()   # what the session reads: filled by the pump, and by us when we hang up
        self._pump_task: asyncio.Future[None] | None = None
        self._hang_up_after_audio_end: str | None = None
        self._seq = 0
        self._pending = bytearray()    # voice audio already at the line rate, waiting for a whole chunk
        self._down: Resampler | None = None
        self._up: Resampler | None = None
        self._play_until = 0.0         # when the provider will have played everything we sent
        self._began = clock()
        self._vad = EnergyEndpointer(min_speech_ms=barge_ms, threshold=barge_threshold)
        self._vad_buf = bytearray()
        self._closed = False

    # ---- opening ---------------------------------------------------------------------------------------------------------------------------------

    async def open(self, timeout: float = OPEN_TIMEOUT_S) -> exotel.Start | None:
        """Read `connected` and `start`. None when the provider never says who is calling (the caller closes the socket)."""
        async def read() -> exotel.Start | None:
            while True:
                raw = await self._wire.receive_text()
                if raw is None:
                    return None
                event = exotel.parse(raw)
                if isinstance(event, exotel.Start):
                    return event
        try:
            start = await asyncio.wait_for(read(), timeout)
        except TimeoutError:
            return None
        if start is not None:
            self.start = start
            self.rate = self._forced_rate or start.sample_rate
            self._down = Resampler(OUT_RATE, self.rate)
            self._up = Resampler(self.rate, STT_RATE) if self.rate != STT_RATE else None
            self._pump_task = asyncio.ensure_future(self._pump())
        return start

    async def _pump(self) -> None:
        """The provider's messages, one at a time, into the queue the session reads."""
        while True:
            raw = await self._wire.receive_text()
            if raw is None:
                self._finish("caller_hung_up")
                return
            self._on_event(exotel.parse(raw))
            if self._closed:
                return

    def _finish(self, reason: str) -> None:
        if not self._closed:
            self._closed = True
            self.end_reason = self.end_reason or reason
            self._q.put_nowait(("close", None))

    async def close(self) -> None:
        if self._pump_task is not None and not self._pump_task.done():
            self._pump_task.cancel()
            with suppress(asyncio.CancelledError, Exception):
                await self._pump_task

    # ---- the Socket the session reads ------------------------------------------------------------------------------------------------------------

    async def receive(self) -> tuple[Kind, Any]:
        return await self._q.get()

    def _on_event(self, event: exotel.Event) -> None:
        if isinstance(event, exotel.Media):
            pcm = self._up.process(event.pcm) if self._up is not None else event.pcm
            if not pcm:
                return
            self.bytes_in += len(pcm)
            self._q.put_nowait(("bytes", pcm))
            if self._clock() < self._play_until:
                self._watch_for_barge_in(pcm)
            else:
                self._vad = EnergyEndpointer(min_speech_ms=self._vad.min_speech_ms, threshold=self._vad.threshold)
                self._vad_buf.clear()
        elif isinstance(event, exotel.Dtmf):
            self.dtmf.append(event.digit)
            self._q.put_nowait(("text", {"type": "dtmf", "digit": event.digit}))
        elif isinstance(event, exotel.Stop):
            self._finish("caller_hung_up")

    def _watch_for_barge_in(self, pcm: bytes) -> None:
        self._vad_buf += pcm
        while len(self._vad_buf) >= FRAME_BYTES:
            frame = bytes(self._vad_buf[:FRAME_BYTES])
            del self._vad_buf[:FRAME_BYTES]
            if "speech_start" in self._vad.feed(frame):
                self._q.put_nowait(("text", {"type": "barge_in", "verify": True}))

    # ---- the Socket the session writes -----------------------------------------------------------------------------------------------------------

    async def send_bytes(self, data: bytes) -> None:
        if self.start is None or self._down is None or self._closed:
            return
        self._pending += self._down.process(data)
        while len(self._pending) >= exotel.MIN_CHUNK:
            await self._emit(bytes(self._pending[: exotel.MIN_CHUNK]))
            del self._pending[: exotel.MIN_CHUNK]

    async def send_json(self, message: dict[str, Any]) -> None:
        kind = message.get("type")
        if kind == "caption" and message.get("final") and str(message.get("text", "")).strip():
            who = "caller" if message.get("who") == "user" else "assistant"
            self.transcript.append({"who": who, "text": str(message["text"]).strip(), "t": round(self._clock() - self._began, 1)})
        elif kind == "audio_stop":
            self._pending.clear()
            self._play_until = 0.0
            if self.start is not None and not self._closed:
                await self._wire.send_text(exotel.clear_message(self.start.stream_sid))
        elif kind == "audio_end":
            await self.flush()
            if self._hang_up_after_audio_end is not None:
                await self.hang_up(self._hang_up_after_audio_end)
        elif kind == "limit" and message.get("fatal"):
            await self.hang_up({"goodbye": "goodbye", "idle": "silence", "session": "longest_call", "daily_limit": "stopped"}.get(str(message.get("reason")), "stopped"))

    async def flush(self) -> None:
        """The voice has finished a turn: send the last part of its audio (silence-padded to a whole chunk) and ask the provider to tell us when it has played it."""
        if self.start is None or self._closed:
            return
        if self._pending:
            chunk = pad_to_multiple(bytes(self._pending), exotel.MIN_CHUNK)
            self._pending.clear()
            for i in range(0, len(chunk), exotel.MIN_CHUNK):
                await self._emit(chunk[i : i + exotel.MIN_CHUNK])
        self._seq += 1
        await self._wire.send_text(exotel.mark_message(self.start.stream_sid, f"turn-{self._seq}", self._seq))

    async def _emit(self, chunk: bytes) -> None:
        assert self.start is not None   # noqa: S101 - callers check
        self._seq += 1
        self.bytes_out += len(chunk)
        now = self._clock()
        self._play_until = max(self._play_until, now) + len(chunk) / 2 / self.rate
        await self._wire.send_text(exotel.media_message(self.start.stream_sid, chunk, self._seq))

    async def hang_up(self, reason: str) -> None:
        """We end the call: first let the provider finish playing what we sent (a goodbye cut in half is rude), then close. The session's reader sees the close and the session ends."""
        if self._closed:
            return
        await self.flush()
        waited = 0.0
        while self._clock() < self._play_until and waited < self.hang_up_wait_s:
            await self._sleep(0.05)
            waited += 0.05
        self._finish(reason)

    def hang_up_after_next_turn(self, reason: str) -> None:
        """The next thing the voice finishes saying is the last: when its audio ends we close the line (after it has played)."""
        self._hang_up_after_audio_end = reason

    def playing(self) -> bool:
        return self._clock() < self._play_until
