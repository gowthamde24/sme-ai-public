"""The fake voice adapters (tests and local development): no socket, no key, no cost. The fake speech-to-text hears whatever it was told to hear; the fake text-to-speech returns a short valid WAV
(a quiet tone whose length follows the text), so a route can be tested end to end."""

# ruff: noqa: E501

from __future__ import annotations

import io
import math
import struct
import wave
from collections.abc import Sequence

from app.voice.interface import Price, Speech, Transcript, VoiceError


class FakeStt:
    name = "fake"
    price = Price(inr_per_minute=0.0, note="fake")

    def __init__(
        self,
        text: str = "What needs me today?",
        language: str | None = "en",
        fail: str | None = None,
    ) -> None:
        self.text, self.language, self.fail = text, language, fail
        self.calls: list[tuple[int, str, str | None, tuple[str, ...]]] = []

    def transcribe(
        self, audio: bytes, content_type: str, language: str | None, keyterms: Sequence[str] = ()
    ) -> Transcript:
        self.calls.append((len(audio), content_type, language, tuple(keyterms)))
        if self.fail:
            raise VoiceError(self.fail)
        return Transcript(self.text, self.language)


class FakeTts:
    name = "fake"
    price = Price(inr_per_1000_chars=0.0, note="fake")

    def __init__(self, fail: str | None = None) -> None:
        self.fail = fail
        self.calls: list[tuple[int, str]] = []

    def synthesize(self, text: str, language: str, *, speaker: str | None = None, pace: float | None = None) -> Speech:   # speaker and pace: only a provider with named speakers uses them
        self.calls.append((len(text), language))
        if self.fail:
            raise VoiceError(self.fail)
        return Speech(tone(min(3.0, 0.05 * len(text) + 0.1)), "audio/wav")


def tone(seconds: float, rate: int = 8000) -> bytes:
    """A mono 16-bit WAV of a quiet 440 Hz tone."""
    buffer = io.BytesIO()
    with wave.open(buffer, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(rate)
        frames = int(seconds * rate)
        w.writeframes(
            b"".join(
                struct.pack("<h", int(2000 * math.sin(2 * math.pi * 440 * i / rate)))
                for i in range(frames)
            )
        )
    return buffer.getvalue()


class FakeVoiceCloner:
    """A stand-in voice cloner for tests and local runs (job DP part 5): opens no socket, keeps no audio, returns a stable id for the same sample, and forgets a deleted voice."""

    name = "fake"

    def __init__(self, fail: str | None = None) -> None:
        self.fail = fail
        self.voices: dict[str, int] = {}   # id -> size of the sample it was made from (the audio itself is not kept)
        self.deleted: list[str] = []

    def create(self, sample: bytes, content_type: str, *, label: str) -> str:
        if self.fail:
            raise VoiceError(self.fail)
        import hashlib

        voice_id = "fake_clone_" + hashlib.sha256(sample).hexdigest()[:16]
        self.voices[voice_id] = len(sample)
        return voice_id

    def delete(self, voice_id: str) -> None:
        if self.fail == "delete_unreachable":
            raise VoiceError("unreachable")
        self.voices.pop(voice_id, None)
        self.deleted.append(voice_id)
