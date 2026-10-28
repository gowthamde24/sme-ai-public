"""The voice picker's listening sample (job DS, C2's question 3): the assistant says its own opening line in the chosen voice, language and way of sounding. One short clip, Owner and Admin only.

Sarvam credits are limited, so a sample is cached for 24 hours per (workspace, voice, language, style, name), a workspace may ask for six a minute, and the characters sent to the voice service are capped per workspace per day. A synthetic (fake) voice makes no sample: the answer is "no sample" and the screen says so. Nothing here is stored in the database and nothing personal is spoken: the line is the fixed everyday-spoken opening with the assistant's name and the business's name."""

from __future__ import annotations

import hashlib
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


# One reply after the opening line, so the preview sounds like a call and not a recording of one sentence ("call me later": the model line of native-lines/te.md; hi and kn are drafts for a native reader).
# Tamil and Malayalam have no reply line yet: their preview is the opening line alone.
REPLIES = {
    "en": "Sure, no problem. Which time shall I call you? Six in the evening, is that okay?",
    "te": "సరేనండీ, no problem. ఏ time కి call చేయమంటారు? సాయంత్రం ఆరు గంటలకి ఓకేనా?",
    "hi": "ठीक है, कोई बात नहीं। मैं किस time पर call करूँ? शाम को छह बजे ठीक रहेगा?",
    "kn": "ಸರಿ ಸರ್, no problem. ಯಾವ time ಗೆ call ಮಾಡಲಿ? ಸಂಜೆ ಆರು ಗಂಟೆಗೆ ಓಕೆನಾ?",
}


def preview_text(language: str, style: str, name: str, business: str, opening: str | None = None) -> str:
    """What the preview says: the opening line with the workspace's REAL assistant name and business name (or the Owner's own line, already filled: job DT ADR 0116), then one reply."""
    reply = REPLIES.get(language)
    opening = opening or line_for(language, style, name, business)
    return f"{opening} {reply}" if reply else opening


class VoiceSampleService:
    def __init__(self, tts: TextToSpeech | None, *, clock: Callable[[], float] = time.monotonic, today: Callable[[], str] | None = None) -> None:
        self._tts = tts
        self._clock = clock
        self._today = today or (lambda: time.strftime("%Y-%m-%d", time.gmtime()))
        self._cache: dict[tuple[uuid.UUID, str, str, str, str], _Entry] = {}   # (workspace, voice, language, style, sha-256 of the SPOKEN TEXT): a renamed business never hears an old name
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
        return self._speak(tenant_id, voice, language, style, line_for(language, style, chosen, business))

    def preview(self, tenant_id: uuid.UUID, business: str, voice: str, language: str, style: str, name: str | None, opening: str | None = None) -> tuple[str, Speech]:
        """The opening line and one reply, in the workspace's real names, language and way of sounding (the same cache, rate limit and daily cap as the sample)."""
        if not self.available() or self._tts is None or voice not in PERSONAS or language not in LANGUAGES or style not in STYLES:
            raise NoSample
        chosen = (name or DEFAULT_NAME).strip()
        if not NAME_OK.match(chosen):
            raise NoSample
        text = preview_text(language, style, chosen, business, opening)
        return text, self._speak(tenant_id, voice, language, style, text)

    def _speak(self, tenant_id: uuid.UUID, voice: str, language: str, style: str, text: str) -> Speech:
        if self._tts is None:
            raise NoSample
        key = (tenant_id, voice, language, style, hashlib.sha256(text.encode()).hexdigest())
        now = self._clock()
        with self._lock:
            hit = self._cache.get(key)
            if hit is not None and hit.expires > now:
                return hit.speech
        if not self._minute.allow(str(tenant_id)):
            raise RateLimited(int(self._minute.retry_after(str(tenant_id))) or 1)
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
