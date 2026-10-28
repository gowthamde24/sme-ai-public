"""End-of-turn detection by the caller's silence (job natural-voice): how long the line must be quiet before we take the turn, per language, and a small energy detector that applies it.

Long silences are what make an assistant feel slow: the default here is 300 to 450 ms, not the 700 to 1,000 ms of a generic voice activity detector. The recogniser's own VAD (Sarvam's `silence_duration_ms`) takes the same number from `endpoint_ms`. This detector is also what listens WHILE the assistant is speaking (barge-in): the recogniser may not be connected then.

Pure: no network, no clock; the caller feeds it one frame at a time."""

# ruff: noqa: E501

from __future__ import annotations

import array
from collections.abc import Iterable
from dataclasses import dataclass

# milliseconds of silence that end a turn, per language (everyday Telugu and Hindi turns are short and fast; Tamil and Malayalam sentences trail longer)
SILENCE_MS: dict[str, int] = {"te": 350, "hi": 350, "kn": 380, "ta": 420, "ml": 420, "en": 300}
DEFAULT_SILENCE_MS = 350
LOWEST_MS, HIGHEST_MS = 200, 800  # what a configured value may be


def endpoint_ms(language: str, override: int | None = None) -> int:
    """The silence that ends a turn in `language`; an owner's setting (`override`) is kept inside a sane range."""
    value = override if override is not None else SILENCE_MS.get(language, DEFAULT_SILENCE_MS)
    return max(LOWEST_MS, min(HIGHEST_MS, int(value)))


def rms(frame: bytes) -> float:
    """Loudness of a 16-bit mono PCM frame, 0..32768."""
    samples = array.array("h")
    samples.frombytes(frame[: len(frame) // 2 * 2])
    if not samples:
        return 0.0
    return float((sum(s * s for s in samples) / len(samples)) ** 0.5)


@dataclass
class EnergyEndpointer:
    """speech_start after `min_speech_ms` of sound, speech_end after `silence_ms` of quiet that follows speech."""

    silence_ms: int = DEFAULT_SILENCE_MS
    min_speech_ms: int = 120
    threshold: float = 500.0
    frame_ms: int = 20
    _speech_ms: int = 0
    _quiet_ms: int = 0
    _in_speech: bool = False

    def feed(self, frame: bytes) -> list[str]:
        events: list[str] = []
        if rms(frame) >= self.threshold:
            self._quiet_ms = 0
            self._speech_ms += self.frame_ms
            if not self._in_speech and self._speech_ms >= self.min_speech_ms:
                self._in_speech = True
                events.append("speech_start")
        else:
            if not self._in_speech:
                self._speech_ms = 0
            else:
                self._quiet_ms += self.frame_ms
                if self._quiet_ms >= self.silence_ms:
                    self._in_speech = False
                    self._speech_ms = 0
                    self._quiet_ms = 0
                    events.append("speech_end")
        return events

    def run(self, frames: Iterable[bytes]) -> list[tuple[int, str]]:
        """(frame index, event) for a whole recording: used by tests and tuning."""
        return [(i, e) for i, frame in enumerate(frames) for e in self.feed(frame)]
