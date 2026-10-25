"""AI4Bharat open models (IndicConformer for speech-to-text, IndicF5 / Indic Parler-TTS for text-to-speech) behind an address the OWNER runs or rents (a Hugging Face Inference Endpoint, a
small GPU server): AI4BHARAT_STT_URL / AI4BHARAT_TTS_URL, optionally a bearer token AI4BHARAT_TOKEN. There is no public AI4Bharat endpoint with a stated free tier (job BD report), so this adapter
speaks a deliberately plain contract that a thin wrapper around the model can serve:

  speech-to-text:  POST <url>   multipart: `file` (the audio), `language` (te | hi | kn | en | ta)       ->  JSON {"transcript": "..."}
  text-to-speech:  POST <url>   JSON: {"text": "...", "language": "te"}                                   ->  JSON {"audio_base64": "...", "content_type": "audio/wav"}

The address must be https (or http://localhost for a model on this machine). Nothing here is tested against a live model."""

# ruff: noqa: E501

from __future__ import annotations

import base64
from collections.abc import Sequence

import httpx

from app.voice.audio import extension
from app.voice.http import call
from app.voice.interface import LANGUAGES, Price, Speech, Transcript, VoiceError


def safe_url(url: str) -> bool:
    return (
        url.startswith("https://")
        or url.startswith("http://localhost")
        or url.startswith("http://127.0.0.1")
    )


def _headers(token: str | None) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"} if token else {}


class Ai4BharatStt:
    name = "ai4bharat"
    price = Price(note="open model (MIT): you pay for the machine that runs it, not per minute")

    def __init__(
        self, url: str, token: str | None = None, client: httpx.Client | None = None
    ) -> None:
        if not safe_url(url):
            raise ValueError("AI4BHARAT_STT_URL must be https (or http://localhost)")
        self._url, self._token = url, token
        self._client = client or httpx.Client(timeout=httpx.Timeout(90.0, connect=10.0))

    def __repr__(self) -> str:
        return "Ai4BharatStt()"

    def transcribe(
        self, audio: bytes, content_type: str, language: str | None, keyterms: Sequence[str] = ()
    ) -> Transcript:
        lang = language if language in LANGUAGES else "te"
        body = call(
            self._client,
            "POST",
            self._url,
            headers=_headers(self._token),
            data={"language": lang},
            files={"file": (f"audio.{extension(content_type)}", audio, content_type)},
        )
        text = (body.get("transcript") or body.get("text")) if isinstance(body, dict) else None
        if not isinstance(text, str):
            raise VoiceError("bad_response")
        return Transcript(text.strip(), lang)


class Ai4BharatTts:
    name = "ai4bharat"
    price = Price(note="open model: you pay for the machine that runs it, not per character")

    def __init__(
        self, url: str, token: str | None = None, client: httpx.Client | None = None
    ) -> None:
        if not safe_url(url):
            raise ValueError("AI4BHARAT_TTS_URL must be https (or http://localhost)")
        self._url, self._token = url, token
        self._client = client or httpx.Client(timeout=httpx.Timeout(90.0, connect=10.0))

    def __repr__(self) -> str:
        return "Ai4BharatTts()"

    def synthesize(self, text: str, language: str, *, speaker: str | None = None, pace: float | None = None) -> Speech:   # speaker and pace: only a provider with named speakers uses them
        if language not in LANGUAGES:
            raise VoiceError("unsupported_language")
        body = call(
            self._client,
            "POST",
            self._url,
            headers=_headers(self._token),
            json={"text": text, "language": language},
        )
        try:
            return Speech(
                base64.b64decode(body["audio_base64"], validate=True),
                str(body.get("content_type") or "audio/wav"),
            )
        except (KeyError, TypeError, ValueError):
            raise VoiceError("bad_response") from None
