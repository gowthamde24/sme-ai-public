"""Voice, behind one interface (job BD, ADR 0071): speech-to-text and text-to-speech.

Domain code (the assistant's voice route, the bake-off) talks to `SpeechToText` and `TextToSpeech` only; each provider (Sarvam, Bhashini, Google Cloud, an AI4Bharat model behind an address the owner
runs) is one small adapter in this package, switched on ONLY by environment variables the owner sets (a key is never in code, never logged, never returned). The fake adapter (fake.py) is what the tests
use: it opens no socket.

An error carries a constant CODE (timeout, unreachable, http_429, bad_response, unsupported_audio ...): never the provider's text, a key or an address, so nothing a person said can reach a log through
an error. Audio and transcripts are never logged anywhere in this package."""

# ruff: noqa: E501

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass
from typing import Literal, Protocol

Language = Literal["en", "te", "hi", "kn", "ta"]
LANGUAGES: tuple[str, ...] = ("en", "te", "hi", "kn", "ta")
# the BCP-47 tags the providers use
TAGS: dict[str, str] = {"en": "en-IN", "te": "te-IN", "hi": "hi-IN", "kn": "kn-IN", "ta": "ta-IN"}


class VoiceError(Exception):
    """A constant code only."""

    def __init__(self, code: str) -> None:
        super().__init__(code)
        self.code = code


@dataclass(frozen=True)
class Transcript:
    text: str
    language: str | None = (
        None  # a code of LANGUAGES when the provider says which language it heard
    )


@dataclass(frozen=True)
class Speech:
    audio: bytes
    content_type: str


@dataclass(frozen=True)
class Price:
    """What a provider's own price list says (research, not a bill): used by the bake-off and the reports. None = not published."""

    inr_per_minute: float | None = None  # speech-to-text
    inr_per_1000_chars: float | None = None  # text-to-speech
    usd_per_minute: float | None = None
    usd_per_1000_chars: float | None = None
    note: str = ""


class SpeechToText(Protocol):
    name: str
    price: Price

    def transcribe(
        self, audio: bytes, content_type: str, language: str | None, keyterms: Sequence[str] = ()
    ) -> Transcript: ...


class TextToSpeech(Protocol):
    name: str
    price: Price

    def synthesize(self, text: str, language: str) -> Speech: ...


@dataclass(frozen=True)
class VoiceStack:
    """What the API has configured. Either part may be absent; with neither, voice is off."""

    stt: SpeechToText | None = None
    tts: TextToSpeech | None = None

    @property
    def enabled(self) -> bool:
        return self.stt is not None


def language_of_tag(tag: str | None) -> str | None:
    """'te-IN' -> 'te' when it is one of ours, else None."""
    if not tag:
        return None
    short = tag.split("-")[0].lower()
    return short if short in LANGUAGES else None
