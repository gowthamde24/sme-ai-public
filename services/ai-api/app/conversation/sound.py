"""How the assistant SOUNDS, decided in ONE place (owner findings of 19 Nov 2026: "previews do not equal real calls", "Friendly and Respectful used the same voice", "Warm, Calm, Bright sound the same").

`resolve_sound(config, stored, language)` is the one function that turns what a workspace saved into what a customer hears: the voice (name, gender, provider), the tone (friendly | respectful | quick), the speaking speed. A real phone call and every preview (the opening-line preview, the AI-assistant
voice preview, the test call) call THIS function with the same kind of input, `Stored`; they differ only in WHO READS the stored values (the phone line reads them with the scheduler account, a preview with the signed-in
member's token), never in what is done with them. The tone changes the words and the pacing; the voice and the loudness (app/voice/loudness.py) are the same for all three tones.

Pure: no network, no database, no key."""

# ruff: noqa: E501

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass, field
from typing import Any

from app.conversation.voices import CatalogueVoice, VoiceConfig
from app.telephony import tone as tone_mod

SPEED_MIN, SPEED_MAX = 0.75, 1.25   # the range of Settings > AI assistant; 1.0 = the engine's own pace


@dataclass(frozen=True)
class Stored:
    """What the workspace saved, as read from the database (any part may be missing: the defaults speak)."""

    choices: Mapping[str, str] = field(default_factory=dict)   # {language: catalogue voice id}
    gender: str = "female"
    speed: float | None = None                                 # assistant_settings.speed
    style: str | None = None                                   # assistant_settings.style: warm | respectful | quick (only when the settings were saved)
    training: Mapping[str, Any] | None = None                  # the Talk training document: `tone`, `background`
    pack_tone: str = tone_mod.DEFAULT_TONE                     # the business type's default tone

    @staticmethod
    def from_call_row(row: Mapping[str, Any] | None, training: Mapping[str, Any] | None = None, pack_tone: str = tone_mod.DEFAULT_TONE) -> Stored:
        """From the answer of public.call_sound_for_call (the phone line) or the same keys read for a preview: {choices, gender, speed, style}."""
        row = row or {}
        choices = row.get("choices")
        gender = row.get("gender")
        speed = row.get("speed")
        style = row.get("style")
        return Stored(
            choices={str(k): str(v) for k, v in choices.items()} if isinstance(choices, dict) else {},
            gender=gender if gender in ("female", "male") else "female",
            speed=float(speed) if isinstance(speed, int | float) and not isinstance(speed, bool) else None,
            style=style if isinstance(style, str) else None,
            training=training,
            pack_tone=pack_tone,
        )


@dataclass(frozen=True)
class Sound:
    language: str
    voice: CatalogueVoice
    tone: str
    tone_source: str
    pace: float

    @property
    def gender(self) -> str:
        return self.voice.gender

    def public(self) -> dict[str, Any]:
        """What a screen and a log may show about it (no text, no provider voice id)."""
        return {"language": self.language, "voice_id": self.voice.id, "voice_name": self.voice.name, "gender": self.voice.gender, "provider": self.voice.provider, "tone": self.tone, "speed": self.pace}


def clamp_speed(speed: float | None) -> float:
    return 1.0 if speed is None else round(max(SPEED_MIN, min(SPEED_MAX, float(speed))), 2)


def resolve_sound(config: VoiceConfig, stored: Stored, language: str, *, voice_id: str | None = None, tone: str | None = None, speed: float | None = None) -> Sound:
    """The sound of `language` for a workspace. `voice_id`, `tone`, `speed` are what a screen wants to HEAR before it saves (a preview of an unsaved choice): they replace the stored value of that one part and go through the same checks."""
    voice = config.resolve(language, voice_id if voice_id is not None else stored.choices.get(language), stored.gender)
    if tone is not None and tone in tone_mod.CHOICES:
        chosen, source = tone, "preview"
    else:
        chosen, source = tone_mod.effective_tone(dict(stored.training) if stored.training is not None else None, stored.pack_tone, stored.style)
    return Sound(language=language, voice=voice, tone=chosen, tone_source=source, pace=clamp_speed(speed if speed is not None else stored.speed))
