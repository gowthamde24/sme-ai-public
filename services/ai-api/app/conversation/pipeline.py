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

log = logging.getLogger("app.conversation")

BARGE_IN_MIN_SPEECH_MS = 100  # sound this long while we speak counts as the caller talking (shorter would trigger on a cough)


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
    ) -> None:
        self.stt, self.llm, self.tts, self.playout = stt, llm, tts, playout
        self.session, self.models, self.fillers, self.voice = session, models, fillers, voice
        self.filler_after_ms, self.tools_available, self.clock = filler_after_ms, tools_available, clock
        self.on_stt = on_stt  # the browser session shows the caller's words as they come (partials and the final); the phone loop leaves it None
        self._epoch = 0
        self._reply_task: asyncio.Future[None] | None = None
        self._current: TurnTimings | None = None
        self._write_lock = asyncio.Lock()
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

    async def listen(self, source: AudioSource, tm: TurnTimings) -> str | None:
        """Listen to one caller turn and return what was said (None when nothing was); the answer is a separate `respond()`, so a caller that must act between the two (the browser session) can."""
        return await self._listen(source, tm)

    async def _listen(self, source: AudioSource, tm: TurnTimings) -> str | None:
        events = self.stt.events(source.frames())
        try:
            async for ev in events:
                now = self.clock()
                if self.on_stt is not None:
                    self.on_stt(ev)
                if ev.kind == "speech_start":
                    await self.interrupt()
                elif ev.kind == "speech_end":
                    tm.eot_at = now
                elif ev.kind == "final":
                    tm.final_at = now
                    if tm.eot_at is None:
                        tm.eot_at = now
                    return ev.text.strip() or None
        finally:
            aclose = getattr(events, "aclose", None)
            if aclose is not None:
                await aclose()
        return None

    async def respond(self, user_text: str, tm: TurnTimings | None = None) -> TurnTimings:
        tm = tm or TurnTimings()
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
        await self.playout.stop()
        self.last_interrupt_ms = (self.clock() - t0) * 1000.0
        if task is not None and not task.done():
            task.cancel()
        return self.last_interrupt_ms

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
        tier = route(user_text, tools_available=self.tools_available, turn_number=self.turns)
        tm.model_tier = tier
        messages = [*self.session.history, {"role": "user", "content": user_text}]
        queue: asyncio.Queue[str | None] = asyncio.Queue()
        begin = getattr(self.tts, "begin_turn", None)
        if begin is not None:
            begin()
        background = [asyncio.ensure_future(self.tts.prewarm()), asyncio.ensure_future(self._filler(tm, epoch))]
        producer = asyncio.ensure_future(self._produce(messages, self.models[tier], tm, queue))
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
            self.session.history += [{"role": "user", "content": user_text}, {"role": "assistant", "content": tm.reply_text}]

    async def _produce(self, messages: list[dict[str, str]], model: str, tm: TurnTimings, queue: asyncio.Queue[str | None]) -> None:
        buf = ClauseBuffer()
        parts: list[str] = []
        try:
            tm.llm_request_at = self.clock()
            async for delta in self.llm.stream(self.session.system, messages, model):
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
        while (piece := await queue.get()) is not None:
            tm.clauses += 1
            if tm.tts_request_at is None:
                tm.tts_request_at = self.clock()
            async for pcm in self.tts.stream(piece, self.session.language):
                if epoch != self._epoch:
                    return
                if tm.first_audio_at is None:
                    tm.first_audio_at = self.clock()
                async with self._write_lock:
                    if epoch != self._epoch:
                        return
                    await self.playout.write(pcm)

    async def _filler(self, tm: TurnTimings, epoch: int) -> None:
        if self.fillers is None:
            return
        await asyncio.sleep(self.filler_after_ms / 1000.0)
        if tm.first_audio_at is not None or epoch != self._epoch:
            return
        voice = self.voice(self.session.language) if callable(self.voice) else self.voice  # the browser voice has a different catalogue voice per language
        picked = self.fillers.pick(self.session.language, voice)
        if picked is None:
            return
        tm.filler_played = True
        async with self._write_lock:
            if epoch == self._epoch:
                tm.filler_at = self.clock()
                await self.playout.write(picked[1])
