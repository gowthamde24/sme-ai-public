"""The voice of a call with a safety net (job natural-voice, owner decision 28 Oct 2026): speak with the language's primary engine (Cartesia); if it fails, or has produced no audio within the first-audio
timeout (800 ms by default), speak the same text with the fallback engine (Sarvam Bulbul v4 Flash). Which engine served is recorded for every turn.

  * Per language and from data (voices.py): `stream(text, language)` looks the voices up each time, so the Conversation needs no engine knowledge.
  * Within one turn the voice does not change back and forth: once the fallback has spoken in a turn, the rest of that turn stays on it.
  * After a primary failure the primary is skipped for `cooldown_s` (a bad minute then costs one slow sentence, not 800 ms on every sentence); a primary that works again is tried after the cooldown.
  * A failure AFTER the first audio of a piece cannot be hidden (the caller already heard half a sentence): the piece ends there, the failure is counted, and the next piece goes to the fallback.
  * Both engines failing is `VoiceError("tts_unavailable")`: the loop above decides what to say (a filler, a hand-over).

Logs carry only engine ids, language, voice labels and milliseconds: never text, audio or a key."""

# ruff: noqa: E501

from __future__ import annotations

import asyncio
import logging
import time
from collections.abc import AsyncIterator, Callable, Mapping
from contextlib import suppress

from app.agents.register import address
from app.conversation.parts import StreamingTts
from app.conversation.pronounce import Pronunciations, default_pronunciations
from app.conversation.voices import VoiceChoice, VoiceConfig
from app.voice.interface import VoiceError

log = logging.getLogger("app.conversation.voice")

EngineFactory = Callable[[VoiceChoice, str], StreamingTts]  # (the chosen voice, the language) -> a ready engine


async def _close(it: object) -> None:
    aclose = getattr(it, "aclose", None)
    if aclose is not None:
        with suppress(Exception):
            await aclose()


class FallbackTts:
    sample_rate = 24000

    def __init__(self, config: VoiceConfig, factory: EngineFactory, *, prewarm_language: str = "te", clock: Callable[[], float] = time.monotonic, chosen: Mapping[str, str] | None = None, gender: str = "female", pronunciations: Pronunciations | None = None) -> None:
        self._pron = pronunciations or default_pronunciations()  # words respelled before any engine hears them (a workspace passes its own additions)
        self.config, self._factory, self._prewarm_language, self._clock = config, factory, prewarm_language, clock
        self.address_allow: tuple[str, ...] = ()   # the word of address the person chose in their profile (the owner chat); a call or a preview speaks none, whatever the model wrote
        self.gender = gender   # the workspace's voice gender: a chosen voice of the other gender is ignored (the gender's default speaks)
        self._chosen: dict[str, str] = dict(chosen or {})  # the workspace's voice id per language (job voice-picker); a missing or unknown one means the default
        self._engines: dict[tuple[str, str, str, str], StreamingTts] = {}
        self._skip_primary_until: dict[str, float] = {}
        self._fallback_in_turn = False
        self.served_engine = ""  # the engine that spoke the most recent piece: cartesia | sarvam_v4
        self.fallback_reason = ""  # "", "error", "timeout", "cooldown", "mid_stream"
        self.first_audio_ms: float | None = None

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
        text = address.clean(text, self.address_allow)   # the last gate: nothing says sir / madam aloud unless the person asked for it
        voices = self.config.for_language(language, self._chosen.get(language), self.gender)
        primary_text = self._pron.apply(text, language, voices.primary.engine)
        fallback_text = self._pron.apply(text, language, voices.fallback.engine)
        now = self._clock()
        use_primary = not self._fallback_in_turn and now >= self._skip_primary_until.get(language, 0.0)
        if not use_primary and not self._fallback_in_turn:
            self.fallback_reason = self.fallback_reason or "cooldown"
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
                log.warning("tts_primary_failed engine=%s language=%s code=%s", voices.primary.engine, language, getattr(err, "code", type(err).__name__))
            else:
                self.served_engine = voices.primary.engine
                self.first_audio_ms = self.first_audio_ms if self.first_audio_ms is not None else (time.perf_counter() - started) * 1000.0
                yield first
                try:
                    async for chunk in agen:
                        yield chunk
                except Exception as err:
                    self._skip_primary_until[language] = self._clock() + self.config.cooldown_s
                    self.fallback_reason = "mid_stream"
                    log.warning("tts_primary_failed_mid_piece engine=%s language=%s code=%s", voices.primary.engine, language, getattr(err, "code", type(err).__name__))
                finally:
                    await _close(agen)
                return
            await _close(agen)
            self._skip_primary_until[language] = self._clock() + self.config.cooldown_s
            self.fallback_reason = reason
            self._fallback_in_turn = True
            log.warning("tts_fallback engine=%s language=%s reason=%s timeout_ms=%s", voices.fallback.engine, language, reason, self.config.first_audio_timeout_ms)
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
                log.warning("tts_fallback_failed_mid_piece engine=%s language=%s code=%s", voices.fallback.engine, language, getattr(err, "code", type(err).__name__))
                return
            raise VoiceError("tts_unavailable") from None
        if not spoke:
            raise VoiceError("tts_unavailable")
