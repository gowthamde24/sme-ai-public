"""One browser voice session (job DV): the browser's microphone in, the assistant's voice out, over one WebSocket. The socket is an interface (`Socket`), so everything here runs in tests with no network.

It drives the SAME `Conversation` as the phone loop (natural-voice, #153): streamed speech recognition -> the tiers of llm.py -> the first clause to the voice at once -> streamed audio. This file adds only what the browser needs:
the protocol (docs: ~/Desktop/stack19-jobs/contract-browser-voice.md), captions, the caps, the barge-in message, and the usage line. Messages carry ids, states and numbers; the log never carries audio or words."""

# ruff: noqa: E501

from __future__ import annotations

import asyncio
import logging
import time
import uuid
from collections.abc import Callable
from contextlib import suppress
from dataclasses import dataclass
from typing import Any, Literal, Protocol

from app.browser_voice.audio import IN_RATE, OUT_RATE, PREROLL_S, BrowserPlayout, FrameBus
from app.browser_voice.limits import Ledger, Limits, Usage, log_usage
from app.conversation.fillers import FillerBank
from app.conversation.parts import (
    Session,
    StreamingLlm,
    StreamingStt,
    StreamingTts,
    SttEvent,
    TurnTimings,
)
from app.conversation.pipeline import Conversation

log = logging.getLogger("app.browser_voice")

LANGUAGES = ("te", "en", "hi", "kn")
START_WITHIN_S = 10.0
IDLE_S = 60.0  # no final transcript for this long: the session ends (the browser keeps the mic open for nothing)
MAX_STT_FAILURES = 3
Kind = Literal["text", "bytes", "close"]


class Socket(Protocol):
    async def send_json(self, message: dict[str, Any]) -> None: ...
    async def send_bytes(self, data: bytes) -> None: ...
    async def receive(self) -> tuple[Kind, Any]: ...


@dataclass
class Parts:
    """What the route builds from settings and the workspace; tests pass fakes."""

    stt_for: Callable[[str], StreamingStt]
    tts: StreamingTts
    llm: StreamingLlm
    system_for: Callable[[str], str]
    greeting_for: Callable[[str], str | None]
    models: dict[str, str]
    voice_label: str = ""
    fillers: FillerBank | None = None


class CountingTts:
    """Counts the characters sent to each voice engine (for the cap and the usage line); everything else passes through to the real voice."""

    def __init__(self, inner: StreamingTts, usage: Usage, on_chars: Callable[[int], None]) -> None:
        self._inner, self._usage, self._on_chars = inner, usage, on_chars
        self.sample_rate = inner.sample_rate

    def __getattr__(self, name: str) -> Any:
        return getattr(self._inner, name)

    async def prewarm(self) -> None:
        await self._inner.prewarm()

    async def stream(self, text: str, language: str):  # type: ignore[no-untyped-def]
        counted = False
        async for chunk in self._inner.stream(text, language):
            if not counted:
                counted = True
                self._count(text)
            yield chunk
        if not counted:
            self._count(text)  # asked and answered with nothing: the provider still saw the characters

    def _count(self, text: str) -> None:
        engine = str(getattr(self._inner, "served_engine", "") or "unknown")
        self._usage.tts_chars[engine] += len(text)
        self._on_chars(len(text))


class VoiceSession:
    def __init__(
        self,
        socket: Socket,
        parts: Parts,
        *,
        tenant_id: uuid.UUID,
        user_id: uuid.UUID,
        language: str,
        limits: Limits,
        ledger: Ledger,
        usage: Usage,
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        self.socket, self.parts, self.tenant_id, self.user_id = socket, parts, tenant_id, user_id
        self.limits, self.ledger, self.usage, self.clock = limits, ledger, usage, clock
        self.session_id = uuid.uuid4()
        self.bus = FrameBus(clock)
        self.playout = BrowserPlayout(socket.send_bytes, self._send_stop, clock)
        self.language = language if language in LANGUAGES else "en"
        self.tts = CountingTts(parts.tts, usage, lambda n: ledger.add_chars(tenant_id, n))
        self.conv = Conversation(
            stt=parts.stt_for(self.language),
            llm=parts.llm,
            tts=self.tts,
            playout=self.playout,
            session=Session(system=parts.system_for(self.language), language=self.language),
            models=parts.models,  # type: ignore[arg-type]
            fillers=parts.fillers,
            voice=parts.voice_label,
            tools_available=True,
            on_stt=self._on_stt,
        )
        self._greeting: asyncio.Task[None] | None = None
        self._ended = "client"
        self._started = clock()
        self._accounted = 0.0
        self._closing = asyncio.Event()

    # ---- events to the browser -----------------------------------------------------------------------------------------------------------------

    async def _send(self, message: dict[str, Any]) -> None:
        with suppress(Exception):
            await self.socket.send_json(message)

    async def _send_stop(self) -> None:
        await self._send({"type": "audio_stop"})

    def emit(self, kind: str, data: dict[str, Any]) -> None:
        """Called from the tiers (any task): captions, sources, steps, errors. Fire and forget on the loop."""
        if kind == "step":
            message: dict[str, Any] = {"type": "state", "state": "thinking", "step": str(data.get("step", ""))}
        elif kind == "error":
            self.usage.errors += 1
            message = {"type": "error", "code": str(data.get("code", "error")), "message": str(data.get("message", "")), "fatal": False}
        elif kind == "caption":
            message = {"type": "caption", "who": data.get("who", "assistant"), "text": data.get("text", ""), "final": True, "spoken": bool(data.get("spoken", True))}
        else:
            message = {"type": kind, **data}
        asyncio.ensure_future(self._send(message))

    def _on_stt(self, ev: SttEvent) -> None:
        if ev.kind in ("partial", "final") and ev.text:
            asyncio.ensure_future(self._send({"type": "caption", "who": "user", "text": ev.text, "final": ev.kind == "final", "spoken": True}))
        if ev.kind == "speech_end":
            self.bus.speech_ended_at = self.clock()

    # ---- the session -----------------------------------------------------------------------------------------------------------------------------

    async def run(self) -> str:
        """Until the browser leaves, a cap is reached or something breaks. Returns why it ended."""
        await self._send(
            {
                "type": "ready",
                "session_id": str(self.session_id),
                "language": self.language,
                "audio_in": {"format": "pcm_s16le", "sample_rate": IN_RATE, "channels": 1},
                "audio_out": {"format": "pcm_s16le", "sample_rate": OUT_RATE, "channels": 1},
                "limits": {"session_seconds": self.limits.session_seconds, "day_seconds_left": self.ledger.seconds_left(self.tenant_id)},
            }
        )
        tasks = [asyncio.ensure_future(c) for c in (self._reader(), self._turns(), self._timer())]
        try:
            await asyncio.wait(tasks, return_when=asyncio.FIRST_COMPLETED)
        finally:
            self._closing.set()
            self.bus.close()
            for t in (self._greeting, *tasks):
                if t is not None and not t.done():
                    t.cancel()
            for t in (self._greeting, *tasks):
                if t is not None:
                    with suppress(asyncio.CancelledError, Exception):
                        await t
            self._account_time()
            log_usage(self.tenant_id, self.user_id, self.session_id, self.clock() - self._started, self.usage, self._ended)
        return self._ended

    async def _reader(self) -> None:
        """The browser's messages: audio frames, and the few controls."""
        while True:
            kind, payload = await self.socket.receive()
            if kind == "close":
                self._ended = "client"
                return
            if kind == "bytes":
                self.usage.stt_seconds += len(payload) / 2 / IN_RATE
                self.bus.push(payload)
                continue
            if not isinstance(payload, dict):
                continue
            what = payload.get("type")
            if what == "barge_in":
                await self._barge_in()
            elif what == "set_language" and payload.get("language") in LANGUAGES:
                self.language = str(payload["language"])
                self.conv.session.language = self.language
                self.conv.session.system = self.parts.system_for(self.language)
                self.conv.stt = self.parts.stt_for(self.language)
                await self._send({"type": "language", "language": self.language})
            elif what == "stop":
                self._ended = "client"
                return
            elif what == "ping":
                await self._send({"type": "pong"})

    async def _barge_in(self) -> None:
        """'The caller started speaking': stop the voice within ~200 ms. The line is stopped FIRST (the browser flushes what it queued), then the model and the voice are cancelled."""
        t0 = self.clock()
        if self._greeting is not None and not self._greeting.done():
            self._greeting.cancel()
        ms = await self.conv.interrupt()
        if ms is None and not self.playout.active:
            await self._send({"type": "interrupted", "ms": 0})
            return
        await self._send_stop()
        self.usage.interrupts += 1
        self.bus.drop_before(PREROLL_S)  # our own voice in the microphone is gone; the first syllable of the interrupting caller stays
        await self._send({"type": "interrupted", "ms": round((self.clock() - t0) * 1000)})

    async def _timer(self) -> None:
        """The caps: the session's length and the workspace's day."""
        while True:
            await asyncio.sleep(1.0)
            self._account_time()
            elapsed = self.clock() - self._started
            if elapsed >= self.limits.session_seconds:
                await self._limit("session")
                return
            if self.ledger.seconds_left(self.tenant_id) <= 0:
                await self._limit("daily_limit")
                return

    def _account_time(self) -> None:
        now = self.clock() - self._started
        self.ledger.add_seconds(self.tenant_id, max(0.0, now - self._accounted))
        self._accounted = now

    async def _limit(self, reason: str) -> None:
        self._ended = reason
        await self._send({"type": "limit", "reason": reason, "fatal": True})

    async def _set_state(self, state: str) -> None:
        await self._send({"type": "state", "state": state})

    async def _turns(self) -> None:
        failures = 0
        if await self._greet():
            self.bus.drop_before(0.0)  # the greeting came back through the microphone: not the caller's words
        while not self._closing.is_set():
            if self.ledger.chars_left(self.tenant_id) <= 0:
                await self._limit("daily_limit")
                return
            await self._set_state("listening")
            tm = TurnTimings()
            try:
                text = await asyncio.wait_for(self.conv.listen(self.bus, tm), timeout=IDLE_S)
            except TimeoutError:
                self._ended = "idle"
                await self._send({"type": "limit", "reason": "idle", "fatal": True})
                return
            except asyncio.CancelledError:
                raise
            except Exception as err:
                failures += 1
                self.usage.errors += 1
                log.warning("browser_voice_stt_failed code=%s", getattr(err, "code", type(err).__name__))
                await self._send({"type": "error", "code": "stt_unavailable", "message": "I could not hear that. Please try again.", "fatal": failures >= MAX_STT_FAILURES})
                if failures >= MAX_STT_FAILURES:
                    self._ended = "stt_unavailable"
                    return
                self.bus.drop_before(0.0)
                continue
            if not text:
                if self.bus._closed:  # noqa: SLF001 - the browser left
                    return
                continue
            failures = 0
            await self._set_state("thinking")
            self.usage.turns += 1
            tm.end_of_speech_at = self.bus.speech_ended_at
            await self._answer(text, tm)
            self.bus.drop_before(0.0 if not tm.interrupted else PREROLL_S)

    async def _answer(self, text: str, tm: TurnTimings) -> None:
        try:
            await self.conv.respond(text, tm)
        except asyncio.CancelledError:
            raise
        except Exception as err:
            self.usage.errors += 1
            log.warning("browser_voice_turn_failed code=%s", getattr(err, "code", type(err).__name__))
            await self._send({"type": "error", "code": getattr(err, "code", "turn_failed"), "message": "Something went wrong with that answer. Please ask again.", "fatal": False})
            return
        await self._send({"type": "audio_end", "turn": self.usage.turns})
        await self._send(
            {
                "type": "timings",
                "turn": self.usage.turns,
                "tier": tm.model_tier,
                "after_final_ms": None if tm.after_final_ms is None else round(tm.after_final_ms),
                "first_sound_ms": None if tm.first_sound_ms is None else round(tm.first_sound_ms),
                "engine": tm.tts_engine,
                "fallback": tm.tts_fallback,
                "interrupted": tm.interrupted,
            }
        )

    async def _greet(self) -> bool:
        text = self.parts.greeting_for(self.language) if self.limits.greeting else None
        if not text:
            return False
        await self._set_state("speaking")
        await self._send({"type": "caption", "who": "assistant", "text": text, "final": True, "spoken": True})

        async def speak() -> None:
            async for pcm in self.tts.stream(text, self.language):
                await self.playout.write(pcm)
            await self._send({"type": "audio_end", "turn": 0})

        self._greeting = asyncio.ensure_future(speak())
        with suppress(asyncio.CancelledError, Exception):
            await self._greeting
        return True
