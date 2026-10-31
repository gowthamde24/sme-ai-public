"""Which model speaks on a call, and what happens when the fast one stalls (owner decision 31 Oct 2026: try Sarvam 105B on casual phone turns against Haiku).

Measured (scripts/phone_llm_bench.py, ~/Desktop/stack19-jobs/phone-calls-check/llm-bench.md): Sarvam 105B answers its first token in ~265 ms against Haiku's ~590 ms, with the same rule results, BUT about one request in ten never answers: it
hangs until the client gives up after 30 seconds, which on a phone is half a minute of silence. So Sarvam is only ever used behind `FirstTokenFallback`: if its first piece of text has not arrived within `first_token_s`, the same
turn is asked of the fallback (Haiku) at once and the slow request is dropped. Once a piece has arrived the turn stays with the model that started it."""

# ruff: noqa: E501

from __future__ import annotations

import asyncio
import logging
from collections.abc import AsyncIterator

from app.conversation.parts import StreamingLlm

log = logging.getLogger("app.telephony.model")


class FirstTokenFallback:
    def __init__(self, primary: StreamingLlm, fallback: StreamingLlm, *, primary_model: str, first_token_s: float = 1.2) -> None:
        self._primary, self._fallback, self._primary_model, self._deadline = primary, fallback, primary_model, first_token_s
        self.fell_back = 0
        self.served = 0

    async def stream(self, system: str, messages: list[dict[str, str]], model: str) -> AsyncIterator[str]:
        """`model` is the fallback's model id (the one the session was configured with); the primary uses its own."""
        stream = self._primary.stream(system, messages, self._primary_model)
        try:
            first = await asyncio.wait_for(anext(stream), self._deadline)
        except (TimeoutError, StopAsyncIteration, Exception) as exc:   # noqa: BLE001 - any failure or silence of the fast model is the fallback's turn
            await _close(stream)
            self.fell_back += 1
            log.warning("phone_model_fallback reason=%s", type(exc).__name__)
            async for piece in self._fallback.stream(system, messages, model):
                yield piece
            return
        self.served += 1
        yield first
        try:
            async for piece in stream:
                yield piece
        finally:
            await _close(stream)


async def _close(stream: AsyncIterator[str]) -> None:
    close = getattr(stream, "aclose", None)
    if close is not None:
        try:
            await close()
        except Exception:   # noqa: BLE001 - closing a dropped request must never break the turn
            return
