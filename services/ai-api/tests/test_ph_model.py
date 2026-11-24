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


def test_the_phone_builds_sarvam_behind_the_first_token_fallback_and_haiku_alone() -> None:
    """28 Nov 2026: TELEPHONY_LLM=sarvam once built Sarvam ALONE (the deadline was read and dropped): a stalled Sarvam request is half a minute of silence on a call. The phone's parts now hold the fallback, with the deadline, and Haiku's model id for the turn."""
    import httpx

    from app.browser_voice.limits import Ledger, Limits
    from app.browser_voice.runtime import BrowserVoice
    from app.conversation.providers import AnthropicStream, SarvamChatStream
    from app.conversation.voices import default_config
    from app.telephony.inbound_routes import phone_parts
    from app.telephony.model import FirstTokenFallback

    bv = BrowserVoice(config=default_config(), factory=lambda choice, language: None, sarvam_key="k", anthropic_key="k", fast_model="haiku-id", turn_model="claude", limits=Limits(), ledger=Ledger(Limits()), allowed_origins=(), client=httpx.AsyncClient())  # type: ignore[arg-type,return-value]
    parts, model = phone_parts(bv, "Stack19", "te", "sarvam", first_token_s=0.7)
    assert isinstance(parts.llm, FirstTokenFallback) and isinstance(parts.llm._primary, SarvamChatStream) and isinstance(parts.llm._fallback, AnthropicStream)  # noqa: SLF001
    assert parts.llm._deadline == 0.7 and parts.llm._primary_model == "sarvam-105b" and model == "haiku-id"  # noqa: SLF001
    parts, model = phone_parts(bv, "Stack19", "te", "haiku", first_token_s=0.7)
    assert isinstance(parts.llm, AnthropicStream) and model == "haiku-id"


def test_the_deployment_passes_the_deadline_and_the_choice_to_the_phone() -> None:
    from types import SimpleNamespace

    from app.telephony.settings import phone_llm_choice

    assert phone_llm_choice(SimpleNamespace(telephony_llm="sarvam", telephony_first_token_ms=700)) == ("sarvam", 0.7)
