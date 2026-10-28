"""Build the real voice engines named by the voice config (job natural-voice). The only place that knows which class speaks for which engine id; keys are arguments (read by the caller from the environment), one HTTP client is shared by the Cartesia voices."""

# ruff: noqa: E501

from __future__ import annotations

import httpx

from app.conversation.fallback import EngineFactory
from app.conversation.parts import StreamingTts
from app.conversation.providers import CartesiaStreamTts, SarvamStreamTts
from app.conversation.voices import VoiceChoice


def real_engine_factory(*, cartesia_key: str, sarvam_key: str) -> EngineFactory:
    client = httpx.AsyncClient(timeout=httpx.Timeout(30.0, connect=10.0))

    def make(choice: VoiceChoice, language: str) -> StreamingTts:
        if choice.engine == "cartesia":
            return CartesiaStreamTts(cartesia_key, voice_id=choice.voice, model=choice.model, client=client)
        return SarvamStreamTts(sarvam_key, speaker=choice.voice, language=language, model=choice.model)

    return make
