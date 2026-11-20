"""Sarvam AI (https://docs.sarvam.ai): speech-to-text `POST /speech-to-text` (Saaras) and text-to-speech `POST /text-to-speech` (Bulbul). Key: SARVAM_API_KEY (environment only, header
`api-subscription-key`). Prices from the provider's page (job BD report): speech-to-text Rs 30 an hour, text-to-speech Rs 3 per 1,000 characters."""

# ruff: noqa: E501

from __future__ import annotations

import base64
import json
import re
from collections.abc import Sequence

import httpx

from app.voice.audio import extension
from app.voice.http import call
from app.voice.interface import TAGS, Price, Speech, Transcript, VoiceError, language_of_tag

BASE = "https://api.sarvam.ai"
MAX_KEYTERMS, MAX_KEYTERM_CHARS = 50, 64
MIN_PACE, MAX_PACE = 0.5, 2.0   # Bulbul v3 / v4-flash (docs.sarvam.ai, text-to-speech)
MIN_TEMPERATURE, MAX_TEMPERATURE = 0.01, 1.0
SAMPLE_RATE = 24000   # one of the rates the REST endpoint takes; plenty for speech that is then coded at 16 kHz
V3_MODEL = "bulbul:v3"
# The four Bulbul v3 speakers the product has used for voice notes, samples and previews (app/voicesample SPEAKERS) and their gender. Speakers are NOT shared between the models (docs.sarvam.ai: "a mismatched speaker returns a 400"), so on
# Bulbul v4 each one is replaced by the catalogue's listed Sarvam voice of the language and gender (app/conversation/data/voices.json); no speaker at all means the woman's voice (as the default always was).
V3_SPEAKER_GENDER = {"ritu": "female", "priya": "female", "aditya": "male", "rahul": "male"}
_V4_PERSONA = re.compile(r"^[a-z]+_[a-z]+_[a-z_]+$")   # <name>_<language>_<style>: "kavitha_te_conversation"


class SarvamStt:
    name = "sarvam"
    price = Price(inr_per_minute=0.50, note="Rs 30/hour, listed on sarvam.ai/api-pricing")

    def __init__(
        self, key: str, model: str = "saaras:v4", client: httpx.Client | None = None, mode: str | None = None
    ) -> None:
        self._key, self._model, self._mode = key, model, mode   # mode (transcribe | verbatim | translit | codemix) is Saaras v3's; v4 ignores it
        self._client = client or httpx.Client(timeout=httpx.Timeout(60.0, connect=10.0))

    def __repr__(self) -> str:
        return f"SarvamStt(model={self._model})"

    def transcribe(
        self, audio: bytes, content_type: str, language: str | None, keyterms: Sequence[str] = ()
    ) -> Transcript:
        data = {"model": self._model, "language_code": TAGS.get(language or "", "unknown")}
        if self._mode and self._model == "saaras:v3":
            data["mode"] = self._mode
        terms = [t for t in keyterms if 0 < len(t) <= MAX_KEYTERM_CHARS][:MAX_KEYTERMS]
        if terms and self._model == "saaras:v4":
            data["keyterms"] = json.dumps(terms, ensure_ascii=False)
        body = call(
            self._client,
            "POST",
            f"{BASE}/speech-to-text",
            headers={"api-subscription-key": self._key},
            data=data,
            files={"file": (f"audio.{extension(content_type)}", audio, content_type)},
        )
        text = body.get("transcript") if isinstance(body, dict) else None
        if not isinstance(text, str):
            raise VoiceError("bad_response")
        tag = body.get("language_code") if isinstance(body.get("language_code"), str) else None
        return Transcript(text.strip(), language_of_tag(tag))


class SarvamTts:
    name = "sarvam"
    price = Price(
        inr_per_1000_chars=3.0, note="Rs 3 per 1,000 characters (Bulbul v3), sarvam.ai/api-pricing"
    )

    def __init__(
        self,
        key: str,
        model: str = "bulbul:v3",
        speaker: str | None = None,
        client: httpx.Client | None = None,
    ) -> None:
        self._key, self._model, self._speaker = key, model, speaker
        self._client = client or httpx.Client(timeout=httpx.Timeout(60.0, connect=10.0))

    def __repr__(self) -> str:
        return f"SarvamTts(model={self._model})"

    def _model_and_speaker(self, language: str, speaker: str | None) -> tuple[str, str | None]:
        """(the model and the speaker this call is sent with). On Bulbul v4 a v3 speaker name (ritu, priya, aditya, rahul) or none is replaced by the listed Sarvam v4 voice of the language and gender; a v4 persona is used as it is.
        Where v4 has nothing to say it with (Malayalam is not on v4 Flash; an unknown v3 name) the call keeps the v3 model, so it is never refused with a 400 for a speaker of the wrong model."""
        chosen = speaker or self._speaker
        if not self._model.startswith("bulbul:v4"):
            return self._model, chosen
        if chosen is not None and _V4_PERSONA.match(chosen):
            return self._model, chosen
        if chosen is not None and chosen not in V3_SPEAKER_GENDER:
            return V3_MODEL, chosen   # a v3 name we cannot place on v4: v3 speaks it
        from app.conversation.voices import default_config

        gender = V3_SPEAKER_GENDER.get(chosen or "", "female")
        for voice in default_config().voices_of(language, gender, listed_only=True):
            if voice.provider == "sarvam" and voice.voices.primary.model.startswith("bulbul:v4"):
                return voice.voices.primary.model, voice.voices.primary.voice
        return V3_MODEL, chosen   # no listed Sarvam v4 voice for this language (Malayalam): v3, with the speaker it was given (or its own default)

    def synthesize(self, text: str, language: str, *, speaker: str | None = None, pace: float | None = None, temperature: float | None = None) -> Speech:
        tag = TAGS.get(language)
        if tag is None:
            raise VoiceError("unsupported_language")
        model, chosen = self._model_and_speaker(language, speaker)
        payload: dict[str, object] = {
            "text": text[:2500],
            "language_code": tag,
            "model": model,
            "output_audio_codec": "wav",   # Bulbul v3 refuses `opus`; app.voice.convert turns the WAV into OGG/Opus, which is what WhatsApp plays
            "speech_sample_rate": SAMPLE_RATE,
        }
        if chosen:
            payload["speaker"] = chosen
        if temperature is not None:
            payload["temperature"] = min(MAX_TEMPERATURE, max(MIN_TEMPERATURE, float(temperature)))
        if pace is not None:
            payload["pace"] = min(MAX_PACE, max(MIN_PACE, float(pace)))
        body = call(
            self._client,
            "POST",
            f"{BASE}/text-to-speech",
            headers={"api-subscription-key": self._key, "Content-Type": "application/json"},
            json=payload,
        )
        audios = body.get("audios") if isinstance(body, dict) else None
        # one text in, one clip out; a provider answer of several pieces would need joining and is refused rather than guessed at
        if not isinstance(audios, list) or len(audios) != 1 or not isinstance(audios[0], str):
            raise VoiceError("bad_response")
        try:
            return Speech(base64.b64decode(audios[0], validate=True), "audio/wav")
        except ValueError:
            raise VoiceError("bad_response") from None
