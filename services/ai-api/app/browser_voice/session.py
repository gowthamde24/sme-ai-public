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
from app.conversation.endpointing import endpoint_ms
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
from app.conversation.router import Tier
from app.conversation.turntaking import (
    CHECK_IN,
    GOODBYE_QUIET,
    GOODBYE_REPLY,
    RESUME_AFTER_MS,
    classify_interruption,
    is_goodbye,
    silence_action,
    soft_warning_due,
)
from app.turns.intent import Kind as TurnKind
from app.turns.intent import classify, is_yes_no, normalise

log = logging.getLogger("app.browser_voice")

LANGUAGES = ("te", "en", "hi", "kn", "ta", "ml")
START_WITHIN_S = 10.0
MODES = ("live", "dictate")
LIVE_IDLE_S = 30.0   # live talk: no speech for this long and the session ends (`limit` idle); it listens again after every reply until then
DICTATE_MAX_S = 60.0   # dictate: words only; the whole session never runs longer than this
DICTATE_SILENCE_S = 4.0   # dictate: this long without a sound after a final transcript ends it (`limit` idle)
MAX_STT_FAILURES = 3
FLUSH_EVERY_S = 15.0
TRANSCRIPT_EVERY_S = 0.25   # an interim transcript at most this often (the newest of the recogniser's partials)
_NO_WORDS = frozenset({"no", "nope", "n", "cancel", "don't", "dont", "stop", "kaadu", "nahi", "nahin", "illa", "కాదు", "వద్దు", "नहीं", "नही", "मत", "ಇಲ್ಲ", "ಬೇಡ"})
SAID = {
    "yes": {"en": "Okay, I will go ahead.", "te": "సరే, కొనసాగిస్తాను.", "hi": "ठीक है, मैं आगे बढ़ता हूँ।", "kn": "ಸರಿ, ಮುಂದುವರಿಯುತ್ತೇನೆ.", "ta": "சரி, தொடர்கிறேன்.", "ml": "ശരി, തുടരാം."},
    "no": {"en": "Okay, I will not do it.", "te": "సరే, చేయను.", "hi": "ठीक है, मैं नहीं करूँगा।", "kn": "ಸರಿ, ಮಾಡುವುದಿಲ್ಲ.", "ta": "சரி, செய்யமாட்டேன்.", "ml": "ശരി, ചെയ്യില്ല."},
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
    voice_name: Callable[[str], str] = lambda language: ""  # its name for the screen ("Ramya")
    refresh: Callable[[], None] | None = None   # reads the workspace's voice settings again (called at the start of every turn, so a change in Settings speaks from the next turn)
    fillers: FillerBank | None = None
    # job EA: the owner's yes or no to a plan the assistant proposed -> {action_id, status, task}; raises ApiError (mfa_required, action_expired, ...). None: the socket cannot confirm.
    confirm: Callable[[uuid.UUID, str], dict[str, Any]] | None = None
    # live talk is one thread with the typed chat: every turn goes through the written chat's turn (router, history, storage) instead of the voice's own fast model
    one_thread: bool = False
    # casual turns (small talk, general help) go to the fast tier, which writes into the same thread; business questions and actions keep the written chat's turn
    fast_smalltalk: bool = False
    # the language pill (owner, 31 Oct 2026): None = auto (the session follows the caller's own language); a language = PINNED: the recogniser, the reply, the voice and the fillers stay in it
    pinned_language: Callable[[], str | None] = lambda: None
    set_pin: Callable[[str | None], None] = lambda language: None
    conversation_id: str | None = None   # the thread (sent to the browser in `ready`)


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
        mode: str = "live",
        idle_s: float | None = None,
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        self.socket, self.parts, self.tenant_id, self.user_id = socket, parts, tenant_id, user_id
        self.limits, self.ledger, self.usage, self.clock = limits, ledger, usage, clock
        self._token = token  # the member's own token, to write the day's numbers back (empty: memory only)
        self.mode = mode if mode in MODES else "live"
        self.idle_s = LIVE_IDLE_S if idle_s is None else idle_s
        self._last_sound = clock()   # dictate: the last time the recogniser heard anything
        self.session_id = uuid.uuid4()
        self.bus = FrameBus(clock)
        self.playout = BrowserPlayout(socket.send_bytes, self._send_stop, clock, ahead_s=limits.audio_ahead_ms / 1000.0 if limits.audio_ahead_ms > 0 else None)
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
            voice=self._filler_voice,
            filler_after_ms=limits.filler_after_ms,
            filler_on_casual=limits.filler_on_casual,
            # (Ask can take seconds: a data turn whose answer is not audible after filler_after_ms gets a short pre-rendered line; small talk never)
            tools_available=True,
            on_stt=self._on_stt,
            router=self._route,
            semantic_turns=limits.semantic_turns,
            can_speculate=self._can_speculate if limits.speculative else None,
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
        self._turn_voice: tuple[str, str] | None = None   # (voice id, language) of the turn in progress: every chunk of the turn is this voice
        self._turn_active = False
        self._pending_language: str | None = None
        self._ended = "client"
        self._started = clock()
        self._accounted = 0.0
        self._closing = asyncio.Event()
        self._carry: str | None = None   # what the caller said while we spoke and it turned out to be a real interruption: their next turn, already heard
        self._judging: asyncio.Task[None] | None = None
        self._warned = False
        self._checked_in = False

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
        self._last_sound = self.clock()
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

    def _can_speculate(self, text: str) -> bool:
        """May the model be started on these words before they are final? Only small talk and general help on the fast tier (a pure check: nothing is sent to the screen and the router's memory is not touched)."""
        return bool(self.parts.fast_smalltalk) and classify(text, self._previous).kind in ("smalltalk", "general") and not self.pending_action

    # ---- the router: the SAME one as the written chat (job EA) -------------------------------------------------------------------------------------

    def _route(self, text: str, tools_available: bool, turn_number: int) -> Tier:
        """Small talk and general help are answered by the fast model, spoken; a question about the records and an instruction go to the tool path / the planner (which decides again, the same way)."""
        intent = classify(text, self._previous)
        self._previous = intent.kind
        asyncio.ensure_future(self._send({"type": "intent", "kind": intent.kind}))
        if self.parts.one_thread and not self.parts.fast_smalltalk:
            return "strong"   # the written chat's own turn decides again and keeps the thread: small talk, general help, records and plans in ONE conversation
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
                "mode": self.mode,
                "pinned": self.parts.pinned_language() is not None,
                **({"conversation_id": self.parts.conversation_id} if self.parts.conversation_id else {}),
            }
        )
        tasks = [asyncio.ensure_future(c) for c in (self._reader(), self._dictate() if self.mode == "dictate" else self._turns(), self._timer())]
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
                await self._barge_in(verify=bool(payload.get("verify")) and self.limits.verify_barge_in)
            elif what == "set_language" and (payload.get("language") in LANGUAGES or payload.get("language") == "auto"):
                if self._turn_active:
                    self._pending_language = str(payload["language"])   # a turn never changes voice or language half way: it takes effect at the next turn
                else:
                    await self._choose_language(str(payload["language"]))
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

    async def _choose_language(self, choice: str) -> None:
        """The language pill changed (owner, 31 Oct 2026). A language PINS the session to it (the recogniser writes it, the reply, the voice and the fillers are in it, nothing the caller says moves it); "auto" lets the session
        follow the caller again from the next turn (the recogniser is opened on auto, the language stays as it is until the caller's own words change it)."""
        if choice == "auto":
            self.parts.set_pin(None)
            self.conv.stt = self.parts.stt_for(self.language)
            await self._send({"type": "language", "language": self.language, "pinned": False})
            return
        self.parts.set_pin(choice)
        await self._set_language(choice)

    async def _set_language(self, language: str) -> None:
        """The language the assistant listens for, answers in and speaks (its voice, its fillers, the pronunciation map) from now on."""
        self.language = language
        self.conv.session.language = language
        self.conv.session.system = self.parts.system_for(language)
        self.conv.stt = self.parts.stt_for(language)
        await self._send({"type": "language", "language": language, "pinned": self.parts.pinned_language() is not None})

    async def _refresh_voices(self) -> None:
        if self.parts.refresh is not None:
            with suppress(Exception):
                await asyncio.to_thread(self.parts.refresh)   # the settings are read again; a failure keeps the voices of the last turn

    def _filler_voice(self, language: str) -> str:
        """The voice the filler bank is asked for: the turn's own voice only. Another voice or language than the turn's gets NO filler (the orb shows "thinking"), never a different voice."""
        voice = self.parts.voice_for(language)
        if self._turn_voice is None:
            return voice
        return voice if (voice, language) == self._turn_voice else ""

    async def _announce_voice(self, turn: int) -> None:
        """Before the first audio chunk of a turn (the greeting and the filler included): which voice speaks it. One voice and one language for the whole turn."""
        voice, language = self.parts.voice_for(self.language), self.language
        self._turn_voice = (voice, language)
        await self._send({"type": "voice", "turn": turn, "voice_id": voice, "language": language, "name": self.parts.voice_name(language)})

    async def _audio_end(self, turn: int) -> None:
        voice, language = self._turn_voice or (self.parts.voice_for(self.language), self.language)
        await self._send({"type": "audio_end", "turn": turn, "voice_id": voice, "language": language})

    async def _end_turn(self) -> None:
        self._turn_active = False
        if self._pending_language is not None:
            language, self._pending_language = self._pending_language, None
            await self._choose_language(language)

    async def _follow_language(self, text: str) -> None:
        """The reply is in the language of the owner's LAST turn (also romanised Telugu): the voice, the filler and the answer all follow it. A short English word ("ok") does not switch a Telugu chat back."""
        if self.parts.pinned_language() is not None:
            return   # the person chose the language on the assistant bar: nothing the caller says changes it
        found = detect_owner_language(text)
        if found == self.language or found not in LANGUAGES:
            return
        if found == "en" and len(text.split()) < 3:
            return
        await self._set_language(found)

    async def _barge_in(self, verify: bool = False) -> None:
        """'The caller started speaking': stop the voice within ~200 ms. Without `verify` it is final: the line is stopped FIRST (the browser flushes what it queued), then the model and the voice are cancelled.
        With `verify` (standard B1/B2) the line is only PAUSED and the sound is judged: a cough, a click, a TV or a "hmm" lets the reply go on where it stopped; real words end it."""
        t0 = self.clock()
        if self._greeting is not None and not self._greeting.done():
            self._greeting.cancel()
            verify = False
        if verify and self.conv.speaking and not self.conv.is_paused:
            ms = await self.conv.pause()
            if ms is not None:
                await self._send({"type": "state", "state": "paused"})
                await self._send({"type": "paused", "ms": round(ms)})
                self._judging = asyncio.ensure_future(self._judge_interruption())
                return
        await self._hard_stop(t0)

    async def _hard_stop(self, t0: float) -> None:
        ms = await self.conv.interrupt()
        if ms is None and not self.playout.active:
            await self._send({"type": "interrupted", "ms": 0})
            return
        await self._send_stop()
        self.usage.interrupts += 1
        self.bus.drop_before(PREROLL_S)  # our own voice in the microphone is gone; the first syllable of the interrupting caller stays
        spoken = self.conv._current.spoken_text if self.conv._current is not None else ""  # noqa: SLF001
        await self._send({"type": "interrupted", "ms": round((self.clock() - t0) * 1000), "spoken": spoken})

    async def _judge_interruption(self) -> None:
        """The line is paused for a sound. Listen to what it was: words (two real ones, or a longer speech) end the reply and become the caller's next turn; "hmm", "haan", "ok", a cough or a TV let it go on after
        ~1.8 s of quiet (B2/B4)."""
        t0 = self.clock()
        tm = TurnTimings()
        text: str | None = None
        try:
            text = await asyncio.wait_for(self.conv.listen(self.bus, tm, interrupt=False, hold=False), timeout=RESUME_AFTER_MS / 1000.0 + 1.5)
        except TimeoutError:
            text = None
        except asyncio.CancelledError:
            raise
        except Exception as err:
            log.warning("browser_voice_judge_failed code=%s", getattr(err, "code", type(err).__name__))
        speech_ms = max(0, int((tm.eot_at - tm.speech_start_at) * 1000) - endpoint_ms(self.language)) if tm.eot_at is not None and tm.speech_start_at is not None else 0   # (the recogniser's end comes after the quiet that ends a turn)
        kind = classify_interruption(speech_ms, text)
        if kind == "barge_in":
            self._carry = text
            await self._hard_stop(t0)
            return
        quiet = RESUME_AFTER_MS / 1000.0 - (self.clock() - (tm.eot_at or t0))
        if quiet > 0:
            await asyncio.sleep(quiet)   # picks up again only after the line has been quiet for a moment
        if await self.conv.resume():
            await self._send({"type": "state", "state": "speaking"})
            await self._send({"type": "resumed", "after": kind})

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
            if soft_warning_due(elapsed, self.limits.session_seconds, self._warned):
                self._warned = True
                await self._send({"type": "notice", "code": "session_ending", "seconds_left": round(self.limits.session_seconds - elapsed)})
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
                carried, self._carry = self._carry, None
                text = carried if carried is not None else await self._listen_for_turn(tm)   # (carried: they spoke over us and it was a real interruption: already their turn)
            except TimeoutError:
                await self._end_for_silence()
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
            self._checked_in = False
            if is_goodbye(text):
                await self._say_goodbye(text)
                return
            if self.pending_action is not None and is_yes_no(text):
                decision = self._polarity(text)
                await self._confirm(self.pending_action, decision)
                self._turn_active = True
                try:
                    await self._refresh_voices()
                    await self._announce_voice(self.usage.turns)
                    await self._say(SAID[decision].get(self.language, SAID[decision]["en"]))
                finally:
                    await self._end_turn()
                continue
            self._turn_active = True
            try:
                await self._follow_language(text)
                await self._set_state("thinking")
                self.usage.turns += 1
                await self._refresh_voices()
                await self._announce_voice(self.usage.turns)
                tm.end_of_speech_at = self.bus.speech_ended_at
                await self._answer(text, tm)
            finally:
                await self._end_turn()
            self.bus.drop_before(0.0 if not tm.interrupted else PREROLL_S)

    async def _listen_for_turn(self, tm: TurnTimings) -> str | None:
        """Listen for the caller's turn. When the line has been quiet for ~8 s one gentle check-in; the end comes at the idle limit (standard D3)."""
        started = self.clock()
        self._last_sound = started
        task = asyncio.ensure_future(self.conv.listen(self.bus, tm))
        try:
            while True:
                done, _ = await asyncio.wait({task}, timeout=1.0)
                if done:
                    return task.result()
                quiet = self.clock() - max(started, self._last_sound)
                action = silence_action(quiet, self._checked_in) if self.idle_s >= 15 else ("end" if quiet >= self.idle_s else "wait")
                if action == "end":
                    raise TimeoutError
                if action == "check_in":
                    self._checked_in = True
                    await self._say(CHECK_IN.get(self.language, CHECK_IN["en"]))
                    self.bus.drop_before(0.0)   # our own question came back through the microphone
                    started = self.clock() - 8.0   # (the quiet clock goes on from where it was: the end still comes at ~30 s in all)
                    self._last_sound = self.clock() - 8.0
        finally:
            if not task.done():
                task.cancel()
                with suppress(asyncio.CancelledError, Exception):
                    await task

    async def _end_for_silence(self) -> None:
        self._ended = "idle"
        await self._say(GOODBYE_QUIET.get(self.language, GOODBYE_QUIET["en"]))
        await self._send({"type": "limit", "reason": "idle", "fatal": True})

    async def _say_goodbye(self, text: str) -> None:
        """'bye', 'thank you, that's all', 'ఇంక చాలు': a short goodbye in their language, then the microphone stops at once (D4)."""
        self._turn_active = True
        try:
            await self._follow_language(text)
            await self._say(GOODBYE_REPLY.get(self.language, GOODBYE_REPLY["en"]))
        finally:
            await self._end_turn()
        self._ended = "goodbye"
        await self._send({"type": "limit", "reason": "goodbye", "fatal": True})

    async def _dictate(self) -> None:
        """Dictate: the same recogniser (language auto, verbatim), words only. The live `transcript` partials and the final ones go to the browser to fill the text box; the assistant is NEVER called, nothing is spoken, no turn is stored.
        It ends with `limit` idle after DICTATE_MAX_S in all, or DICTATE_SILENCE_S without a sound after a final transcript (or on `stop`)."""
        failures = 0
        finals = 0
        began = self.clock()
        self._last_sound = began
        await self._set_state("listening")
        while not self._closing.is_set():
            tm = TurnTimings()
            listening = asyncio.ensure_future(self.conv.listen(self.bus, tm))
            try:
                while not listening.done():
                    await asyncio.wait({listening}, timeout=0.25)
                    now = self.clock()
                    if now - began >= DICTATE_MAX_S or (finals and now - self._last_sound >= DICTATE_SILENCE_S):
                        listening.cancel()
                        with suppress(asyncio.CancelledError, Exception):
                            await listening
                        self._ended = "idle"
                        await self._send({"type": "limit", "reason": "idle", "fatal": True})
                        return
                text = listening.result()
            except asyncio.CancelledError:
                listening.cancel()
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
            finals += 1
            self._last_sound = self.clock()

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
        await self._audio_end(self.usage.turns)
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
                "speculative": tm.speculative,
                "filler": tm.filler_played,
                "held_ms": tm.held_ms,
            }
        )

    async def _say(self, text: str) -> None:
        """A short fixed line, spoken and captioned (the answer to a spoken yes or no)."""
        await self._set_state("speaking")
        await self._send({"type": "caption", "who": "assistant", "text": text, "final": True, "spoken": True})
        with suppress(asyncio.CancelledError, Exception):
            async for pcm in self.tts.stream(text, self.language):
                await self.playout.write(pcm)
        await self._audio_end(self.usage.turns)

    async def _greet(self) -> bool:
        text = self.parts.greeting_for(self.language) if self.limits.greeting else None
        if not text:
            return False
        await self._set_state("speaking")
        await self._refresh_voices()
        await self._announce_voice(0)
        await self._send({"type": "caption", "who": "assistant", "text": text, "final": True, "spoken": True})

        async def speak() -> None:
            async for pcm in self.tts.stream(text, self.language):
                await self.playout.write(pcm)
            await self._audio_end(0)

        self._greeting = asyncio.ensure_future(speak())
        with suppress(asyncio.CancelledError, Exception):
            await self._greeting
        return True
