"""The English line under a live call's captions (owner, 7 Nov 2026; C2's contract: `text_en` on every transcript item): only non-English lines are asked, in the background, never more than a
call's cap; a failure leaves it null; a live call's lines (with their English) are readable by the Owner and Admin while it runs; Sales still get no transcript."""

# ruff: noqa: E501

from __future__ import annotations

import asyncio
from collections.abc import AsyncIterator
from typing import Any

from app.telephony.live import LiveCalls
from app.telephony.service import CallsService
from app.telephony.translate import SYSTEM, LineTranslator, needs_english
from tests.fakes import TENANT_A, auth, make_client
from tests.test_ph_calls_api import DONE_ID, NOW, FakeCallsRepo


class Llm:
    def __init__(self, reply: str = "I want a red Kanchi silk saree", fail: bool = False) -> None:
        self.reply, self.fail = reply, fail
        self.asked: list[tuple[str, list[dict[str, str]], str]] = []

    async def stream(self, system: str, messages: list[dict[str, str]], model: str) -> AsyncIterator[str]:
        self.asked.append((system, messages, model))
        if self.fail:
            raise RuntimeError("down")
        for word in self.reply.split(" "):
            yield word + " "


def test_only_a_line_in_another_script_needs_english() -> None:
    assert needs_english("నాకు ఎరుపు కంచి పట్టు చీర కావాలి")
    assert needs_english("मुझे लाल साड़ी चाहिए") and needs_english("ಸರಿ sir, Saturday ಬರ್ತೀನಿ")
    assert not needs_english("I want the Kanchi saree, 15,000 rupees?") and not needs_english("Café crème, très bien")


def test_a_telugu_line_gets_its_english_in_the_background_and_an_english_line_is_never_asked() -> None:
    async def go() -> tuple[list[dict[str, Any]], Llm]:
        llm = Llm()
        tr = LineTranslator(llm, "fast")
        lines = [{"who": "caller", "text": "నాకు ఎరుపు కంచి పట్టు చీర కావాలి", "t": 1.0}, {"who": "assistant", "text": "Sure, one moment.", "t": 2.0}]
        for line in lines:
            tr.submit(line)
        assert lines[0]["text_en"] is None, "the caption is never held for its English"
        await tr.settle()
        return lines, llm

    lines, llm = asyncio.run(go())
    assert lines[0]["text_en"] == "I want a red Kanchi silk saree" and lines[1]["text_en"] is None
    assert len(llm.asked) == 1 and llm.asked[0][0] == SYSTEM and llm.asked[0][1] == [{"role": "user", "content": "నాకు ఎరుపు కంచి పట్టు చీర కావాలి"}], "the caller's words are only ever the text to translate"


def test_a_failure_leaves_it_null_and_a_call_never_asks_past_its_cap() -> None:
    async def go() -> tuple[list[dict[str, Any]], LineTranslator, Llm]:
        llm = Llm(fail=True)
        tr = LineTranslator(llm, "fast", max_lines=2)
        lines = [{"who": "caller", "text": "హలో", "t": float(i)} for i in range(4)]
        for line in lines:
            tr.submit(line)
        await tr.settle()
        return lines, tr, llm

    lines, tr, llm = asyncio.run(go())
    assert all(line["text_en"] is None for line in lines) and tr.asked == 2 and tr.failed == 2 and len(llm.asked) == 2


def test_a_long_answer_is_cut_to_two_thousand_characters() -> None:
    async def go() -> dict[str, Any]:
        tr = LineTranslator(Llm(reply="x" * 3000), "fast")
        line: dict[str, Any] = {"who": "caller", "text": "హలో"}
        tr.submit(line)
        await tr.settle()
        return line

    assert len(asyncio.run(go())["text_en"]) == 2000


def test_the_line_hands_each_final_caption_to_its_translator() -> None:
    from app.telephony.line import PhoneLine

    seen: list[dict[str, Any]] = []
    line: Any = PhoneLine.__new__(PhoneLine)
    line.transcript, line._clock, line._began = [], lambda: 5.0, 0.0
    line.translator = type("T", (), {"submit": lambda self, item: seen.append(item)})()
    asyncio.run(PhoneLine.send_json(line, {"type": "caption", "who": "user", "text": "హలో", "final": True}))
    asyncio.run(PhoneLine.send_json(line, {"type": "caption", "who": "user", "text": "హ", "final": False}))
    assert seen == line.transcript and len(seen) == 1 and seen[0]["who"] == "caller"


def test_a_live_calls_lines_with_their_english_are_read_while_it_runs_by_the_owner_and_never_by_sales() -> None:
    live = LiveCalls()
    line = type("L", (), {"transcript": [{"who": "caller", "text": "నాకు చీర కావాలి", "t": 1.5, "text_en": "I want a saree"}, {"who": "assistant", "text": "Sure.", "t": 3.0, "text_en": None}]})()
    live.add(TENANT_A.id, DONE_ID, line)
    c, _ = make_client(calls=CallsService(FakeCallsRepo(), clock=lambda: NOW), live_calls=live)
    url = f"/v1/tenants/{TENANT_A.id}/calls/{DONE_ID}"
    owner = c.get(url, headers=auth("a_owner")).json()
    assert owner["transcript"] == [{"who": "caller", "text": "నాకు చీర కావాలి", "t": 1.5, "text_en": "I want a saree"}, {"who": "assistant", "text": "Sure.", "t": 3.0, "text_en": None}]
    assert c.get(url, headers=auth("a_sales")).json()["transcript"] is None, "Sales never read a transcript, live or not"
    live.remove(DONE_ID)
    after = c.get(url, headers=auth("a_owner")).json()["transcript"]
    assert after is None or all("text_en" in t for t in after), "after the call: the saved transcript (each item has text_en, null when absent)"


def test_the_translator_uses_the_fast_model_and_is_off_without_a_key_or_in_tests() -> None:
    from types import SimpleNamespace

    from app.telephony.inbound_routes import InboundService, english_lines

    made = english_lines(SimpleNamespace(turn_model="claude", anthropic_key="k", sarvam_key="", fast_model="haiku", client=None))
    assert isinstance(made, LineTranslator) and made._model == "haiku"  # noqa: SLF001
    assert english_lines(SimpleNamespace(turn_model="claude", anthropic_key="", sarvam_key="", fast_model="haiku", client=None)) is None
    assert InboundService.__dataclass_fields__["english_lines"].default is False, "tests never ask a real model; the real wiring turns it on"
