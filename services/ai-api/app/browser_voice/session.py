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

from app.assistant.language import detect_owner_language
from app.browser_voice.audio import IN_RATE, OUT_RATE, PREROLL_S, BrowserPlayout, FrameBus
from app.browser_voice.limits import Ledger, Limits, Usage, log_usage
from app.conversation.fillers import BROWSER_FILLER_AFTER_MS, FillerBank
from app.conversation.parts import (
    Session,
    StreamingLlm,
    StreamingStt,
    StreamingTts,
    SttEvent,
    TurnTimings,
)
from app.conversation.pipeline import Conversation
from app.conversation.router import Tier
from app.turns.intent import Kind as TurnKind
from app.turns.intent import classify, is_yes_no, normalise

log = logging.getLogger("app.browser_voice")

LANGUAGES = ("te", "en", "hi", "kn")
START_WITHIN_S = 10.0
IDLE_S = 1800.0  # no final transcript for this long: the session ends. The owner's chat stays open until they close it; this only stops a tab left open for hours
MAX_STT_FAILURES = 3
FLUSH_EVERY_S = 15.0
TRANSCRIPT_EVERY_S = 0.25   # an interim transcript at most this often (the newest of the recogniser's partials)
_NO_WORDS = frozenset({"no", "nope", "n", "cancel", "don't", "dont", "stop", "kaadu", "nahi", "nahin", "illa", "కాదు", "వద్దు", "नहीं", "नही", "मत", "ಇಲ್ಲ", "ಬೇಡ"})
SAID = {
    "yes": {"en": "Okay, I will go ahead.", "te": "సరే, కొనసాగిస్తాను.", "hi": "ठीक है, मैं आगे बढ़ता हूँ।", "kn": "ಸರಿ, ಮುಂದುವರಿಯುತ್ತೇನೆ."},
    "no": {"en": "Okay, I will not do it.", "te": "సరే, చేయను.", "hi": "ठीक है, मैं नहीं करूँगा।", "kn": "ಸರಿ, ಮಾಡುವುದಿಲ್ಲ."},
}
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
    voice_for: Callable[[str], str] = lambda language: ""  # the catalogue voice id that speaks in a language (the filler bank is keyed by it)
    fillers: FillerBank | None = None
    # job EA: the owner's yes or no to a plan the assistant proposed -> {action_id, status, task}; raises ApiError (mfa_required, action_expired, ...). None: the socket cannot confirm.
    confirm: Callable[[uuid.UUID, str], dict[str, Any]] | None = None


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
        token: str = "",
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        self.socket, self.parts, self.tenant_id, self.user_id = socket, parts, tenant_id, user_id
        self.limits, self.ledger, self.usage, self.clock = limits, ledger, usage, clock
        self._token = token  # the member's own token, to write the day's numbers back (empty: memory only)
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
            voice=parts.voice_for,
            filler_after_ms=BROWSER_FILLER_AFTER_MS,  # Ask can take seconds: after 700 ms of nothing a short pre-rendered line is said
            tools_available=True,
            on_stt=self._on_stt,
            router=self._route,
        )
        self._previous: TurnKind | None = None
        self.pending_action: uuid.UUID | None = None
        self._utterance_at: float | None = None
        self._tr_seq = 0
        self._tr_sent_at = 0.0
        self._tr_text = ""
        self._tr_pending: str | None = None
        self._tr_flush: asyncio.Future[None] | None = None
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
            if data.get("spoken_text"):
                message["spoken_text"] = str(data["spoken_text"])   # what the voice says of a longer, written caption
        else:
            message = {"type": kind, **data}
            if kind == "confirm_action" and str(data.get("status", "proposed")) == "proposed":
                with suppress(ValueError):
                    self.pending_action = uuid.UUID(str(data.get("action_id")))
        asyncio.ensure_future(self._send(message))

    def _on_stt(self, ev: SttEvent) -> None:
        if ev.kind in ("partial", "final") and ev.text:
            asyncio.ensure_future(self._send({"type": "caption", "who": "user", "text": ev.text, "final": ev.kind == "final", "spoken": True}))
            self._transcript(ev.kind == "final", ev.text)
        if ev.kind == "speech_end":
            self.bus.speech_ended_at = self.clock()

    # ---- what the person is saying, live (job EA): an interim transcript at most every 250 ms, then one final ------------------------------------

    def _transcript(self, final: bool, text: str) -> None:
        now = self.clock()
        if self._utterance_at is None:
            self._utterance_at = now
        if final:
            self._cancel_flush()
            self._send_transcript(text, True, now)
            self._utterance_at, self._tr_text, self._tr_pending, self._tr_sent_at = None, "", None, 0.0   # the next utterance starts its own window
            return
        if text == self._tr_text:
            return   # never the same text twice
        wait = self._tr_sent_at + TRANSCRIPT_EVERY_S - now
        if wait <= 0:
            self._cancel_flush()
            self._send_transcript(text, False, now)
            return
        self._tr_pending = text   # the newest partial wins; it goes out when the window is over
        if self._tr_flush is None or self._tr_flush.done():
            self._tr_flush = asyncio.ensure_future(self._flush_transcript(wait))

    def _cancel_flush(self) -> None:
        if self._tr_flush is not None and not self._tr_flush.done():
            self._tr_flush.cancel()
        self._tr_flush = None

    async def _flush_transcript(self, wait: float) -> None:
        await asyncio.sleep(wait)
        text, self._tr_pending = self._tr_pending, None
        if text and text != self._tr_text:
            self._send_transcript(text, False, self.clock())

    def _send_transcript(self, text: str, final: bool, now: float) -> None:
        self._tr_seq += 1
        self._tr_text, self._tr_sent_at = text, now
        started = self._utterance_at if self._utterance_at is not None else now
        asyncio.ensure_future(self._send({"type": "transcript", "text": text, "final": final, "seq": self._tr_seq, "t_ms": round((now - started) * 1000)}))

    # ---- the router: the SAME one as the written chat (job EA) -------------------------------------------------------------------------------------

    def _route(self, text: str, tools_available: bool, turn_number: int) -> Tier:
        """Small talk and general help are answered by the fast model, spoken; a question about the records and an instruction go to the tool path / the planner (which decides again, the same way)."""
        intent = classify(text, self._previous)
        self._previous = intent.kind
        asyncio.ensure_future(self._send({"type": "intent", "kind": intent.kind}))
        return "fast" if intent.kind in ("smalltalk", "general") else "strong"

    # ---- the owner's yes or no to a plan ------------------------------------------------------------------------------------------------------------

    async def _confirm(self, action_id: uuid.UUID, decision: str) -> None:
        confirm = self.parts.confirm
        if confirm is None or decision not in ("yes", "no"):
            await self._send({"type": "error", "code": "not_available", "message": "I cannot do that here. Use the buttons in the app.", "fatal": False})
            return
        try:
            out = await asyncio.to_thread(confirm, action_id, decision)
        except Exception as err:   # ApiError: the code and the plain words are the API's own (mfa_required, action_expired, action_state, not found)
            code = str(getattr(err, "code", "turn_failed"))
            await self._send({"type": "error", "code": code, "message": str(getattr(err, "message", "")) or "I could not do that.", "fatal": False})
            if code in ("action_expired", "action_state", "not_found"):
                self.pending_action = None
            return
        self.pending_action = None
        await self._send({"type": "action", "action_id": str(action_id), "status": out.get("status"), "task": out.get("task")})

    def _polarity(self, text: str) -> str:
        words = set(normalise(text).replace(".", " ").replace("!", " ").split())
        return "no" if words & _NO_WORDS else "yes"

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
            if self._token:
                with suppress(Exception):
                    await asyncio.wait_for(asyncio.to_thread(self.ledger.flush, self.tenant_id, self._token), timeout=5.0)
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
                await self._set_language(str(payload["language"]))
            elif what == "confirm":
                try:
                    await self._confirm(uuid.UUID(str(payload.get("action_id"))), str(payload.get("decision")))
                except ValueError:
                    await self._send({"type": "error", "code": "validation_error", "message": "That plan id is not valid.", "fatal": False})
            elif what == "stop":
                self._ended = "client"
                return
            elif what == "ping":
                await self._send({"type": "pong"})

    async def _set_language(self, language: str) -> None:
        """The language the assistant listens for, answers in and speaks (its voice, its fillers, the pronunciation map) from now on."""
        self.language = language
        self.conv.session.language = language
        self.conv.session.system = self.parts.system_for(language)
        self.conv.stt = self.parts.stt_for(language)
        await self._send({"type": "language", "language": language})

    async def _follow_language(self, text: str) -> None:
        """The reply is in the language of the owner's LAST turn (also romanised Telugu): the voice, the filler and the answer all follow it. A short English word ("ok") does not switch a Telugu chat back."""
        found = detect_owner_language(text)
        if found == self.language or found not in LANGUAGES:
            return
        if found == "en" and len(text.split()) < 3:
            return
        await self._set_language(found)

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
        last_flush = self.clock()
        while True:
            await asyncio.sleep(1.0)
            self._account_time()
            if self._token and self.clock() - last_flush >= FLUSH_EVERY_S:
                last_flush = self.clock()
                await asyncio.to_thread(self.ledger.flush, self.tenant_id, self._token)  # other instances see this session's use within seconds
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
            if self.pending_action is not None and is_yes_no(text):
                decision = self._polarity(text)
                await self._confirm(self.pending_action, decision)
                await self._say(SAID[decision].get(self.language, SAID[decision]["en"]))
                continue
            await self._follow_language(text)
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

    async def _say(self, text: str) -> None:
        """A short fixed line, spoken and captioned (the answer to a spoken yes or no)."""
        await self._set_state("speaking")
        await self._send({"type": "caption", "who": "assistant", "text": text, "final": True, "spoken": True})
        with suppress(asyncio.CancelledError, Exception):
            async for pcm in self.tts.stream(text, self.language):
                await self.playout.write(pcm)
        await self._send({"type": "audio_end", "turn": self.usage.turns})

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
