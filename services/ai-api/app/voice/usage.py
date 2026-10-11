"""Voice in the AI ledger ("fair use", job BD, ADR 0071). Speech has no tokens, so two accounting models carry it (migration 20261112090000): `voice-stt` (10 tokens a second of audio) and
`voice-tts` (4 tokens a character), each priced at the table's ceiling, 1,000 micros a token. They go through the same reserve / settle functions as any model call, so the daily and monthly
caps, the pause and the usage screens already count them. The charge is made BEFORE the provider is called, from what is known (measured or estimated seconds; exact characters)."""

# ruff: noqa: E501

from __future__ import annotations

from typing import Protocol

from app.agents.llm.interface import Usage

STT_MODEL = "voice-stt"
TTS_MODEL = "voice-tts"
STT_TOKENS_PER_SECOND = 10
TTS_TOKENS_PER_CHAR = 4
MICROS_PER_TOKEN = 1000  # the price ceiling of the table: 1,000,000,000 per million tokens
MAX_SPOKEN_CHARS = 500  # an answer is spoken up to here (Rs 2.00 at the fair-use rate); the rest stays on the screen


class Ledger(Protocol):
    def reserve_cost(
        self, step_key: str, *, model: str, max_input_tokens: int, max_output_tokens: int
    ) -> None: ...
    def record_usage(self, step_key: str, usage: Usage) -> None: ...


def stt_tokens(seconds: int) -> int:
    return max(1, seconds) * STT_TOKENS_PER_SECOND


def tts_tokens(characters: int) -> int:
    return max(1, characters) * TTS_TOKENS_PER_CHAR


def charge(db: Ledger, step_key: str, model: str, tokens: int) -> None:
    """Reserve and settle in one go. Raises the data layer's own refusal (cost cap reached, no price) so the caller can say so."""
    db.reserve_cost(step_key, model=model, max_input_tokens=tokens, max_output_tokens=0)
    db.record_usage(step_key, Usage(tokens, 0, tokens * MICROS_PER_TOKEN))
