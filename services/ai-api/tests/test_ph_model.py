"""Phone calls: the fast model behind a first-token deadline (a stalled request must not become half a minute of silence)."""

# ruff: noqa: E501
from __future__ import annotations

import asyncio
import time
from collections.abc import AsyncIterator

from app.telephony.model import FirstTokenFallback
from tests.test_dv_browser_voice import arun


class Scripted:
    def __init__(self, pieces: list[str], delay: float = 0.0, boom: bool = False, hang: bool = False) -> None:
        self.pieces, self.delay, self.boom, self.hang = pieces, delay, boom, hang
        self.models: list[str] = []
        self.closed = False

    async def stream(self, system: str, messages: list[dict[str, str]], model: str) -> AsyncIterator[str]:
        self.models.append(model)
        try:
            if self.hang:
                await asyncio.sleep(3600)
            await asyncio.sleep(self.delay)
            if self.boom:
                raise RuntimeError("503")
            for p in self.pieces:
                yield p
        finally:
            self.closed = True


async def run(llm: FirstTokenFallback) -> str:
    return "".join([p async for p in llm.stream("s", [{"role": "user", "content": "hi"}], "haiku-model")])


@arun
async def test_a_fast_primary_answers_and_the_fallback_is_never_asked() -> None:
    fast, slow = Scripted(["Hello ", "there."]), Scripted(["fallback"])
    llm = FirstTokenFallback(fast, slow, primary_model="sarvam-105b", first_token_s=0.5)
    assert await run(llm) == "Hello there." and fast.models == ["sarvam-105b"] and slow.models == [] and llm.served == 1 and llm.fell_back == 0


@arun
async def test_a_primary_that_hangs_is_dropped_at_the_deadline_and_the_fallback_answers_the_same_turn() -> None:
    hung, backup = Scripted([], hang=True), Scripted(["From ", "Haiku."])
    llm = FirstTokenFallback(hung, backup, primary_model="sarvam-105b", first_token_s=0.2)
    began = time.perf_counter()
    assert await run(llm) == "From Haiku." and time.perf_counter() - began < 1.0
    assert backup.models == ["haiku-model"] and hung.closed and llm.fell_back == 1, "the stalled request is closed, not left running"


@arun
async def test_an_error_or_an_empty_answer_goes_to_the_fallback_too() -> None:
    for primary in (Scripted([], boom=True), Scripted([])):
        backup = Scripted(["ok"])
        llm = FirstTokenFallback(primary, backup, primary_model="sarvam-105b", first_token_s=0.5)
        assert await run(llm) == "ok" and llm.fell_back == 1


@arun
async def test_once_the_primary_has_started_the_turn_stays_with_it() -> None:
    class Dies(Scripted):
        async def stream(self, system: str, messages: list[dict[str, str]], model: str) -> AsyncIterator[str]:
            yield "Partly "
            raise RuntimeError("connection reset")

    backup = Scripted(["never used"])
    llm = FirstTokenFallback(Dies([]), backup, primary_model="sarvam-105b", first_token_s=0.5)
    out: list[str] = []
    try:
        async for p in llm.stream("s", [], "m"):
            out.append(p)
    except RuntimeError:
        pass
    assert out == ["Partly "] and backup.models == [], "words already spoken are never answered twice"
