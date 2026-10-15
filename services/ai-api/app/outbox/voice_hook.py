"""The voice note of a campaign message (job CV, ADR 0088): at the moment the worker hands a claimed message to the channel it asks the database whether the message is a voice note
(`scheduler_voice_plan`: the module, the business's switch, the campaign's switch, a voice for the language, a usable spoken disclosure, the fair-use allowance, the length), and if so makes the audio
from the text the database returned (the disclosure first, then the words the Owner approved) with the text-to-speech provider, and tells the database how many seconds it came to
(`scheduler_voice_record`). The audio is held in memory for this one send; it is not stored and not logged, and neither are the words.

Safe by construction: this hook never raises, and any trouble (no provider, a provider error, an answer of an unexpected shape, audio that is not valid) gives None, so the message goes as TEXT, as it
would have without voice. The text is never held back for the audio."""

from __future__ import annotations

import logging
import uuid
from typing import Any, Protocol

from app.outbox.adapter import AudioClip
from app.voice.audio import MAX_SECONDS, AudioRefused, inspect_audio
from app.voice.interface import LANGUAGES, TextToSpeech, VoiceError

logger = logging.getLogger("app.outbox.voice_hook")

MAX_CHARS = 600  # the database refuses a longer text; this is the second check


class VoicePort(Protocol):
    """The two calls the hook needs from the scheduler's repository."""

    def voice_plan(self, token: str, tenant_id: uuid.UUID, message_id: uuid.UUID) -> dict[str, Any]: ...
    def voice_record(self, token: str, args: dict[str, Any]) -> dict[str, Any]: ...


class VoiceNotes:
    def __init__(self, repository: VoicePort, tts: TextToSpeech | None) -> None:
        self._repository = repository
        self._tts = tts

    def clip_for(self, token: str, tenant_id: uuid.UUID, message_id: uuid.UUID) -> AudioClip | None:
        """The spoken copy of one claimed message, or None (send the text alone). Never raises."""
        if self._tts is None:
            return None
        try:
            plan = self._repository.voice_plan(token, tenant_id, message_id)
            if plan.get("voice") is not True:
                return None
            text, language = plan.get("text"), plan.get("language")
            voice_code = plan.get("voice_code")
            if (
                not isinstance(text, str)
                or not text
                or len(text) > MAX_CHARS
                or language not in LANGUAGES
                or not isinstance(voice_code, str)
            ):
                return None
            speech = self._tts.synthesize(text, str(language))
            info = inspect_audio(speech.audio)
            seconds = info.charged_seconds
            if info.seconds is not None and info.seconds > MAX_SECONDS:
                return None
            # the seconds are recorded BEFORE the audio goes anywhere: if the record is refused the audio is not sent
            self._repository.voice_record(
                token,
                {
                    "p_tenant_id": str(tenant_id),
                    "p_message_id": str(message_id),
                    "p_language": language,
                    "p_voice_code": voice_code,
                    "p_seconds": seconds,
                    "p_chars": len(text),
                },
            )
            return AudioClip(speech.audio, info.content_type, seconds)
        except (VoiceError, AudioRefused) as exc:
            logger.warning("voice note: no audio this time (%s); the text goes alone", exc.code)
        except Exception as exc:  # the text must go whatever happens here; only the class is kept
            logger.warning(
                "voice note: no audio this time (%s); the text goes alone", exc.__class__.__name__
            )
        return None
