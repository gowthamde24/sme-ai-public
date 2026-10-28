"""The small shared types of the streaming conversation loop (job natural-voice): what a speech recogniser says as it goes, what the loop measures, and the interfaces its parts speak.

Nothing here reads the network, a key or the database; the providers are in providers.py and the fakes in fakes.py. Audio is 16-bit mono PCM; a part says its own sample rate."""

# ruff: noqa: E501

from __future__ import annotations

from collections.abc import AsyncIterator
from dataclasses import dataclass, field
from typing import Literal, Protocol

SttKind = Literal["speech_start", "speech_end", "partial", "final"]


@dataclass(frozen=True)
class SttEvent:
    kind: SttKind
    text: str = ""


@dataclass
class TurnTimings:
    """Seconds on the loop's clock; every field starts as None and is set by the loop. The report numbers are the milliseconds below.

    end_of_speech_at  the last frame of the caller's speech was sent (set by the audio source; the caller's own clock)
    eot_at            the recogniser said the turn is over (its VAD event)
    final_at          the final transcript arrived
    llm_request_at    the language model was asked
    first_token_at    the first piece of its reply arrived
    tts_request_at    the first clause went to the voice
    first_audio_at    the first audio of the reply reached the line (the number the caller feels)"""

    end_of_speech_at: float | None = None
    eot_at: float | None = None
    final_at: float | None = None
    llm_request_at: float | None = None
    first_token_at: float | None = None
    tts_request_at: float | None = None
    first_audio_at: float | None = None
    done_at: float | None = None
    model_tier: str = ""
    reply_text: str = ""
    filler_played: bool = False
    interrupted: bool = False
    clauses: int = 0

    @staticmethod
    def _ms(a: float | None, b: float | None) -> float | None:
        return None if a is None or b is None else (b - a) * 1000.0

    @property
    def eot_ms(self) -> float | None:
        """Silence the recogniser waited, plus its own delay, after the caller stopped."""
        return self._ms(self.end_of_speech_at, self.eot_at)

    @property
    def stt_final_ms(self) -> float | None:
        """From the end-of-turn decision to the final transcript."""
        return self._ms(self.eot_at, self.final_at)

    @property
    def llm_first_token_ms(self) -> float | None:
        return self._ms(self.llm_request_at, self.first_token_at)

    @property
    def tts_first_audio_ms(self) -> float | None:
        return self._ms(self.tts_request_at, self.first_audio_at)

    @property
    def after_final_ms(self) -> float | None:
        """From the final transcript to the first audio: the part the loop itself controls."""
        return self._ms(self.final_at, self.first_audio_at)

    @property
    def total_ms(self) -> float | None:
        """From the last word the caller spoke to the first audio they hear: what they feel."""
        return self._ms(self.end_of_speech_at, self.first_audio_at)


class AudioSource(Protocol):
    """The caller's side of the line: frames paced as the line delivers them. `speech_ended_at` is set (on the loop's clock) when the last frame of speech has been handed out."""

    speech_ended_at: float | None

    def frames(self) -> AsyncIterator[bytes]: ...


class StreamingStt(Protocol):
    sample_rate: int

    def events(self, frames: AsyncIterator[bytes]) -> AsyncIterator[SttEvent]:
        """Send the frames as they come; yield what the recogniser says. Closing the iterator closes the connection."""
        ...


class StreamingLlm(Protocol):
    def stream(self, system: str, messages: list[dict[str, str]], model: str) -> AsyncIterator[str]:
        """The reply in pieces as the model writes it."""
        ...


class StreamingTts(Protocol):
    sample_rate: int

    async def prewarm(self) -> None:
        """Open the connection while the model is still thinking (a no-op for a provider that needs none)."""
        ...

    def stream(self, text: str, language: str) -> AsyncIterator[bytes]:
        """The audio of `text` in pieces of 16-bit mono PCM. Closing the iterator stops the provider."""
        ...


class Playout(Protocol):
    """The line towards the caller."""

    @property
    def active(self) -> bool: ...

    async def write(self, pcm: bytes) -> None: ...

    async def stop(self) -> None:
        """Stop playing and drop everything queued, now."""
        ...


@dataclass
class Session:
    """What the loop remembers between turns."""

    system: str
    language: str
    history: list[dict[str, str]] = field(default_factory=list)
