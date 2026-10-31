"""The browser voice as the deployment configured it (job DV). Kept apart from routes.py so the Runtime (app/auth/deps.py) can name it without a circular import."""

# ruff: noqa: E501

from __future__ import annotations

from dataclasses import dataclass, field

import httpx

from app.browser_voice.limits import Ledger, Limits
from app.browser_voice.llm import ASK_MODEL
from app.conversation.fallback import EngineFactory
from app.conversation.fillers import FillerBank
from app.conversation.parts import StreamingLlm
from app.conversation.providers import AnthropicStream, SarvamChatStream
from app.conversation.voices import VoiceConfig


@dataclass
class BrowserVoice:
    """The browser voice as the deployment configured it (None in the Runtime = the feature is off)."""

    config: VoiceConfig
    factory: EngineFactory
    sarvam_key: str
    anthropic_key: str | None
    fast_model: str
    turn_model: str  # "claude" | "sarvam"
    limits: Limits
    ledger: Ledger
    allowed_origins: tuple[str, ...]
    client: httpx.AsyncClient
    stt_modes: dict[str, str] = field(default_factory=dict)  # what the recogniser writes per language (routes.STT_MODES unless the deployment overrides it)
    fillers: FillerBank | None = None  # the pre-rendered 'one moment' lines per catalogue voice (data/fillers/)
    fast_smalltalk: bool = True  # casual turns on the fast tier, written into the same thread (owner decision, 31 Oct 2026)
    input_micros_per_mtok: int = 0   # what the fast model costs (settings LLM_INPUT/OUTPUT_MICROS_PER_MTOK): the day's cap sees the fast turns
    output_micros_per_mtok: int = 0

    def fast_llm(self) -> StreamingLlm:
        if self.turn_model == "sarvam":
            return SarvamChatStream(self.sarvam_key, client=self.client)
        return AnthropicStream(self.anthropic_key or "", client=self.client)

    def model_ids(self) -> dict[str, str]:
        return {"fast": "sarvam-105b" if self.turn_model == "sarvam" else self.fast_model, "strong": ASK_MODEL}
