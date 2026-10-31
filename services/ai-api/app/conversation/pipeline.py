"""The streaming conversation loop (job natural-voice): streamed speech recognition -> streamed language model -> the first clause to the voice at once -> streamed voice audio to the line. Nothing waits for the
whole of anything: the caller hears the start of the answer while the model is still writing its end.

    caller audio --> StreamingStt --(final transcript)--> route --> StreamingLlm --(deltas)--> ClauseBuffer
                                                                                       (first clause) --> StreamingTts --(pcm)--> Playout

  * Every step stamps a `TurnTimings` (the numbers of the latency report and of the CI eval).
  * Barge-in: `interrupt()` stops the line FIRST (a counter makes every later write of the old reply a no-op), then cancels the model and the voice. `watch_for_interrupt()` listens to the caller's frames while we
    speak and calls it at the first sound of speech.
  * A filler ("హా…") from the pre-rendered bank plays when no reply audio is ready after `filler_after_ms`.
  * The loop knows no provider: it takes the five interfaces of types.py (real ones in providers.py, fakes in fakes.py)."""

# ruff: noqa: E501

from __future__ import annotations

import asyncio
import logging
import time
from collections.abc import AsyncIterator, Callable
from contextlib import suppress
from typing import Any

from app.conversation.chunker import ClauseBuffer
from app.conversation.endpointing import EnergyEndpointer, endpoint_ms
from app.conversation.fillers import FILLER_AFTER_MS, FillerBank
from app.conversation.parts import (
    AudioSource,
    Playout,
    Session,
    StreamingLlm,
    StreamingStt,
    StreamingTts,
    SttEvent,
    TurnTimings,
)
from app.conversation.router import Tier, route
from app.conversation.turntaking import (
    MAX_HOLD_PARTS,
    PauseModel,
    completeness,
    hold_ms,
    spoken_prefix,
)

log = logging.getLogger("app.conversation")

BARGE_IN_MIN_SPEECH_MS = 100  # sound this long while we speak counts as the caller talking (shorter would trigger on a cough)



def _same_words(a: str, b: str) -> bool:
    """Are these the same words, whatever the punctuation and the case (the recogniser's partial and its final differ in the marks)?"""
    def norm(t: str) -> str:
        return " ".join("".join(ch for ch in t.casefold() if ch.isalnum() or ch.isspace()).split())

    return norm(a) == norm(b)


class Conversation:
    def __init__(
        self,
        *,
        stt: StreamingStt,
        llm: StreamingLlm,
        tts: StreamingTts,
        playout: Playout,
        session: Session,
        models: dict[Tier, str],
        fillers: FillerBank | None = None,
        voice: str | Callable[[str], str] = "",
        filler_after_ms: int = FILLER_AFTER_MS,
        tools_available: bool = False,
        clock: Callable[[], float] = time.perf_counter,
        on_stt: Callable[[SttEvent], None] | None = None,
        router: Callable[[str, bool, int], Tier] | None = None,
        semantic_turns: bool = False,
        pause_model: PauseModel | None = None,
        can_speculate: Callable[[str], bool] | None = None,
        filler_on_casual: bool = True,
    ) -> None:
        self.stt, self.llm, self.tts, self.playout = stt, llm, tts, playout
        self.session, self.models, self.fillers, self.voice = session, models, fillers, voice
        self.filler_after_ms, self.tools_available, self.clock = filler_after_ms, tools_available, clock
        # filler policy (owner, 31 Oct 2026: fillers only when the wait is real): none on casual turns (the fast tier) unless asked for, one at most per turn, never on two turns in a row, and never one that was
        # overtaken by the answer (the bank itself never repeats the line it said last)
        self.filler_on_casual = filler_on_casual
        self._last_filler_turn = -10
        self.router = router or (lambda text, tools, turn: route(text, tools_available=tools, turn_number=turn))   # the browser session routes by the conversational assistant's intent (job EA)
        self.on_stt = on_stt  # the browser session shows the caller's words as they come (partials and the final); the phone loop leaves it None
        self._epoch = 0
        self._reply_spec: Any = None
        self._reply_task: asyncio.Future[None] | None = None
        self._current: TurnTimings | None = None
        self._write_lock = asyncio.Lock()
        # owner standard 31 Oct 2026 (live conversation A1/A2): hold the end of a turn while the thought is unfinished, and let the speaker's own pause set how long the quiet must be
        self.semantic_turns = semantic_turns
        # A3 (speculative start): the model starts on a stable partial that looks finished, before the final transcript; `can_speculate(text)` says whether this words go to a tier that may (the session's pure check)
        self.can_speculate = can_speculate
        self._spec: Any = None
        self._spec_timer: asyncio.TimerHandle | None = None
        self.speculations = {"started": 0, "used": 0, "dropped": 0}
        self.pauses = pause_model if pause_model is not None else PauseModel()
        # B2/B3: the line can be paused for a possible interruption and picked up again; what was actually heard is what the history keeps
        self._gate = asyncio.Event()
        self._gate.set()
        self._tail = bytearray()   # the last seconds of audio written to the line, so a pause can send again what the caller did not hear
        self._resume_pcm = b""
        self._clauses: list[list[Any]] = []   # [text, seconds of audio] of the reply being spoken
        self.turns = 0
        self.last_interrupt_ms: float | None = None

    # ---- the whole turn --------------------------------------------------------------------------------------------------------------------------

    async def run_turn(self, source: AudioSource) -> TurnTimings:
        """Listen to one caller turn, then answer it. Returns the timings (also when the caller interrupted or said nothing)."""
        tm = TurnTimings()
        text = await self._listen(source, tm)
        tm.end_of_speech_at = source.speech_ended_at
        if text:
            await self.respond(text, tm)
        return tm

    async def listen(self, source: AudioSource, tm: TurnTimings, *, interrupt: bool = True, hold: bool = True) -> str | None:
        """Listen to one caller turn and return what was said (None when nothing was); the answer is a separate `respond()`, so a caller that must act between the two (the browser session) can.
        `interrupt=False`: the first sound does not stop our own reply (the session is only judging a possible interruption); `hold=False`: the end of the turn is not held back for an unfinished thought."""
        return await self._listen(source, tm, interrupt=interrupt, hold=hold)

    async def _listen(self, source: AudioSource, tm: TurnTimings, *, interrupt: bool = True, hold: bool = True) -> str | None:
        """One caller turn. With semantic turns on, a thought that is not finished ("2000 sq ft ki...") is not answered: the line is listened to for a little longer and what comes next is joined to it."""
        set_silence = getattr(self.stt, "set_silence_ms", None)
        if self.semantic_turns and set_silence is not None:
            set_silence(self.pauses.silence_ms(endpoint_ms(self.session.language)))   # the speaker's own pause, learned in this session
        parts: list[str] = []
        gap_from: float | None = None
        while True:
            wait_s = None if not parts else self._hold_s(" ".join(parts))
            text = await self._listen_once(source, tm, wait_s, interrupt)
            if text is None:
                break
            if gap_from is not None:
                self.pauses.observe_gap(int((self.clock() - gap_from) * 1000))
            parts.append(text)
            merged = " ".join(parts)
            if not hold or not self.semantic_turns or len(parts) >= MAX_HOLD_PARTS or self._hold_s(merged) <= 0:
                break
            gap_from = tm.eot_at if tm.eot_at is not None else self.clock()
        merged = " ".join(parts).strip()
        return merged or None

    def _hold_s(self, text: str) -> float:
        if not self.semantic_turns:
            return 0.0
        return hold_ms(completeness(text, self.session.language), self.pauses) / 1000.0

    async def _listen_once(self, source: AudioSource, tm: TurnTimings, first_within_s: float | None = None, interrupt: bool = True) -> str | None:
        """One recogniser turn. `first_within_s`: give up (None) when the caller does not start talking again within that time."""
        events = self.stt.events(source.frames())
        try:
            first = True
            while True:
                try:
                    if first and first_within_s is not None:
                        ev = await asyncio.wait_for(events.__anext__(), timeout=first_within_s)
                    else:
                        ev = await events.__anext__()
                except StopAsyncIteration:
                    return None
                except TimeoutError:
                    tm.held_ms += int((first_within_s or 0) * 1000)   # waited for the rest of a thought that did not come
                    return None
                first = False
                now = self.clock()
                if self.on_stt is not None:
                    self.on_stt(ev)
                if ev.kind == "partial":
                    self._note_partial(ev.text)
                elif ev.kind == "speech_start":
                    self._drop_spec()
                if ev.kind == "speech_start":
                    tm.speech_start_at = tm.speech_start_at if tm.speech_start_at is not None else now
                    if interrupt:
                        await self.interrupt()
                elif ev.kind == "speech_end":
                    tm.eot_at = now
                elif ev.kind == "final":
                    tm.final_at = now
                    if tm.eot_at is None:
                        tm.eot_at = now
                    self._cancel_timer()
                    if self._spec is not None and _same_words(self._spec.text, ev.text) is False:
                        self._drop_spec()   # what was confirmed is not what the model was started on
                    return ev.text.strip() or None
        finally:
            self._cancel_timer()
            aclose = getattr(events, "aclose", None)
            if aclose is not None:
                await aclose()

    async def respond(self, user_text: str, tm: TurnTimings | None = None) -> TurnTimings:
        tm = tm or TurnTimings()
        spec, self._spec = self._spec, None
        if spec is not None and not _same_words(spec.text, user_text):
            self._schedule_cancel(spec)
            spec = None
        self._reply_spec = spec
        self._current = tm
        self.turns += 1
        self._reply_task = asyncio.ensure_future(self._reply(user_text, tm))
        try:
            await self._reply_task
        except asyncio.CancelledError:
            if not tm.interrupted:
                raise
        finally:
            self._reply_task = None
            tm.done_at = self.clock()
        return tm

    # ---- A3: speculative start ---------------------------------------------------------------------------------------------------------------------

    STABLE_S = 0.15   # the words have not changed for this long

    def _note_partial(self, text: str) -> None:
        if not self.can_speculate or self.llm is None:
            return
        self._cancel_timer()
        if self._spec is not None and not _same_words(self._spec.text, text):
            self._drop_spec()   # they went on
        if self._spec is None:
            self._spec_timer = asyncio.get_running_loop().call_later(self.STABLE_S, self._speculate, text)

    def _speculate(self, text: str) -> None:
        self._spec_timer = None
        if self._spec is not None or self.speaking or not self.can_speculate or len(text.split()) < 3:
            return
        if completeness(text, self.session.language) != "complete" or not self.can_speculate(text):
            return
        starter = getattr(self.llm, "speculate", None)
        if starter is None:
            return
        messages = [*self.session.history, {"role": "user", "content": text.strip()}]
        spec = starter(self.session.system, messages, self.models["fast"])
        if spec is not None:
            self._spec = spec
            self.speculations["started"] += 1

    def _cancel_timer(self) -> None:
        if self._spec_timer is not None:
            self._spec_timer.cancel()
            self._spec_timer = None

    def _drop_spec(self) -> None:
        self._cancel_timer()
        spec, self._spec = self._spec, None
        if spec is not None:
            self.speculations["dropped"] += 1
            self._schedule_cancel(spec)

    @staticmethod
    def _schedule_cancel(spec: Any) -> None:
        asyncio.ensure_future(spec.cancel())

    # ---- barge-in --------------------------------------------------------------------------------------------------------------------------------

    async def interrupt(self) -> float | None:
        """The caller started talking: stop the line NOW, then the model and the voice. Returns the milliseconds it took (None when we were not speaking)."""
        task = self._reply_task
        if (task is None or task.done()) and not self.playout.active:
            return None
        t0 = self.clock()
        self._epoch += 1  # from here on every write of the old reply is dropped, whatever is still in flight
        if self._current is not None:
            self._current.interrupted = True
            self._current.spoken_text = self._heard()   # B3: the history keeps what the caller heard, not what was written
        self._gate.set()   # (a paused reply that is now cancelled must not wait for ever)
        self._resume_pcm = b""
        await self.playout.stop()
        self.last_interrupt_ms = (self.clock() - t0) * 1000.0
        if task is not None and not task.done():
            task.cancel()
        return self.last_interrupt_ms

    def _heard(self) -> str:
        """What of the reply the caller has actually heard so far: the clauses that were played, and the words of the one that was cut (B3)."""
        unplayed = float(getattr(self.playout, "unplayed_seconds", lambda: 0.0)())
        written = sum(float(c[1]) for c in self._clauses)
        return spoken_prefix([(str(c[0]), float(c[1])) for c in self._clauses], max(0.0, written - unplayed))

    @property
    def speaking(self) -> bool:
        task = self._reply_task
        return (task is not None and not task.done()) or self.playout.active

    async def pause(self) -> float | None:
        """B1/B2: something made a sound while we speak. Stop the line NOW (the caller hears silence within the browser's flush) but keep the reply alive and remember what was cut off, so it can be picked up again
        if the sound turns out to be a cough, a "hmm" or a TV. Returns the milliseconds it took, or None when we were not speaking."""
        if not self.speaking or not self._gate.is_set():
            return None
        t0 = self.clock()
        rate = int(getattr(self.tts, "sample_rate", 24000) or 24000)
        unplayed = float(getattr(self.playout, "unplayed_seconds", lambda: 0.0)())
        self._gate.clear()
        keep = min(len(self._tail), int(unplayed * rate) * 2)
        self._resume_pcm = bytes(self._tail[len(self._tail) - keep :]) if keep else b""
        await self.playout.stop()
        if self._current is not None:
            self._current.paused += 1
        return (self.clock() - t0) * 1000.0

    @property
    def is_paused(self) -> bool:
        return not self._gate.is_set()

    async def resume(self) -> bool:
        """B2: it was not an interruption. Say again what was cut off and go on with the rest of the reply."""
        if self._gate.is_set():
            return False
        pcm, self._resume_pcm = self._resume_pcm, b""
        if pcm:
            async with self._write_lock:
                await self.playout.write(pcm)
        self._gate.set()
        return True

    async def watch_for_interrupt(self, frames: AsyncIterator[bytes]) -> float | None:
        """Listen to the caller's frames while we speak; at the first sound of speech call interrupt(). Returns its milliseconds, or None when the frames ended without speech."""
        endpointer = EnergyEndpointer(silence_ms=endpoint_ms(self.session.language), min_speech_ms=BARGE_IN_MIN_SPEECH_MS)
        async for frame in frames:
            if "speech_start" in endpointer.feed(frame):
                return await self.interrupt()
        return None

    # ---- the reply -------------------------------------------------------------------------------------------------------------------------------

    async def _reply(self, user_text: str, tm: TurnTimings) -> None:
        epoch = self._epoch
        self._clauses = []
        self._tail = bytearray()
        tier = self.router(user_text, self.tools_available, self.turns)
        tm.model_tier = tier
        messages = [*self.session.history, {"role": "user", "content": user_text}]
        queue: asyncio.Queue[str | None] = asyncio.Queue()
        begin = getattr(self.tts, "begin_turn", None)
        if begin is not None:
            begin()
        background = [asyncio.ensure_future(self.tts.prewarm()), asyncio.ensure_future(self._filler(tm, epoch, tier))]
        spec, self._reply_spec = self._reply_spec, None
        if spec is not None and tier != "fast":
            self._schedule_cancel(spec)
            spec = None
        if spec is not None:
            self.speculations["used"] += 1
            tm.speculative = True
        producer = asyncio.ensure_future(self._produce(messages, self.models[tier], tm, queue, spec))
        try:
            await self._consume(queue, tm, epoch)
            await producer
        finally:
            for task in (producer, *background):
                if not task.done():
                    task.cancel()
            for task in (producer, *background):
                with suppress(asyncio.CancelledError, Exception):
                    await task
            tm.tts_engine = str(getattr(self.tts, "served_engine", "") or "")
            tm.tts_fallback = str(getattr(self.tts, "fallback_reason", "") or "")
            log.info("conversation_turn language=%s model_tier=%s tts_engine=%s tts_fallback=%s clauses=%s interrupted=%s filler=%s first_audio_ms=%s", self.session.language, tm.model_tier, tm.tts_engine or "-", tm.tts_fallback or "-", tm.clauses, tm.interrupted, tm.filler_played, None if tm.after_final_ms is None else round(tm.after_final_ms))
            if not tm.interrupted:
                tm.spoken_text = tm.reply_text
            said = tm.spoken_text   # B3: an honest context: only what the caller heard
            self.session.history += [{"role": "user", "content": user_text}] + ([{"role": "assistant", "content": said}] if said else [])
            self._clauses = []

    async def _produce(self, messages: list[dict[str, str]], model: str, tm: TurnTimings, queue: asyncio.Queue[str | None], spec: Any = None) -> None:
        buf = ClauseBuffer()
        parts: list[str] = []
        try:
            tm.llm_request_at = self.clock()
            async for delta in (spec.stream() if spec is not None else self.llm.stream(self.session.system, messages, model)):
                if tm.first_token_at is None:
                    tm.first_token_at = self.clock()
                parts.append(delta)
                tm.reply_text = "".join(parts)
                for piece in buf.feed(delta):
                    await queue.put(piece)
            for piece in buf.flush():
                await queue.put(piece)
        finally:
            tm.reply_text = "".join(parts)
            await queue.put(None)

    async def _consume(self, queue: asyncio.Queue[str | None], tm: TurnTimings, epoch: int) -> None:
        rate = int(getattr(self.tts, "sample_rate", 24000) or 24000)
        while (piece := await queue.get()) is not None:
            tm.clauses += 1
            if tm.tts_request_at is None:
                tm.tts_request_at = self.clock()
            clause: list[Any] = [piece, 0.0]
            self._clauses.append(clause)
            async for pcm in self.tts.stream(piece, self.session.language):
                if epoch != self._epoch:
                    return
                if tm.first_audio_at is None:
                    tm.first_audio_at = self.clock()
                await self._gate.wait()   # a pause for a possible interruption holds the next audio here (B2)
                async with self._write_lock:
                    if epoch != self._epoch:
                        return
                    await self.playout.write(pcm)
                    clause[1] += len(pcm) / 2 / rate
                    self._tail += pcm
                    del self._tail[: max(0, len(self._tail) - 20 * rate * 2)]   # the last 20 s are enough to say again what a pause cut off

    async def _filler(self, tm: TurnTimings, epoch: int, tier: str = "strong") -> None:
        if self.fillers is None:
            return
        if tier == "fast" and not self.filler_on_casual:
            return   # small talk is answered fast; "one moment" in front of it would only be noise
        if self.turns - self._last_filler_turn <= 1:
            return   # never on two turns in a row
        await asyncio.sleep(self.filler_after_ms / 1000.0)
        if tm.first_audio_at is not None or epoch != self._epoch:
            return
        voice = self.voice(self.session.language) if callable(self.voice) else self.voice  # the browser voice has a different catalogue voice per language
        picked = self.fillers.pick(self.session.language, voice)
        if picked is None:
            return
        async with self._write_lock:
            # the answer may have arrived while this waited for the line: then the filler is dropped, not played over it
            if epoch == self._epoch and tm.first_audio_at is None:
                tm.filler_played = True
                self._last_filler_turn = self.turns
                tm.filler_at = self.clock()
                await self.playout.write(picked[1])
