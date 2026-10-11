"""Sarvam AI (https://docs.sarvam.ai): speech-to-text `POST /speech-to-text` (Saaras) and text-to-speech `POST /text-to-speech` (Bulbul). Key: SARVAM_API_KEY (environment only, header
`api-subscription-key`). Prices from the provider's page (job BD report): speech-to-text Rs 30 an hour, text-to-speech Rs 3 per 1,000 characters."""

# ruff: noqa: E501

from __future__ import annotations

import base64
import json
from collections.abc import Sequence

import httpx

from app.voice.audio import extension
from app.voice.http import call
from app.voice.interface import TAGS, Price, Speech, Transcript, VoiceError, language_of_tag

BASE = "https://api.sarvam.ai"
MAX_KEYTERMS, MAX_KEYTERM_CHARS = 50, 64


class SarvamStt:
    name = "sarvam"
    price = Price(inr_per_minute=0.50, note="Rs 30/hour, listed on sarvam.ai/api-pricing")

    def __init__(
        self, key: str, model: str = "saaras:v4", client: httpx.Client | None = None
    ) -> None:
        self._key, self._model = key, model
        self._client = client or httpx.Client(timeout=httpx.Timeout(60.0, connect=10.0))

    def __repr__(self) -> str:
        return f"SarvamStt(model={self._model})"

    def transcribe(
        self, audio: bytes, content_type: str, language: str | None, keyterms: Sequence[str] = ()
    ) -> Transcript:
        data = {"model": self._model, "language_code": TAGS.get(language or "", "unknown")}
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

    def synthesize(self, text: str, language: str) -> Speech:
        tag = TAGS.get(language)
        if tag is None:
            raise VoiceError("unsupported_language")
        payload: dict[str, object] = {
            "text": text[:2500],
            "language_code": tag,
            "model": self._model,
            "output_audio_codec": "wav",
        }
        if self._speaker:
            payload["speaker"] = self._speaker
        body = call(
            self._client,
            "POST",
            f"{BASE}/text-to-speech",
            headers={"api-subscription-key": self._key, "Content-Type": "application/json"},
            json=payload,
        )
        audios = body.get("audios") if isinstance(body, dict) else None
        if not isinstance(audios, list) or not audios or not isinstance(audios[0], str):
            raise VoiceError("bad_response")
        try:
            return Speech(base64.b64decode(audios[0], validate=True), "audio/wav")
        except ValueError:
            raise VoiceError("bad_response") from None
