"""The voice of a call with a safety net (job natural-voice, owner decision 28 Oct 2026): speak with the language's primary engine (Cartesia); if it fails, or has produced no audio within the first-audio
timeout (800 ms by default), speak the same text with the fallback engine (Sarvam Bulbul v4 Flash). Which engine served is recorded for every turn.

  * Per language and from data (voices.py): `stream(text, language)` looks the voices up each time, so the Conversation needs no engine knowledge.
  * Within one turn the voice does not change back and forth: once the fallback has spoken in a turn, the rest of that turn stays on it.
  * After ANY primary failure (an error such as no credits, a timeout, a failure mid-sentence) the rest of THIS call speaks with the fallback (owner, 6 Nov 2026: "if Cartesia fails for any reason,
    including no credits, the call must switch automatically to Sarvam Bulbul for that call, not go silent"). One FallbackTts is one call (or one browser talk), so the next call tries the primary again.
  * A failure AFTER the first audio of a piece: the fallback speaks the whole piece again (the caller hears the sentence restart rather than lose the rest of it, which might be a price or a time).
  * Both engines failing is `VoiceError("tts_unavailable")`: the loop above decides what to say (a filler, a hand-over).

Logs carry only engine ids, language, voice labels and milliseconds: never text, audio or a key."""

# ruff: noqa: E501

from __future__ import annotations

import asyncio
import logging
import time
from collections.abc import AsyncIterator, Awaitable, Callable, Mapping
from contextlib import suppress
from typing import Any

from app.agents.register import address
from app.conversation import style_voice
from app.conversation.parts import StreamingTts
from app.conversation.pronounce import Pronunciations, default_pronunciations
from app.conversation.voices import VoiceChoice, VoiceConfig
from app.pronunciation.lexicon import OwnerWord
from app.pronunciation.speech import SpeechText
from app.voice.interface import VoiceError
from app.voice.loudness import StreamNormaliser

log = logging.getLogger("app.conversation.voice")
BUDGET_WAIT_S = 1.5
STRICT_TRIES = 3   # the chosen voice is tried this many times (the same voice each time) before the turn gives up on speaking
STRICT_FIRST_AUDIO_MS = 2500   # how long the chosen voice may take to start (a slow start is not a reason to sound like somebody else)

EngineFactory = Callable[[VoiceChoice, str], StreamingTts]  # (the chosen voice, the language) -> a ready engine


async def _close(it: object) -> None:
    aclose = getattr(it, "aclose", None)
    if aclose is not None:
        with suppress(Exception):
            await aclose()


# the primary's answers that mean "I will not say THIS text", not "I am down": the call stays on the primary
BAD_TEXT_CODES = ("http_400", "http_422")


class FallbackTts:
    sample_rate = 24000

    def __init__(self, config: VoiceConfig, factory: EngineFactory, *, prewarm_language: str = "te", clock: Callable[[], float] = time.monotonic, chosen: Mapping[str, str] | None = None, gender: str = "female", pronunciations: Pronunciations | None = None, strict: bool = False) -> None:
        self.strict = strict   # owner, 26 Nov 2026: NO FALLBACK VOICES. True: only the chosen voice's own engine ever speaks; if it cannot, the turn raises VoiceError (tts_unavailable / tts_budget) and the screen shows the words
        self._speech = SpeechText(pronunciations or default_pronunciations())  # what an engine is given: normalised text, the lexicon (script, a workspace's own words), the English respellings
        self.config, self._factory, self._prewarm_language, self._clock = config, factory, prewarm_language, clock
        self.address_allow: tuple[str, ...] = ()   # the word of address the person chose in their profile (the owner chat); a call or a preview speaks none, whatever the model wrote
        self.gender = gender   # the workspace's voice gender: a chosen voice of the other gender is ignored (the gender's default speaks)
        self._chosen: dict[str, str] = dict(chosen or {})  # the workspace's voice id per language (job voice-picker); a missing or unknown one means the default
        self._engines: dict[tuple[str, str, str, str], StreamingTts] = {}
        self._skip_primary_until: dict[str, float] = {}
        self._fallback_in_turn = False
        self._loud = StreamNormaliser(self.sample_rate)   # one loudness for every voice and engine (app/voice/loudness.py); started again at every turn
        self.style: str | None = None   # the speaking style of the call (app/conversation/style_voice.py): friendly or None = the engine's own sound
        self.pace = 1.0   # the speaking speed of the workspace (1.0 = the engine's own); passed to an engine that can take it
        self.served_engine = ""  # the engine that spoke the most recent piece: cartesia | sarvam_v4
        self.fallback_reason = ""  # "", "error", "timeout", "cooldown", "mid_stream"
        self.first_audio_ms: float | None = None
        self.primary_off = ""  # why the primary is off for the rest of this call ("" while it is on): error | timeout | mid_stream | budget, with the engine's code in the log
        # our spending cap on the primary (app/voice/budget.py): how many characters it may speak in this call. None: no cap is wired (a local run, a test). A pending reservation is awaited
        # (briefly) before the primary's first sentence; past its allowance the call speaks with the fallback.
        self.primary_budget: int | None = None
        self.primary_chars = 0
        self._budget_wait: Awaitable[int] | None = None

    def set_primary_budget(self, budget: int | Awaitable[int]) -> None:
        """The characters the primary may speak in this call: a number, or a reservation still on its way (awaited at most BUDGET_WAIT_S before the primary's first sentence; 0 if late)."""
        if isinstance(budget, int):
            self.primary_budget, self._budget_wait = max(0, budget), None
        else:
            self._budget_wait = budget

    def set_owner_words(self, words: list[OwnerWord]) -> None:
        """The workspace's own pronunciation words (Settings > Pronunciation): the next piece speaks with them."""
        self._speech = self._speech.with_owner_words(words)

    def set_voices(self, chosen: Mapping[str, str], gender: str) -> None:
        """The workspace's voice settings were read again (between turns): the next piece speaks with them."""
        self._chosen, self.gender = dict(chosen), gender

    def voice_id(self, language: str) -> str:
        """The catalogue voice that speaks `language` (the same id for the whole turn, whichever engine serves it)."""
        return self.config.resolve(language, self._chosen.get(language), self.gender).id

    # ---- the turn -----------------------------------------------------------------------------------------------------------------------------

    def begin_turn(self) -> None:
        self._fallback_in_turn = False
        self._loud = StreamNormaliser(self.sample_rate)
        self.served_engine = self.fallback_reason = ""
        self.first_audio_ms = None

    def _engine(self, choice: VoiceChoice, language: str) -> StreamingTts:
        key = (language, choice.engine, choice.model, choice.voice)
        if key not in self._engines:
            self._engines[key] = self._factory(choice, language)
        engine = self._engines[key]
        set_pace = getattr(engine, "set_pace", None)
        if set_pace is not None:
            set_pace(self.pace)
        set_style = getattr(engine, "set_style", None)
        if set_style is not None:
            set_style(style_voice.settings_for(self.style, "sarvam" if choice.engine != "cartesia" else "cartesia"))   # the style's real voice settings (pitch, loudness, temperature, volume, emotion); empty for friendly   # an engine that can speak faster or slower is told the workspace's speed before every piece
        return engine

    async def prewarm(self) -> None:
        voices = self.config.for_language(self._prewarm_language, self._chosen.get(self._prewarm_language), self.gender)
        with suppress(Exception):
            await self._engine(voices.primary, self._prewarm_language).prewarm()

    # ---- one piece of text ----------------------------------------------------------------------------------------------------------------

    async def stream(self, text: str, language: str) -> AsyncIterator[bytes]:
        """The audio of one piece, at the one loudness every voice has (the engines' own levels differ: owner finding of 19 Nov 2026)."""
        inner = self._stream_raw(text, language)
        try:
            async for chunk in inner:
                yield self._loud.process(chunk)
        finally:
            await _close(inner)

    async def _stream_raw(self, text: str, language: str) -> AsyncIterator[bytes]:
        tag = language if language in ("en", "te", "hi", "kn", "ta", "ml", "mr") else "other"   # what the log says about the language is one of ours, never the caller's string
        text = address.clean(text, self.address_allow)   # the last gate: nothing says sir / madam aloud unless the person asked for it
        if not any(ch.isalnum() for ch in text):
            # a clause of only punctuation ("…", ".", ","): nothing to say. Cartesia answers 400 "empty or only punctuation" and the call used to be switched to the fallback for good (owner's call, 15 Nov 19:25Z)
            log.info("tts_skipped_no_words language=%s chars=%d", tag, len(text))
            return
        voices = self.config.for_language(language, self._chosen.get(language), self.gender)
        if self.strict:
            async for chunk in self._strict_piece(voices, language, text, tag):
                yield chunk
            return
        primary_text = self._speech.prepare(text, language, voices.primary.engine)
        fallback_text = self._speech.prepare(text, language, voices.fallback.engine)
        now = self._clock()
        use_primary = not self.primary_off and not self._fallback_in_turn and now >= self._skip_primary_until.get(language, 0.0)
        capped = voices.primary.engine == "cartesia"   # our spending cap is on Cartesia (app/voice/budget.py); a voice that Sarvam speaks first is not counted against it
        if use_primary and capped and self._budget_wait is not None:
            wait, self._budget_wait = self._budget_wait, None
            try:
                self.primary_budget = max(0, int(await asyncio.wait_for(asyncio.shield(asyncio.ensure_future(wait)), BUDGET_WAIT_S)))
            except Exception:  # noqa: BLE001 - no allowance in time: the fallback speaks (never over the cap)
                self.primary_budget = 0
        if use_primary and capped and self.primary_budget is not None and self.primary_chars + len(primary_text) > self.primary_budget:
            use_primary = False
            self._off_for_call("budget", voices.primary.engine, tag, None)
            self.fallback_reason = "budget"
        if not use_primary and not self._fallback_in_turn:
            self.fallback_reason = self.fallback_reason or ("for_call" if self.primary_off else "cooldown")
        if use_primary:
            reason = ""
            started = time.perf_counter()
            agen = self._engine(voices.primary, language).stream(primary_text, language)
            try:
                first = await asyncio.wait_for(agen.__anext__(), self.config.first_audio_timeout_ms / 1000.0)
            except StopAsyncIteration:
                reason = "error"  # an engine that says nothing at all did not work
            except TimeoutError:
                reason = "timeout"
            except asyncio.CancelledError:
                await _close(agen)
                raise
            except Exception as err:
                reason = "error"
                code = getattr(err, "code", type(err).__name__)
                log.warning("tts_primary_failed engine=%s language=%s code=%s chars=%d", voices.primary.engine, tag, code, len(primary_text))
                if code in BAD_TEXT_CODES:
                    reason = "bad_text"   # the provider refused THIS text (a 400/422), it is not down: this piece goes to the fallback, the call stays on the primary
                else:
                    self._off_for_call("error", voices.primary.engine, tag, err)
            else:
                self.served_engine = voices.primary.engine
                self.primary_chars += len(primary_text) if capped else 0   # what the primary bills: the characters it was given, once it has started speaking them
                self.first_audio_ms = self.first_audio_ms if self.first_audio_ms is not None else (time.perf_counter() - started) * 1000.0
                yield first
                died = False
                try:
                    async for chunk in agen:
                        yield chunk
                except Exception as err:
                    died = True
                    self._off_for_call("mid_stream", voices.primary.engine, tag, err)
                    self.fallback_reason = "mid_stream"
                finally:
                    await _close(agen)
                if not died:
                    return
                # the rest of the sentence is not lost: the fallback speaks the whole piece again
                async for chunk in self._fallback_piece(voices, language, fallback_text, tag):
                    yield chunk
                return
            await _close(agen)
            if reason != "bad_text":
                self._skip_primary_until[language] = self._clock() + self.config.cooldown_s
                if not self.primary_off:
                    self._off_for_call(reason, voices.primary.engine, tag, None)
                self._fallback_in_turn = True
            self.fallback_reason = reason
            log.warning("tts_fallback engine=%s language=%s reason=%s timeout_ms=%s", voices.fallback.engine, tag, reason, self.config.first_audio_timeout_ms)
        async for chunk in self._fallback_piece(voices, language, fallback_text, tag):
            yield chunk

    async def _strict_piece(self, voices: Any, language: str, text: str, tag: str) -> AsyncIterator[bytes]:
        """One piece with the chosen voice and NOTHING else (owner, 26 Nov 2026: "a user must always hear the voice they chose"). Over our own cap on the engine, or the engine down after STRICT_TRIES
        tries (same voice, longer wait for the first sound), is a closed error the screen turns into the words and one honest line; the other engine never speaks."""
        choice = voices.primary
        spoken_text = self._speech.prepare(text, language, choice.engine)
        capped = choice.engine == "cartesia"   # our cap is on Cartesia (app/voice/budget.py)
        if capped and self._budget_wait is not None:
            wait, self._budget_wait = self._budget_wait, None
            try:
                self.primary_budget = max(0, int(await asyncio.wait_for(asyncio.shield(asyncio.ensure_future(wait)), BUDGET_WAIT_S)))
            except Exception:  # noqa: BLE001 - no allowance in time: this voice cannot speak now
                self.primary_budget = 0
        if capped and self.primary_budget is not None and self.primary_chars + len(spoken_text) > self.primary_budget:
            self._off_for_call("budget", choice.engine, tag, None)
            raise VoiceError("tts_budget")
        timeout = max(self.config.first_audio_timeout_ms, STRICT_FIRST_AUDIO_MS) / 1000.0
        for attempt in range(1, STRICT_TRIES + 1):
            started = time.perf_counter()
            agen = self._engine(choice, language).stream(spoken_text, language)
            try:
                first = await asyncio.wait_for(agen.__anext__(), timeout)
            except asyncio.CancelledError:
                await _close(agen)
                raise
            except StopAsyncIteration:
                reason = "empty"
            except TimeoutError:
                reason = "timeout"
            except Exception as err:  # noqa: BLE001
                reason = getattr(err, "code", type(err).__name__)
                if reason in BAD_TEXT_CODES:
                    await _close(agen)
                    log.warning("tts_text_refused engine=%s language=%s code=%s", choice.engine, tag, reason)
                    raise VoiceError("tts_unavailable") from None   # THIS text is refused: no other voice says it
            else:
                self.served_engine = choice.engine
                self.primary_chars += len(spoken_text) if capped else 0
                self.first_audio_ms = self.first_audio_ms if self.first_audio_ms is not None else (time.perf_counter() - started) * 1000.0
                yield first
                try:
                    async for chunk in agen:
                        yield chunk
                except Exception as err:  # noqa: BLE001
                    log.warning("tts_strict_failed_mid_piece engine=%s language=%s code=%s", choice.engine, tag, getattr(err, "code", type(err).__name__))
                finally:
                    await _close(agen)
                return
            await _close(agen)
            log.warning("tts_strict_try_failed engine=%s language=%s attempt=%d reason=%s", choice.engine, tag, attempt, reason)
        self.fallback_reason = "unavailable"
        raise VoiceError("tts_unavailable")

    def _off_for_call(self, reason: str, engine: str, tag: str, err: BaseException | None) -> None:
        if self.primary_off:
            return
        self.primary_off = reason
        log.warning("tts_primary_off_for_call engine=%s language=%s reason=%s code=%s", engine, tag, reason, getattr(err, "code", type(err).__name__) if err is not None else reason)

    async def _fallback_piece(self, voices: Any, language: str, fallback_text: str, tag: str) -> AsyncIterator[bytes]:
        self._fallback_in_turn = True
        started = time.perf_counter()
        spoke = False
        try:
            async for chunk in self._engine(voices.fallback, language).stream(fallback_text, language):
                if not spoke:
                    spoke = True
                    self.served_engine = voices.fallback.engine
                    self.first_audio_ms = self.first_audio_ms if self.first_audio_ms is not None else (time.perf_counter() - started) * 1000.0
                yield chunk
        except Exception as err:
            if spoke:
                log.warning("tts_fallback_failed_mid_piece engine=%s language=%s code=%s", voices.fallback.engine, tag, getattr(err, "code", type(err).__name__))
                return
            raise VoiceError("tts_unavailable") from None
        if not spoke:
            raise VoiceError("tts_unavailable")
