# ruff: noqa: E501
"""The phone assistant's fact pack (28 Nov 2026): what an AI call may state about the business, and the rule that an amount comes ONLY from a price-list row."""

from __future__ import annotations

import uuid
from collections.abc import AsyncIterator
from datetime import datetime
from typing import Any
from zoneinfo import ZoneInfo

import httpx
import pytest

from app.browser_voice.limits import Ledger, Limits
from app.browser_voice.runtime import BrowserVoice
from app.conversation.voices import default_config
from app.talk_training.guard import SAFE, GuardedTts
from app.telephony import fact_pack
from app.telephony.inbound_routes import phone_parts
from app.telephony.inbound_store import InboundStore

IST = ZoneInfo("Asia/Kolkata")
TUE_11 = datetime(2026, 11, 3, 11, 0, tzinfo=IST)
TUE_2230 = datetime(2026, 11, 3, 22, 30, tzinfo=IST)
RAW: dict[str, Any] = {
    "hours": {"days": [1, 2, 3, 4, 5, 6], "from_minute": 540, "to_minute": 1140},
    "prices": [{"name": "Kanchi Pattu saree", "unit": "piece", "paise": 125000, "moq": 1, "tax_bps": 500}, {"name": "Cotton dupatta", "unit": "piece", "paise": 45000, "moq": 10, "tax_bps": 0}],
    "catalogue": [{"name": "Bridal Red Kanchi", "fabric": "kanchi_pattu", "colours": ["red", "gold"], "occasions": ["wedding"], "stock": "few_left"}],
    "faqs": [{"q": "Do you deliver?", "a": "Yes, in Hyderabad, delivery Rs 150 within two days."}],
    "notes": "We sell silk sarees.\nPrices: Kanchi saree Rs 9,999 for the festival.\nPayment by UPI or 50 percent advance.",
}


def text_of(pack: fact_pack.FactPack) -> str:
    return "\n".join(f["text"] for f in pack.facts)


def test_a_price_question_has_the_list_price_and_only_list_amounts_are_allowed() -> None:
    pack = fact_pack.build(RAW, now=TUE_11)
    assert "Kanchi Pattu saree: Rs 1,250 per piece, plus 5% GST" in text_of(pack) and "Cotton dupatta: Rs 450 per piece, minimum order 10" in text_of(pack)
    assert pack.allowed_paise == frozenset({125000, 45000}) and pack.has_prices


def test_amounts_typed_in_the_notes_and_faqs_never_reach_the_model_and_the_catalogue_has_no_price() -> None:
    text = text_of(fact_pack.build(RAW, now=TUE_11))
    assert "9,999" not in text and "Rs 150" not in text and "price: ask the price list" in text
    assert "Payment by UPI or 50 percent advance" in text and "Bridal Red Kanchi: kanchi pattu, colours red, gold, for wedding, only a few left" in text


def test_the_hours_say_whether_the_business_is_open_right_now() -> None:
    assert "Monday to Saturday, 9:00 to 19:00" in text_of(fact_pack.build(RAW, now=TUE_11)) and "so the business is OPEN" in text_of(fact_pack.build(RAW, now=TUE_11))
    closed = text_of(fact_pack.build(RAW, now=TUE_2230))
    assert "Right now it is Tuesday 22:30, so the business is CLOSED" in closed and "when it opens" in closed


def test_the_token_estimate_follows_the_script() -> None:
    assert fact_pack.tokens("a" * 400) in range(160, 175) and fact_pack.tokens("అ" * 300) in range(280, 295)


def test_the_pack_is_capped_and_a_missing_pack_is_empty() -> None:
    big = {**RAW, "notes": "\n".join(f"Fact number {i}: we do something useful for customers." for i in range(500))}
    pack = fact_pack.build(big, now=TUE_11)
    assert pack.tokens <= fact_pack.MAX_TOKENS + 30 and "Fact number 0" in text_of(pack)
    empty = fact_pack.build(None, now=TUE_11)
    assert empty.facts == () and not empty.has_prices and empty.allowed_paise == frozenset()


@pytest.mark.parametrize(("sentence", "amounts"), [("It is Rs 1,250.", [125000]), ("₹1250 only", [125000]), ("1250 రూపాయలు అండీ", [125000]), ("రూ. 450.50", [45050]), ("Call 9876543210", []), ("We open at 9", [])])
def test_amounts_are_found_in_english_and_telugu_forms(sentence: str, amounts: list[int]) -> None:
    assert fact_pack.amounts_paise(sentence) == amounts


class Inner:
    sample_rate = 24000

    def __init__(self) -> None:
        self.said: list[str] = []

    def stream(self, text: str, language: str, *a: Any, **k: Any) -> AsyncIterator[bytes]:
        self.said.append(text)

        async def gen() -> AsyncIterator[bytes]:
            yield b""

        return gen()


def test_the_voice_blocks_an_amount_that_is_not_a_price_list_amount_and_lets_a_listed_one_through() -> None:
    inner = Inner()
    voice = GuardedTts(inner, [], allowed_paise=frozenset({125000}))
    voice.stream("The Kanchi Pattu saree is Rs 1,250 per piece.", "en")
    voice.stream("It is Rs 999 only.", "en")
    voice.stream("అది 800 రూపాయలు అండీ.", "te")
    voice.stream("We are open from 9 to 7.", "en")
    assert inner.said == ["The Kanchi Pattu saree is Rs 1,250 per piece.", SAFE["en"], SAFE["te"], "We are open from 9 to 7."]
    assert voice.amounts_blocked == 2


def test_with_no_price_list_every_amount_is_blocked_and_without_a_pack_nothing_changes() -> None:
    inner = Inner()
    GuardedTts(inner, [], allowed_paise=frozenset()).stream("It is Rs 100.", "en")
    GuardedTts(inner, [], allowed_paise=None).stream("It is Rs 100.", "en")
    assert inner.said == [SAFE["en"], "It is Rs 100."]


def _bv() -> BrowserVoice:
    return BrowserVoice(config=default_config(), factory=lambda choice, language: None, sarvam_key="k", anthropic_key="k", fast_model="m", turn_model="claude", limits=Limits(), ledger=Ledger(Limits()), allowed_origins=(), client=httpx.AsyncClient())  # type: ignore[arg-type,return-value]


def test_the_phone_prompt_carries_the_facts_and_the_rule_and_a_telugu_call_keeps_english_item_names() -> None:
    parts, _ = phone_parts(_bv(), "Padma Silks", "te", "haiku", pack=fact_pack.build(RAW, now=TUE_11))
    prompt = parts.system_for("te")
    assert "FACTS YOU MAY STATE" in prompt and "Kanchi Pattu saree: Rs 1,250 per piece" in prompt and "Bridal Red Kanchi" in prompt
    assert "said only exactly as listed" in prompt and "say ONCE, naturally" in prompt and "Do not state any price" not in prompt
    assert isinstance(parts.tts, GuardedTts)
    bare, _ = phone_parts(_bv(), "Padma Silks", "te", "haiku", pack=None)
    assert "none have been approved yet" in bare.system_for("te"), "no pack: the call states no facts, as before"


def test_a_pack_without_a_price_list_keeps_the_no_price_rule() -> None:
    no_prices = {**RAW, "prices": []}
    parts, _ = phone_parts(_bv(), "Padma Silks", "en", "haiku", pack=fact_pack.build(no_prices, now=TUE_11))
    assert "Do not state any price" in parts.system_for("en")


def test_the_store_reads_the_pack_once_a_minute_per_workspace() -> None:
    calls: list[str] = []

    class Rpc:
        def call(self, token: str, function: str, args: dict[str, Any]) -> Any:
            calls.append(function)
            return {"notes": "x"}

    class Principal:
        def token(self) -> str:
            return "t"

    store = InboundStore(Rpc(), Principal())  # type: ignore[arg-type]
    tenant = uuid.uuid4()
    assert store.fact_pack(tenant) == {"notes": "x"} and store.fact_pack(tenant) == {"notes": "x"}
    assert calls == ["phone_fact_pack"]


def test_holidays_join_the_pack_and_today_being_one_makes_the_business_closed() -> None:
    raw = {**RAW, "holidays": ["2026-11-03", "2026-12-25"]}
    pack = text_of(fact_pack.build(raw, now=TUE_11))
    assert "so the business is CLOSED (today is a holiday)" in pack and "closed on these dates (holidays): 2026-11-03, 2026-12-25" in pack
    assert "so the business is OPEN" in text_of(fact_pack.build({**RAW, "holidays": ["2026-12-25"]}, now=TUE_11))
