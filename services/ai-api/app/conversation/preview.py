"""Speak the opening line with a workspace's active voice (job voice-picker): the one thing in the picker that spends voice-provider characters, so it is cached by voice and text and capped per workspace and day."""

# ruff: noqa: E501

from __future__ import annotations

import hashlib
import io
import time
import uuid
import wave
from collections import OrderedDict
from collections.abc import Callable

from app.conversation.fallback import EngineFactory, FallbackTts
from app.conversation.voices import VoiceConfig
from app.voice.interface import VoiceError

PREVIEW_DAILY_CHARS = 3000  # per workspace and day (the voice provider's characters cost money)
PREVIEW_CACHE = 48


class CallVoicePreview:
    """Speaks a short text with the active voice of a language through the same engines a call uses (Cartesia, then Bulbul v4 Flash). Cached by voice and text; a daily character cap per workspace."""

    def __init__(self, config: VoiceConfig, factory: EngineFactory, *, clock: Callable[[], float] = time.monotonic, today: Callable[[], str] | None = None) -> None:
        self._config, self._factory, self._clock = config, factory, clock
        self._today = today or (lambda: time.strftime("%Y-%m-%d"))
        self._cache: OrderedDict[str, tuple[bytes, str, str]] = OrderedDict()
        self._spent: dict[tuple[str, str], int] = {}

    async def speak(self, tenant_id: uuid.UUID, language: str, chosen: str | None, text: str, gender: str = "female") -> tuple[bytes, str, str]:
        """(wav, the engine that spoke, the catalogue voice id). Raises VoiceError('rate_limited') over the daily cap and VoiceError('tts_unavailable') when no engine could."""
        voice = self._config.resolve(language, chosen, gender)
        key = hashlib.sha256(f"{voice.id}|{text}".encode()).hexdigest()
        hit = self._cache.get(key)
        if hit is not None:
            self._cache.move_to_end(key)
            return hit
        slot = (str(tenant_id), self._today())
        if self._spent.get(slot, 0) + len(text) > PREVIEW_DAILY_CHARS:
            raise VoiceError("rate_limited")
        self._spent = {k: v for k, v in self._spent.items() if k[1] == slot[1]}
        self._spent[slot] = self._spent.get(slot, 0) + len(text)
        tts = FallbackTts(self._config, self._factory, chosen={language: voice.id}, gender=gender, clock=self._clock)
        tts.begin_turn()
        pcm = b"".join([c async for c in tts.stream(text, language)])
        buf = io.BytesIO()
        with wave.open(buf, "wb") as w:
            w.setnchannels(1)
            w.setsampwidth(2)
            w.setframerate(tts.sample_rate)
            w.writeframes(pcm[: len(pcm) // 2 * 2])
        self._cache[key] = (buf.getvalue(), tts.served_engine, voice.id)
        while len(self._cache) > PREVIEW_CACHE:
            self._cache.popitem(last=False)
        return self._cache[key]
