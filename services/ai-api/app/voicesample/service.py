"""The voice picker's listening sample (job DS, C2's question 3): the assistant says its own opening line in the chosen voice, language and way of sounding. One short clip, Owner and Admin only.

Sarvam credits are limited, so a sample is cached for 24 hours per (workspace, voice, language, style, name), a workspace may ask for six a minute, and the characters sent to the voice service are capped per workspace per day. A synthetic (fake) voice makes no sample: the answer is "no sample" and the screen says so. Nothing here is stored in the database and nothing personal is spoken: the line is the fixed everyday-spoken opening with the assistant's name and the business's name."""

from __future__ import annotations

import re
import threading
import time
import uuid
from collections.abc import Callable
from dataclasses import dataclass

from app.assistant_settings import data as settings_data
from app.integrations.ratelimit import SlidingWindow
from app.voice.interface import Speech, TextToSpeech, VoiceError

PERSONAS = ("female_warm", "female_clear", "male_calm", "male_lively")
LANGUAGES = ("en", "te", "hi", "kn", "ta", "ml")
# the four personas on Sarvam Bulbul v3 speakers (docs.sarvam.ai lists no genders; chosen by name, to be confirmed by a native listener)
SPEAKERS = {"female_warm": "ritu", "female_clear": "priya", "male_calm": "aditya", "male_lively": "rahul"}
# "warm": normal pace, more expressive; "quick": faster and steadier (listening only: nothing is saved)
STYLES: dict[str, tuple[float, float]] = {"warm": (1.0, 0.7), "quick": (1.15, 0.4)}
NAME_OK = re.compile(r"^[^<>{}@/\\|]{1,24}$")
DEFAULT_NAME = "Vijaya"
MAX_BYTES = 2_000_000
CACHE_SECONDS = 24 * 3600
DAILY_CHAR_CAP = 3000
PER_MINUTE = 6


class NoSample(Exception):
    """There is no sample for this choice (the voice is synthetic or the language is not offered)."""


class RateLimited(Exception):
    def __init__(self, retry_after: int) -> None:
        super().__init__("rate limited")
        self.retry_after = retry_after


@dataclass
class _Entry:
    expires: float
    speech: Speech


def line_for(language: str, style: str, name: str, business: str) -> str:
    """The words: the assistant's opening line in the everyday spoken style (the sample lines of the AI-assistant settings, which always say it is an AI assistant)."""
    return settings_data.sample(None, language, "warm" if style == "warm" else "quick", name, business)


class VoiceSampleService:
    def __init__(self, tts: TextToSpeech | None, *, clock: Callable[[], float] = time.monotonic, today: Callable[[], str] | None = None) -> None:
        self._tts = tts
        self._clock = clock
        self._today = today or (lambda: time.strftime("%Y-%m-%d", time.gmtime()))
        self._cache: dict[tuple[uuid.UUID, str, str, str, str], _Entry] = {}
        self._minute = SlidingWindow(PER_MINUTE, 60.0, clock=clock)
        self._spent: dict[tuple[uuid.UUID, str], int] = {}
        self._lock = threading.Lock()

    def available(self) -> bool:
        return self._tts is not None and self._tts.name != "fake"

    def sample(self, tenant_id: uuid.UUID, business: str, voice: str, language: str, style: str, name: str | None) -> Speech:
        if not self.available() or self._tts is None or voice not in PERSONAS or language not in LANGUAGES or style not in STYLES:
            raise NoSample
        chosen = (name or DEFAULT_NAME).strip()
        if not NAME_OK.match(chosen):
            raise NoSample
        key = (tenant_id, voice, language, style, chosen)
        now = self._clock()
        with self._lock:
            hit = self._cache.get(key)
            if hit is not None and hit.expires > now:
                return hit.speech
        if not self._minute.allow(str(tenant_id)):
            raise RateLimited(int(self._minute.retry_after(str(tenant_id))) or 1)
        text = line_for(language, style, chosen, business)
        day = (tenant_id, self._today())
        with self._lock:
            if self._spent.get(day, 0) + len(text) > DAILY_CHAR_CAP:
                raise RateLimited(3600)
            self._spent[day] = self._spent.get(day, 0) + len(text)   # counted when the request is made, as the provider bills it
        pace, temperature = STYLES[style]
        try:
            if self._tts.name == "sarvam":
                speech = self._tts.synthesize(text, language, speaker=SPEAKERS[voice], pace=pace, temperature=temperature)   # type: ignore[call-arg]
            else:
                speech = self._tts.synthesize(text, language, speaker=SPEAKERS[voice], pace=pace)
        except VoiceError as exc:
            raise NoSample from exc
        if len(speech.audio) > MAX_BYTES:
            raise NoSample
        with self._lock:
            self._cache[key] = _Entry(now + CACHE_SECONDS, speech)
            if len(self._cache) > 500:
                for stale in [k for k, e in self._cache.items() if e.expires <= now]:
                    self._cache.pop(stale, None)
        return speech
