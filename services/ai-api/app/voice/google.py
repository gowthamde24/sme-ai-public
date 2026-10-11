"""Google Cloud Speech-to-Text (v1 `speech:recognize`) and Text-to-Speech (v1 `text:synthesize`), with an API key: GOOGLE_API_KEY (environment only, header `X-Goog-Api-Key`, never in the address,
so it cannot reach a log). The key's project must have both APIs switched on. v1 reads WAV, FLAC, MP3, Ogg Opus and WebM Opus; it does NOT read M4A / AAC, so an M4A is refused here with
`unsupported_audio` (the bake-off converts nothing). Prices from Google's pages (job BD report): speech-to-text USD 0.016 a minute after 60 free minutes a month (data logging off by default);
text-to-speech Standard USD 4, Neural2 16, Chirp 3 HD 30 per million characters after a monthly free tier."""

# ruff: noqa: E501

from __future__ import annotations

import base64
from collections.abc import Sequence

import httpx

from app.voice.http import call
from app.voice.interface import TAGS, Price, Speech, Transcript, VoiceError, language_of_tag

STT_URL = "https://speech.googleapis.com/v1/speech:recognize"
TTS_URL = "https://texttospeech.googleapis.com/v1/text:synthesize"
ENCODINGS = {
    "audio/wav": None,
    "audio/flac": "FLAC",
    "audio/mpeg": "MP3",
    "audio/ogg": "OGG_OPUS",
    "audio/webm": "WEBM_OPUS",
}
ALSO_LISTEN_FOR = ("hi-IN", "kn-IN", "en-IN", "te-IN", "ta-IN")


class GoogleStt:
    name = "google"
    price = Price(
        usd_per_minute=0.016,
        note="USD 0.016/min after 60 free min/month, cloud.google.com/speech-to-text/pricing",
    )

    def __init__(self, key: str, client: httpx.Client | None = None) -> None:
        self._key = key
        self._client = client or httpx.Client(timeout=httpx.Timeout(60.0, connect=10.0))

    def __repr__(self) -> str:
        return "GoogleStt()"

    def transcribe(
        self, audio: bytes, content_type: str, language: str | None, keyterms: Sequence[str] = ()
    ) -> Transcript:
        if content_type not in ENCODINGS:
            raise VoiceError("unsupported_audio")
        main = TAGS.get(language or "", "te-IN")
        config: dict[str, object] = {
            "languageCode": main,
            "alternativeLanguageCodes": [t for t in ALSO_LISTEN_FOR if t != main][:3]
            if language is None
            else [],
            "enableAutomaticPunctuation": True,
        }
        encoding = ENCODINGS[content_type]
        if encoding:
            config["encoding"] = encoding
            if encoding in ("OGG_OPUS", "WEBM_OPUS"):
                config["sampleRateHertz"] = 48000
        if keyterms:
            config["speechContexts"] = [{"phrases": list(keyterms)[:50]}]
        body = call(
            self._client,
            "POST",
            STT_URL,
            headers={"X-Goog-Api-Key": self._key},
            json={"config": config, "audio": {"content": base64.b64encode(audio).decode("ascii")}},
        )
        results = body.get("results") if isinstance(body, dict) else None
        if results is None:
            raise VoiceError("no_speech") if isinstance(body, dict) else VoiceError("bad_response")
        if not isinstance(results, list):
            raise VoiceError("bad_response")
        parts: list[str] = []
        heard: str | None = None
        for result in results:
            try:
                parts.append(result["alternatives"][0]["transcript"])
                heard = heard or result.get("languageCode")
            except (KeyError, IndexError, TypeError, AttributeError):
                raise VoiceError("bad_response") from None
        return Transcript(" ".join(p.strip() for p in parts).strip(), language_of_tag(heard))


class GoogleTts:
    name = "google"
    price = Price(
        usd_per_1000_chars=0.004,
        note="Standard voices USD 4 per million characters (Neural2 16, Chirp 3 HD 30), after a monthly free tier",
    )

    def __init__(self, key: str, client: httpx.Client | None = None) -> None:
        self._key = key
        self._client = client or httpx.Client(timeout=httpx.Timeout(60.0, connect=10.0))

    def __repr__(self) -> str:
        return "GoogleTts()"

    def synthesize(self, text: str, language: str) -> Speech:
        tag = TAGS.get(language)
        if tag is None:
            raise VoiceError("unsupported_language")
        body = call(
            self._client,
            "POST",
            TTS_URL,
            headers={"X-Goog-Api-Key": self._key},
            json={
                "input": {"text": text[:4500]},
                "voice": {"languageCode": tag},
                "audioConfig": {"audioEncoding": "MP3"},
            },
        )
        encoded = body.get("audioContent") if isinstance(body, dict) else None
        if not isinstance(encoded, str):
            raise VoiceError("bad_response")
        try:
            return Speech(base64.b64decode(encoded, validate=True), "audio/mpeg")
        except ValueError:
            raise VoiceError("bad_response") from None
