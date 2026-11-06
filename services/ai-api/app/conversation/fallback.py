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
from app.conversation.parts import StreamingTts
from app.conversation.pronounce import Pronunciations, default_pronunciations
from app.conversation.voices import VoiceChoice, VoiceConfig
from app.pronunciation.lexicon import OwnerWord
from app.pronunciation.speech import SpeechText
from app.voice.interface import VoiceError

log = logging.getLogger("app.conversation.voice")
BUDGET_WAIT_S = 1.5
BUDGETED_ENGINE = "cartesia"   # our spending cap (app/voice/budget.py) is on this engine only: a language whose primary is Sarvam (Marathi) is never counted or capped

EngineFactory = Callable[[VoiceChoice, str], StreamingTts]  # (the chosen voice, the language) -> a ready engine


async def _close(it: object) -> None:
    aclose = getattr(it, "aclose", None)
    if aclose is not None:
        with suppress(Exception):
            await aclose()


class FallbackTts:
    sample_rate = 24000

    def __init__(self, config: VoiceConfig, factory: EngineFactory, *, prewarm_language: str = "te", clock: Callable[[], float] = time.monotonic, chosen: Mapping[str, str] | None = None, gender: str = "female", pronunciations: Pronunciations | None = None) -> None:
        self._speech = SpeechText(pronunciations or default_pronunciations())  # what an engine is given: normalised text, the lexicon (script, a workspace's own words), the English respellings
        self.config, self._factory, self._prewarm_language, self._clock = config, factory, prewarm_language, clock
        self.address_allow: tuple[str, ...] = ()   # the word of address the person chose in their profile (the owner chat); a call or a preview speaks none, whatever the model wrote
        self.gender = gender   # the workspace's voice gender: a chosen voice of the other gender is ignored (the gender's default speaks)
        self._chosen: dict[str, str] = dict(chosen or {})  # the workspace's voice id per language (job voice-picker); a missing or unknown one means the default
        self._engines: dict[tuple[str, str, str, str], StreamingTts] = {}
        self._skip_primary_until: dict[str, float] = {}
        self._fallback_in_turn = False
        self.served_engine = ""  # the engine that spoke the most recent piece: cartesia | sarvam_v4
        self.served_primary = False  # the most recent piece came from the language's PRIMARY voice (what a kept greeting must be)
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
        self.served_engine = self.fallback_reason = ""
        self.served_primary = False
        self.first_audio_ms = None

    def _engine(self, choice: VoiceChoice, language: str) -> StreamingTts:
        key = (language, choice.engine, choice.model, choice.voice)
        if key not in self._engines:
            self._engines[key] = self._factory(choice, language)
        return self._engines[key]

    async def prewarm(self) -> None:
        voices = self.config.for_language(self._prewarm_language, self._chosen.get(self._prewarm_language), self.gender)
        with suppress(Exception):
            await self._engine(voices.primary, self._prewarm_language).prewarm()

    # ---- one piece of text ----------------------------------------------------------------------------------------------------------------

    async def stream(self, text: str, language: str) -> AsyncIterator[bytes]:
        tag = language if language in ("en", "te", "hi", "kn", "ta", "ml", "mr") else "other"   # what the log says about the language is one of ours, never the caller's string
        text = address.clean(text, self.address_allow)   # the last gate: nothing says sir / madam aloud unless the person asked for it
        voices = self.config.for_language(language, self._chosen.get(language), self.gender)
        primary_text = self._speech.prepare(text, language, voices.primary.engine)
        fallback_text = self._speech.prepare(text, language, voices.fallback.engine)
        now = self._clock()
        use_primary = not self.primary_off and not self._fallback_in_turn and now >= self._skip_primary_until.get(language, 0.0)
        budgeted = voices.primary.engine == BUDGETED_ENGINE
        if use_primary and budgeted and self._budget_wait is not None:
            wait, self._budget_wait = self._budget_wait, None
            try:
                self.primary_budget = max(0, int(await asyncio.wait_for(asyncio.shield(asyncio.ensure_future(wait)), BUDGET_WAIT_S)))
            except Exception:  # noqa: BLE001 - no allowance in time: the fallback speaks (never over the cap)
                self.primary_budget = 0
        if use_primary and budgeted and self.primary_budget is not None and self.primary_chars + len(primary_text) > self.primary_budget:
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
                log.warning("tts_primary_failed engine=%s language=%s code=%s", voices.primary.engine, tag, getattr(err, "code", type(err).__name__))
                self._off_for_call("error", voices.primary.engine, tag, err)
            else:
                self.served_engine, self.served_primary = voices.primary.engine, True
                if budgeted:
                    self.primary_chars += len(primary_text)   # what the capped engine bills: the characters it was given, once it has started speaking them
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
            self._skip_primary_until[language] = self._clock() + self.config.cooldown_s
            if not self.primary_off:
                self._off_for_call(reason, voices.primary.engine, tag, None)
            self.fallback_reason = reason
            self._fallback_in_turn = True
            log.warning("tts_fallback engine=%s language=%s reason=%s timeout_ms=%s", voices.fallback.engine, tag, reason, self.config.first_audio_timeout_ms)
        async for chunk in self._fallback_piece(voices, language, fallback_text, tag):
            yield chunk

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
                    self.served_engine, self.served_primary = voices.fallback.engine, False
                    self.first_audio_ms = self.first_audio_ms if self.first_audio_ms is not None else (time.perf_counter() - started) * 1000.0
                yield chunk
        except Exception as err:
            if spoke:
                log.warning("tts_fallback_failed_mid_piece engine=%s language=%s code=%s", voices.fallback.engine, tag, getattr(err, "code", type(err).__name__))
                return
            raise VoiceError("tts_unavailable") from None
        if not spoke:
            raise VoiceError("tts_unavailable")
