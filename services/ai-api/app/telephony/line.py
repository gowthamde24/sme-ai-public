"""The phone line as a socket (job phone-calls part 2): the same `Socket` the browser WebSocket is to the Live-talk session, so a call runs the same session loop, with a different wire.

  from the provider   media (any line rate) -> 16 kHz PCM frames for the recogniser;  dtmf -> {"type": "dtmf"};  stop or a closed wire -> close
  to the provider     the voice's 24 kHz audio -> the line rate, in 100 ms chunks (multiples of 320 bytes), never more than LEAD_S ahead of what has played (real-time pace, also for a greeting already in memory);  audio_stop -> `clear` (the barge-in);  audio_end -> the rest of the audio and a mark
  from the session    only `caption` lines with final=True are kept (the transcript); every other message of the browser protocol means nothing on a phone and is dropped
  barge-in            a browser decides when the caller starts talking over the assistant; on a phone the line does: sound above a threshold, for long enough, while our audio is still playing, becomes {"type": "barge_in",
                      "verify": true}, and the session's own verification (the recogniser must hear words) decides whether it was a person, a cough or the line's echo

Nothing is logged here and no audio is kept."""

# ruff: noqa: E501

from __future__ import annotations

import array
import asyncio
import logging
import time
from collections.abc import Awaitable, Callable
from contextlib import suppress
from typing import Any, Literal, Protocol

from app.browser_voice.audio import OUT_RATE
from app.conversation.endpointing import rms
from app.telephony import exotel
from app.telephony.pcm import Resampler, pad_to_multiple

Kind = Literal["text", "bytes", "close"]
STT_RATE = 16000
FRAME_BYTES = STT_RATE * 2 * 20 // 1000   # 20 ms at 16 kHz
OPEN_TIMEOUT_S = 10.0
# natural barge-in (owner, 6 Nov 2026): while we talk, the caller's sound is judged by its LENGTH. "haa", "hmm", "avunu", "sare", "ji", a cough: shorter than STOP_SPEECH_MS, ignored, we keep
# talking. Real speech longer than that: we stop, and the voice FADES out over FADE_MS (ending in a quiet moment between words when there is one) instead of a hard cut.
STOP_SPEECH_MS = 600
SPEECH_GAP_MS = 140    # a short dip inside speech does not end it
MIN_SOUND_MS = 100     # shorter than this is not logged at all (a click)
FADE_MS = 200
KEEP_SENT_S = 1.0      # how much of what we sent is kept, to fade from where the caller's ear is
log = logging.getLogger("app.telephony.line")
LEAD_S = 0.3   # how far ahead of the caller's ear we may send: a small cushion for the network, never a burst of the whole clip


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
        self.chunk = exotel.chunk_bytes(self.rate)
        self.start: exotel.Start | None = None
        self.transcript: list[dict[str, Any]] = []
        self.dtmf: list[str] = []
        self.bytes_in = 0
        self.bytes_out = 0
        self.chunks_out = 0
        self._q: asyncio.Queue[tuple[Kind, Any]] = asyncio.Queue()   # what the session reads: filled by the pump, and by us when we hang up
        self._pump_task: asyncio.Future[None] | None = None
        self._hang_up_after_audio_end: str | None = None
        self._seq = 0
        self._pending = bytearray()    # voice audio already at the line rate, waiting for a whole chunk
        self._down: Resampler | None = None
        self._up: Resampler | None = None
        self._play_until = 0.0         # when the provider will have played everything we sent
        self._began = clock()
        self._barge_threshold = barge_threshold
        self.stop_speech_ms = STOP_SPEECH_MS if barge_ms == 160 else barge_ms   # (barge_ms: tests may set their own)
        self._vad_buf = bytearray()
        self._talk_ms = 0          # the caller's sound while we talk, in this run
        self._gap_ms = 0
        self._stopped_run = False
        self._sent = bytearray()   # the last KEEP_SENT_S of audio we sent (line rate), to fade from
        self.interruptions: dict[str, int] = {"stopped": 0, "ignored": 0}
        self.whispers: list[str] = []   # the owner's notes for the AI during this call (app v4: Whisper); the session takes them before its next reply
        self.fade_ms: list[int] = []
        self._closed = False
        # how the call ended, for the end-of-call log (names and numbers only, 5 Nov 2026: the 11:57 UTC call ended 0.4 s after admission and the log could not say whether Exotel sent `stop` or dropped
        # the socket, nor whether any of our audio had gone out)
        self.end_how: str | None = None          # stop | socket_closed
        self.stop_reason: str | None = None      # Exotel's `stop.reason`, as a short closed word
        self.events: dict[str, int] = {}         # how many of each event name the provider sent
        self.first_out_s: float | None = None    # seconds from the line's start to our first audio chunk

    # ---- opening ---------------------------------------------------------------------------------------------------------------------------------

    async def open(self, timeout: float = OPEN_TIMEOUT_S) -> exotel.Start | None:
        """Read `connected` and `start`. None when the provider never says who is calling (the caller closes the socket)."""
        async def read() -> exotel.Start | None:
            while True:
                raw = await self._wire.receive_text()
                if raw is None:
                    self.end_how = "socket_closed"
                    return None
                name = exotel.event_name(raw)
                self.events[name] = self.events.get(name, 0) + 1
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
            self.chunk = exotel.chunk_bytes(self.rate)
            self._down = Resampler(OUT_RATE, self.rate)
            self._up = Resampler(self.rate, STT_RATE) if self.rate != STT_RATE else None
            self._pump_task = asyncio.ensure_future(self._pump())
        return start

    async def _pump(self) -> None:
        """The provider's messages, one at a time, into the queue the session reads."""
        while True:
            raw = await self._wire.receive_text()
            if raw is None:
                self.end_how = self.end_how or "socket_closed"
                self._finish("caller_hung_up")
                return
            name = exotel.event_name(raw)
            self.events[name] = self.events.get(name, 0) + 1
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
                self._end_sound_run()
                self._vad_buf.clear()
        elif isinstance(event, exotel.Dtmf):
            self.dtmf.append(event.digit)
            self._q.put_nowait(("text", {"type": "dtmf", "digit": event.digit}))
        elif isinstance(event, exotel.Stop):
            self.end_how = self.end_how or "stop"
            self.stop_reason = exotel.closed_word(event.reason)
            self._finish("caller_hung_up")

    def _watch_for_barge_in(self, pcm: bytes) -> None:
        """The caller's sound while we talk: a run of voiced 20 ms frames (short dips allowed). At STOP_SPEECH_MS it is an interruption: the session stops the voice (it fades, see `_fade_out`).
        A shorter run (a backchannel, a cough) changes nothing; both are logged with their length."""
        self._vad_buf += pcm
        while len(self._vad_buf) >= FRAME_BYTES:
            frame = bytes(self._vad_buf[:FRAME_BYTES])
            del self._vad_buf[:FRAME_BYTES]
            if rms(frame) >= self._barge_threshold:
                self._talk_ms += 20
                self._gap_ms = 0
                if self._talk_ms >= self.stop_speech_ms and not self._stopped_run:
                    self._stopped_run = True
                    self.interruptions["stopped"] += 1
                    log.info("phone_interruption decision=stopped speech_ms=%d", self._talk_ms)
                    self._q.put_nowait(("text", {"type": "barge_in", "verify": False}))
            elif self._talk_ms:
                self._gap_ms += 20
                if self._gap_ms >= SPEECH_GAP_MS:
                    self._end_sound_run()

    def _end_sound_run(self) -> None:
        if self._talk_ms >= MIN_SOUND_MS and not self._stopped_run:
            self.interruptions["ignored"] += 1
            log.info("phone_interruption decision=ignored speech_ms=%d", self._talk_ms)   # a backchannel or a noise: we kept talking
        self._talk_ms, self._gap_ms, self._stopped_run = 0, 0, False

    async def _fade_out(self) -> int:
        """Stop the voice the way a person does: what the provider had queued is cleared, and the next FADE_MS of the audio the caller was about to hear is sent again with the volume going down to
        silence, cut at a quiet moment between words when there is one in that window. Returns how long the fade is, in ms (0: nothing was playing)."""
        assert self.start is not None   # noqa: S101 - callers check
        now = self._clock()
        unplayed = max(0.0, self._play_until - now)
        self._pending.clear()
        await self._wire.send_text(exotel.clear_message(self.start.stream_sid))
        self._play_until = now
        if unplayed < 0.04 or not self._sent:
            return 0
        at = max(0, len(self._sent) - int(unplayed * self.rate) * 2)
        window = bytes(self._sent[at : at + int(self.rate * 0.25) * 2])
        frame = int(self.rate * 0.02) * 2
        cut = min(len(window), int(self.rate * FADE_MS / 1000) * 2)
        loudness = [rms(window[i : i + frame]) for i in range(0, len(window) - frame + 1, frame)]
        if loudness:
            mean = sum(loudness) / len(loudness)
            for k in range(3, len(loudness)):   # a quiet frame from 60 ms on: the end of a word
                if loudness[k] < 0.2 * mean:
                    cut = min(len(window), (k + 1) * frame)
                    break
        samples = array.array("h")
        samples.frombytes(window[: cut // 2 * 2])
        n = len(samples)
        for i in range(n):
            samples[i] = int(samples[i] * (1.0 - (i + 1) / n))
        tail = pad_to_multiple(samples.tobytes(), self.chunk)
        for i in range(0, len(tail), self.chunk):
            await self._emit(tail[i : i + self.chunk], keep=False)
        ms = round(n / self.rate * 1000)
        self.fade_ms.append(ms)
        log.info("phone_interruption fade_ms=%d", ms)
        return ms

    # ---- the Socket the session writes -----------------------------------------------------------------------------------------------------------

    async def send_bytes(self, data: bytes) -> None:
        if self.start is None or self._down is None or self._closed:
            return
        self._pending += self._down.process(data)
        while len(self._pending) >= self.chunk and not self._closed:
            part = bytes(self._pending[: self.chunk])
            del self._pending[: self.chunk]
            await self._emit(part)

    async def send_json(self, message: dict[str, Any]) -> None:
        kind = message.get("type")
        if kind == "caption" and message.get("final") and str(message.get("text", "")).strip():
            who = "caller" if message.get("who") == "user" else "assistant"
            self.transcript.append({"who": who, "text": str(message["text"]).strip(), "t": round(self._clock() - self._began, 1)})
        elif kind == "audio_stop":
            if self.start is not None and not self._closed:
                await self._fade_out()
            else:
                self._pending.clear()
                self._play_until = 0.0
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
            chunk = pad_to_multiple(bytes(self._pending), self.chunk)
            self._pending.clear()
            for i in range(0, len(chunk), self.chunk):
                await self._emit(chunk[i : i + self.chunk])
        if self._closed:
            return
        self._seq += 1
        await self._wire.send_text(exotel.mark_message(self.start.stream_sid, f"turn-{self._seq}"))

    async def _emit(self, chunk: bytes, *, keep: bool = True) -> None:
        assert self.start is not None   # noqa: S101 - callers check
        ahead = self._play_until - self._clock()
        if ahead > LEAD_S:   # real-time pace: wait until what was sent has (nearly) played
            await self._sleep(ahead - LEAD_S)
            if self._closed:
                return
        self.bytes_out += len(chunk)
        self.chunks_out += 1
        if keep:
            self._sent += chunk
            del self._sent[: max(0, len(self._sent) - int(self.rate * KEEP_SENT_S) * 2)]
        if self.first_out_s is None:
            self.first_out_s = self._clock() - self._began
        now = self._clock()
        self._play_until = max(self._play_until, now) + len(chunk) / 2 / self.rate
        await self._wire.send_text(exotel.media_message(self.start.stream_sid, chunk))

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
