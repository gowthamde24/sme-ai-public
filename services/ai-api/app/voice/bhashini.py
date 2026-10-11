"""Bhashini / Dhruva (the Government of India's language platform): one `pipeline` endpoint for ASR and TTS. Keys: BHASHINI_API_KEY plus a service id per task (BHASHINI_ASR_SERVICE_ID,
BHASHINI_TTS_SERVICE_ID; the ids are listed in Bhashini's "Available Models" page). Bhashini says its APIs are for PROOF OF CONCEPT use; production needs a paid plan from the Bhashini team
(job BD report). The ASR request is the one the existing `make stt-bakeoff` used; the TTS request follows the same pipeline shape and has NOT been run against the live service (no account)."""

# ruff: noqa: E501

from __future__ import annotations

import base64
from collections.abc import Sequence

import httpx

from app.voice.audio import extension
from app.voice.http import call
from app.voice.interface import LANGUAGES, Price, Speech, Transcript, VoiceError

URL = "https://dhruva-api.bhashini.gov.in/services/inference/pipeline"


class BhashiniStt:
    name = "bhashini"
    price = Price(
        note="free for proof of concept; production pricing not published (contact Bhashini)"
    )

    def __init__(
        self,
        key: str,
        service_id: str,
        default_language: str = "te",
        client: httpx.Client | None = None,
    ) -> None:
        self._key, self._service, self._default = key, service_id, default_language
        self._client = client or httpx.Client(timeout=httpx.Timeout(60.0, connect=10.0))

    def __repr__(self) -> str:
        return f"BhashiniStt(service={self._service})"

    def transcribe(
        self, audio: bytes, content_type: str, language: str | None, keyterms: Sequence[str] = ()
    ) -> Transcript:
        lang = language if language in LANGUAGES else self._default
        body = {
            "pipelineTasks": [
                {
                    "taskType": "asr",
                    "config": {
                        "language": {"sourceLanguage": lang},
                        "serviceId": self._service,
                        "audioFormat": extension(content_type),
                        "samplingRate": 16000,
                    },
                }
            ],
            "inputData": {"audio": [{"audioContent": base64.b64encode(audio).decode("ascii")}]},
        }
        answer = call(self._client, "POST", URL, headers={"Authorization": self._key}, json=body)
        try:
            text = answer["pipelineResponse"][0]["output"][0]["source"]
        except (KeyError, IndexError, TypeError):
            raise VoiceError("bad_response") from None
        if not isinstance(text, str):
            raise VoiceError("bad_response")
        return Transcript(text.strip(), lang)  # the language asked for: the service does not say


class BhashiniTts:
    name = "bhashini"
    price = Price(
        note="free for proof of concept; production pricing not published (contact Bhashini)"
    )

    def __init__(self, key: str, service_id: str, client: httpx.Client | None = None) -> None:
        self._key, self._service = key, service_id
        self._client = client or httpx.Client(timeout=httpx.Timeout(60.0, connect=10.0))

    def __repr__(self) -> str:
        return f"BhashiniTts(service={self._service})"

    def synthesize(self, text: str, language: str) -> Speech:
        if language not in LANGUAGES:
            raise VoiceError("unsupported_language")
        body = {
            "pipelineTasks": [
                {
                    "taskType": "tts",
                    "config": {
                        "language": {"sourceLanguage": language},
                        "serviceId": self._service,
                        "gender": "female",
                        "samplingRate": 8000,
                    },
                }
            ],
            "inputData": {"input": [{"source": text}]},
        }
        answer = call(self._client, "POST", URL, headers={"Authorization": self._key}, json=body)
        try:
            encoded = answer["pipelineResponse"][0]["audio"][0]["audioContent"]
            return Speech(base64.b64decode(encoded, validate=True), "audio/wav")
        except (KeyError, IndexError, TypeError, ValueError):
            raise VoiceError("bad_response") from None
