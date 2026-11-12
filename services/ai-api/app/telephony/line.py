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
import re
import time
import unicodedata
from collections.abc import Awaitable, Callable
from contextlib import suppress
from typing import Any, Literal, Protocol

from app.browser_voice.audio import OUT_RATE
from app.conversation.endpointing import rms
from app.telephony import exotel
from app.telephony.pcm import Resampler, pad_to_multiple
from app.telephony.wire import EXOTEL, WireProtocol
from app.text_spacing import space_scripts

Kind = Literal["text", "bytes", "close"]
STT_RATE = 16000
FRAME_BYTES = STT_RATE * 2 * 20 // 1000   # 20 ms at 16 kHz
OPEN_TIMEOUT_S = 10.0
# natural barge-in (owner, 6 Nov 2026): while we talk, the caller's sound is judged by its LENGTH. "haa", "hmm", "avunu", "sare", "ji", a cough: shorter than STOP_SPEECH_MS, ignored, we keep
# talking. Real speech longer than that: we stop, and the voice FADES out over FADE_MS (ending in a quiet moment between words when there is one) instead of a hard cut.
CLOSING_STOP_SPEECH_MS = 800   # owner, 12 Nov 2026: while the assistant says its CLOSING line only a stop word or a sound of this length stops it (a 460 ms sound cut the goodbye of the round 2 call)
NO_WORDS_GRACE_MS = 250        # owner, 12 Nov 2026: at 450 ms the recogniser may not have produced a word yet ("ఆ" is a backchannel, but its text arrives late): wait this much longer for words before treating the sound as speech
STOP_SPEECH_MS = 450   # owner, 11 Nov 2026 (was 600): a real interruption is heard sooner; short backchannels stay under it, and a longer one is still ignored when the live transcript says it is only a backchannel
# Spoken STOP words, matched in the caller's live transcript while the assistant talks: they stop it at once, whatever the length of the sound (owner, 11 Nov 2026).
STOP_WORDS = ("ఆగండి", "ఆగు", "ఆపండి", "ఆపు", "ఒక్క నిమిషం", "ఒక్క నిముషం", "ఒక్క నిమిషము", "stop", "wait", "hold on", "hang on", "रुकिए", "रुको", "ruko")
# Backchannels: the sounds of listening. A sound that lasts long enough to be an interruption but whose live transcript is ONLY these is ignored.
BACKCHANNELS = frozenset({"ఆ", "ఆహా", "హా", "హ", "అవును", "అవునా", "అవునండీ", "అవునండి", "అండీ", "అండి", "సరే", "సరేనండీ", "ఊ", "ఊహూ", "హ్మ్", "హమ్", "ఓహో", "ok", "okay", "hmm", "hm", "mm", "uh", "huh", "yes", "yeah", "yep", "haan", "ji", "जी", "हाँ", "हां", "हूं", "अच्छा"})


def _words_of(text: str) -> list[str]:
    cleaned = "".join(c if unicodedata.category(c)[0] in "LMN" else " " for c in unicodedata.normalize("NFC", text).casefold())
    return cleaned.split()


def has_stop_word(text: str) -> str | None:
    """The stop word (or phrase) the caller said, else None. Whole words only."""
    padded = " " + " ".join(_words_of(text)) + " "
    for word in STOP_WORDS:
        if f" {' '.join(_words_of(word))} " in padded:
            return word
    return None


def only_backchannel(text: str) -> bool:
    """True when the live transcript holds words and ALL of them are backchannels ("ఆ, అవును", "ok hmm")."""
    words = _words_of(text)
    return bool(words) and all(w in BACKCHANNELS for w in words)


QUESTION_TAG = re.compile(r"\{(?:q_[a-z0-9_]{1,30}|refusal)\}\s*", re.IGNORECASE)
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
                 line_rate: int | None = None, hang_up_wait_s: float = 10.0, proto: WireProtocol = EXOTEL, close_pause_s: float = 0.6, mark_wait_s: float = 2.0) -> None:
        self._wire, self._clock, self._sleep = wire, clock, sleep
        self._p = proto   # the provider's wire protocol (Exotel unless told otherwise)
        self.hang_up_wait_s = hang_up_wait_s
        self.close_pause_s = close_pause_s     # after the last line has played, a short pause before the line closes (12 Nov 2026: a goodbye must always be heard in full)
        self.mark_wait_s = mark_wait_s         # how long we wait for the provider's own "played" word for the last checkpoint, on top of our own estimate
        self._marks_played: set[str] = set()   # the checkpoints the provider has told us it played
        self._mark_sent_at = 0.0
        self._last_clear_at = 0.0
        self._hang_up_interruptible = False
        self.goodbye_interrupted = 0
        self.on_hang_up_cancelled: Callable[[], None] | None = None   # set by the call session: the caller spoke over the closing line, so the call goes on
        self.end_reason: str | None = None       # why the call ended, in the words of phone_calls.end_reason: caller_hung_up | goodbye | silence | longest_call | stopped | error
        self._forced_rate = line_rate
        self.rate = line_rate or proto.default_rate
        self.chunk = proto.chunk_bytes(self.rate)
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
        self.no_words_grace_ms = NO_WORDS_GRACE_MS
        self._vad_buf = bytearray()
        self._talk_ms = 0          # the caller's sound while we talk, in this run
        self._gap_ms = 0
        self._stopped_run = False
        self._faded_at: int | None = None   # chunks_out right after the last stop: a second stop with nothing sent since is the same interruption
        self._sent = bytearray()   # the last KEEP_SENT_S of audio we sent (line rate), to fade from
        self.interruptions: dict[str, int] = {"stopped": 0, "ignored": 0}
        self.whispers: list[str] = []
        self.translator: Any = None   # app/telephony/translate.LineTranslator: the English line under each non-English caption (owner, 7 Nov 2026); None: no English lines
        # Take over (app v4): an Owner or Admin talks to the caller from the app. While it lasts the AI does not answer, the caller's audio goes to them, their audio goes to the caller.
        self.taken_over = False
        self._owner_q: asyncio.Queue[bytes] | None = None
        self._owner_down: Resampler | None = None
        self._owner_pending = bytearray()   # the owner's notes for the AI during this call (app v4: Whisper); the session takes them before its next reply
        self.fade_ms: list[int] = []
        self.notice_speaker: Callable[[], Awaitable[None]] | None = None   # set by the call session: speaks the take-over announcement (only used when TAKEOVER_ANNOUNCE is on)
        self._closed = False
        # how the call ended, for the end-of-call log (names and numbers only, 5 Nov 2026: the 11:57 UTC call ended 0.4 s after admission and the log could not say whether Exotel sent `stop` or dropped
        # the socket, nor whether any of our audio had gone out)
        self.end_how: str | None = None          # stop | socket_closed
        self.stop_reason: str | None = None      # Exotel's `stop.reason`, as a short closed word
        self.clear_ack_ms: list[int] = []        # ms from our clearAudio to the provider's clearedAudio (Plivo says it back; Exotel does not)
        self._clear_sent_at: float | None = None
        self._caller_text = ""                   # the caller's live transcript of the sound run in progress (from the session): a backchannel is told from a real interruption by it
        self._peak = 0.0                         # the loudest 20 ms frame of the caller's sound run while we talk (a number, logged with the decision; no audio is kept)
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
                name = self._p.event_name(raw)
                self.events[name] = self.events.get(name, 0) + 1
                event = self._p.parse(raw)
                if isinstance(event, exotel.Start):
                    return event
        try:
            start = await asyncio.wait_for(read(), timeout)
        except TimeoutError:
            return None
        if start is not None:
            self.start = start
            self.rate = self._forced_rate or start.sample_rate
            self.chunk = self._p.chunk_bytes(self.rate)
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
            name = self._p.event_name(raw)
            self.events[name] = self.events.get(name, 0) + 1
            if name == "clearedAudio" and self._clear_sent_at is not None:
                ms = round((self._clock() - self._clear_sent_at) * 1000)
                self._clear_sent_at = None
                self.clear_ack_ms.append(ms)
                log.info("phone_clear_ack ms=%d", ms)
            self._on_event(self._p.parse(raw))
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
            if self._owner_q is not None:   # the person who took over hears the caller (16 kHz)
                if self._owner_q.full():
                    with suppress(asyncio.QueueEmpty):
                        self._owner_q.get_nowait()   # a slow listener loses the oldest audio, never blocks the call
                self._owner_q.put_nowait(pcm)
            if self.taken_over:
                return   # no barge-in while a person talks: the caller may talk over them
            if self._clock() < self._play_until:
                self._watch_for_barge_in(pcm)
            else:
                self._end_sound_run()
                self._vad_buf.clear()
        elif isinstance(event, exotel.Mark):
            self._marks_played.add(event.name)   # the provider says a checkpoint has played
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
            level = rms(frame)
            self._peak = max(self._peak, level)
            if level >= self._barge_threshold:
                self._talk_ms += 20
                self._gap_ms = 0
                closing = self._hang_up_interruptible and self._hang_up_after_audio_end is not None   # the closing line is playing
                need = max(self.stop_speech_ms, CLOSING_STOP_SPEECH_MS) if closing else self.stop_speech_ms
                if self._talk_ms >= need and not self._stopped_run:
                    if only_backchannel(self._caller_text):
                        continue   # long enough to be an interruption, but the words are only "ఆ, అవును, ok": it is listening, not interrupting (logged as ignored when the run ends)
                    has_words = bool(_words_of(self._caller_text))
                    if not has_words and not closing and self._talk_ms < need + self.no_words_grace_ms:
                        continue   # no word has arrived yet: it may still turn out to be a backchannel
                    self._stop(f"audio_{need}ms_closing" if closing else (f"audio_{need}ms" if has_words else f"audio_{need + self.no_words_grace_ms}ms_no_words"))
            elif self._talk_ms:
                self._gap_ms += 20
                if self._gap_ms >= SPEECH_GAP_MS:
                    self._end_sound_run()

    def _stop(self, rule: str) -> None:
        """An interruption: the session stops the voice (it fades). `rule` says which rule fired (audio_450ms | stop_word); logged with the length and loudness of the sound."""
        self._stopped_run = True
        self.interruptions["stopped"] += 1
        log.info("phone_interruption decision=stopped rule=%s speech_ms=%d peak=%d threshold=%d words=%d", rule, self._talk_ms, round(self._peak), round(self._barge_threshold), len(_words_of(self._caller_text)))
        self._q.put_nowait(("text", {"type": "barge_in", "verify": False}))

    def note_caller_text(self, text: str) -> None:
        """The caller's live transcript (a partial or a final), handed in by the call session. While the assistant is talking, a spoken STOP word stops it at once, whatever the length of the sound; otherwise the words only decide
        whether a long sound is a backchannel (see `_watch_for_barge_in`)."""
        self._caller_text = text
        if self.taken_over or self._closed or self._stopped_run or self._clock() >= self._play_until:
            return
        word = has_stop_word(text)
        if word is not None:
            self._stop("stop_word")

    def closed(self) -> bool:
        return self._closed

    def take_over(self) -> asyncio.Queue[bytes]:
        """A person takes the call (app v4): the AI's voice fades out (the same stop as a barge-in), the AI answers no more until `hand_back`, and the caller's audio (16 kHz PCM) goes to the queue."""
        self.taken_over = True
        self._owner_q = asyncio.Queue(maxsize=250)   # about 5 s of 20 ms frames
        self._owner_down = Resampler(STT_RATE, self.rate)
        self._owner_pending.clear()
        self._q.put_nowait(("text", {"type": "barge_in", "verify": False}))
        log.info("phone_take_over started")
        return self._owner_q

    async def announce(self) -> bool:
        """Speak the short take-over announcement to the caller, when the call session has given the line a way to (TAKEOVER_ANNOUNCE). True when it was spoken."""
        if self.notice_speaker is None or self._closed:
            return False
        try:
            await self.notice_speaker()
        except Exception:  # noqa: BLE001 - a failed announcement never blocks the person
            log.warning("phone_take_over notice_failed")
            return False
        return True

    def hand_back(self) -> None:
        """The person hands the call back: the AI answers the caller's next words."""
        if self.taken_over:
            log.info("phone_take_over ended")
        self.taken_over = False
        self._owner_q = None
        self._owner_pending.clear()

    async def send_owner_audio(self, pcm16: bytes) -> None:
        """The person's microphone (16-bit mono PCM at 16 kHz) to the caller, in the provider's chunks, at the pace it plays."""
        if not self.taken_over or self.start is None or self._closed or self._owner_down is None:
            return
        self._owner_pending += self._owner_down.process(pcm16)
        while len(self._owner_pending) >= self.chunk and not self._closed:
            part = bytes(self._owner_pending[: self.chunk])
            del self._owner_pending[: self.chunk]
            await self._emit(part, keep=False)

    def _end_sound_run(self) -> None:
        if self._talk_ms >= MIN_SOUND_MS and not self._stopped_run:
            self.interruptions["ignored"] += 1
            if self._talk_ms < self.stop_speech_ms:
                why = "shorter_than_450ms"
            elif only_backchannel(self._caller_text):
                why = "backchannel_words"
            elif self._hang_up_interruptible and self._hang_up_after_audio_end is not None:
                why = "shorter_than_800ms_closing"
            else:
                why = "no_words_arrived"
            log.info("phone_interruption decision=ignored rule=%s speech_ms=%d peak=%d threshold=%d words=%d", why, self._talk_ms, round(self._peak), round(self._barge_threshold), len(_words_of(self._caller_text)))   # a backchannel or a noise: we kept talking
        self._talk_ms, self._gap_ms, self._stopped_run = 0, 0, False
        self._peak = 0.0
        self._caller_text = ""

    async def _fade_out(self) -> int:
        """Stop the voice the way a person does: what the provider had queued is cleared, and the next FADE_MS of the audio the caller was about to hear is sent again with the volume going down to
        silence, cut at a quiet moment between words when there is one in that window. Returns how long the fade is, in ms (0: nothing was playing)."""
        assert self.start is not None   # noqa: S101 - callers check
        now = self._clock()
        if self._faded_at is not None and self.chunks_out == self._faded_at:   # the same interruption told twice: the voice is already stopped and faded, nothing new was sent since
            self._pending.clear()
            return 0
        unplayed = max(0.0, self._play_until - now)
        self._pending.clear()
        await self._wire.send_text(self._p.clear_message(self.start.stream_sid))
        self._clear_sent_at = self._last_clear_at = self._clock()
        self._play_until = now
        if unplayed < 0.04 or not self._sent:
            self._faded_at = self.chunks_out
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
        self._faded_at = self.chunks_out
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

    def elapsed(self) -> float:
        """Seconds since the call began, as a transcript line's `t`."""
        return round(self._clock() - self._began, 1)

    def add_turn(self, text: str, *, index: int, t: float) -> None:
        """One whole assistant turn (owner, 7 Nov 2026: never one line per streaming piece, which split Telugu letters): what the caller heard of it. It goes where the turn began, so words the
        caller said over it stay after it."""
        said = space_scripts(" ".join(QUESTION_TAG.sub("", text).split()))   # (the topic tags {q_parent} the model puts before a question are never shown)
        if not said:
            return
        item: dict[str, Any] = {"who": "assistant", "text": said, "t": t}
        self.transcript.insert(min(index, len(self.transcript)), item)
        if self.translator is not None:
            self.translator.submit(item)

    async def send_json(self, message: dict[str, Any]) -> None:
        kind = message.get("type")
        if kind == "audio_stop" and self._hang_up_interruptible and self._hang_up_after_audio_end is not None:
            # the caller spoke over the CLOSING line (12 Nov 2026: the 450 ms rule cleared it mid-sentence and the pending hang-up then closed the line with no goodbye heard): the call is not over, they are talking
            self._hang_up_after_audio_end, self._hang_up_interruptible = None, False
            self.goodbye_interrupted += 1
            log.info("phone_goodbye interrupted=yes hang_up=cancelled")
            if self.on_hang_up_cancelled is not None:
                self.on_hang_up_cancelled()
        if kind == "caption" and message.get("final") and str(message.get("text", "")).strip():
            who = "caller" if message.get("who") == "user" else "assistant"
            self.transcript.append({"who": who, "text": space_scripts(str(message["text"]).strip()) if who == "assistant" else str(message["text"]).strip(), "t": round(self._clock() - self._began, 1)})
            if self.translator is not None:
                self.translator.submit(self.transcript[-1])
        elif kind == "audio_stop":
            if self.start is not None and not self._closed:
                await self._fade_out()
            else:
                self._pending.clear()
                self._play_until = 0.0
        elif kind == "audio_end":
            await self.flush()
            if self._hang_up_after_audio_end is not None:
                reason, self._hang_up_after_audio_end, self._hang_up_interruptible = self._hang_up_after_audio_end, None, False
                await self.hang_up(reason)
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
        self._mark_sent_at = self._clock()
        await self._wire.send_text(self._p.mark_message(self.start.stream_sid, f"turn-{self._seq}"))

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
        await self._wire.send_text(self._p.media_message(self.start.stream_sid, chunk, self.rate))

    async def hang_up(self, reason: str) -> None:
        """We end the call: first let the provider finish playing what we sent (a goodbye cut in half is rude), then close. The last line must have fully played: our own estimate of the playing time, then the provider's own "played"
        word for the last checkpoint (up to `mark_wait_s`, and only when that checkpoint was sent after the last clear), then a short pause (`close_pause_s`). The session's reader sees the close and the session ends."""
        if self._closed:
            return
        await self.flush()
        began = self._clock()
        waited = 0.0
        while self._clock() < self._play_until and waited < self.hang_up_wait_s:
            await self._sleep(0.05)
            waited += 0.05
        target = f"turn-{self._seq}"
        heard = target in self._marks_played or self._seq == 0 or self._mark_sent_at <= self._last_clear_at
        marked = 0.0
        while not heard and not self._closed and marked < self.mark_wait_s and waited + marked < self.hang_up_wait_s:
            await self._sleep(0.05)
            marked += 0.05
            heard = target in self._marks_played
        if not self._closed and self.close_pause_s > 0:
            await self._sleep(self.close_pause_s)
        log.info("phone_hang_up reason=%s waited_ms=%d mark_played=%s pause_ms=%d", reason, round((self._clock() - began) * 1000), "yes" if target in self._marks_played else "no", round(self.close_pause_s * 1000))
        self._finish(reason)

    def hang_up_after_next_turn(self, reason: str, *, interruptible: bool = False) -> None:
        """The next thing the voice finishes saying is the last: when its audio ends we close the line (after it has fully played). `interruptible`: if the caller speaks over that closing line the hang-up is cancelled and the call goes on."""
        self._hang_up_after_audio_end = reason
        self._hang_up_interruptible = interruptible

    def playing(self) -> bool:
        return self._clock() < self._play_until
