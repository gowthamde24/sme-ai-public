"""Our own hard cap on Cartesia (owner, 6 Nov 2026): 2,000 characters a call, 20,000 a day across all calls; past either, the call speaks with Sarvam Bulbul (never silent); a reservation that
cannot be made means Sarvam (fail closed); Live talk speaks with Sarvam until the owner says otherwise; every call logs what it was granted and used."""

# ruff: noqa: E501

from __future__ import annotations

import asyncio
import dataclasses
import uuid
from typing import Any

from app.browser_voice.runtime import BrowserVoice
from app.conversation.fallback import FallbackTts
from app.conversation.voices import default_config
from app.today.service import needs_item
from app.voice.budget import FixedBudget, Hold, RpcVoiceBudget
from tests.test_dv_browser_voice import arun, until
from tests.test_nv_voices import Engine, run, speak


def build(primary: Engine, fallback: Engine) -> FallbackTts:
    cfg = dataclasses.replace(default_config(), first_audio_timeout_ms=800)
    return FallbackTts(cfg, lambda choice, language: primary if choice.engine == "cartesia" else fallback)


def test_the_call_speaks_with_cartesia_until_its_allowance_is_spent_then_with_sarvam_for_the_rest_of_the_call() -> None:
    primary, fallback = Engine("c"), Engine("s")
    tts = build(primary, fallback)
    tts.set_primary_budget(25)
    for text in ("ten chars!", "ten chars!", "ten chars!", "ok"):
        tts.begin_turn()
        assert run(speak(tts, text)), "every sentence is spoken"
    assert [t for t, _ in primary.calls] == ["ten chars!", "ten chars!"] and tts.primary_chars == 20, "the third sentence would pass 25: Cartesia stops there"
    assert [t for t, _ in fallback.calls] == ["ten chars!", "ok"] and tts.primary_off == "budget", "... and the rest of the call is Sarvam, even a short sentence that would still fit"


def test_no_allowance_means_sarvam_from_the_first_word() -> None:
    primary, fallback = Engine("c"), Engine("s")
    tts = build(primary, fallback)
    tts.set_primary_budget(0)
    tts.begin_turn()
    assert run(speak(tts, "నమస్కారం")) and not primary.calls and tts.served_engine == "sarvam_v4" and tts.fallback_reason == "budget"


@arun
async def test_a_reservation_on_its_way_is_awaited_and_a_late_one_means_sarvam() -> None:
    primary, fallback = Engine("c"), Engine("s")
    tts = build(primary, fallback)

    async def soon() -> int:
        await asyncio.sleep(0.05)
        return 2000

    tts.set_primary_budget(asyncio.ensure_future(soon()))
    tts.begin_turn()
    assert [c async for c in tts.stream("హలో", "te")] and tts.primary_budget == 2000 and primary.calls

    import app.conversation.fallback as F

    late_primary, late_fallback = Engine("c"), Engine("s")
    late = build(late_primary, late_fallback)

    async def never() -> int:
        await asyncio.sleep(10)
        return 2000

    saved = F.BUDGET_WAIT_S
    F.BUDGET_WAIT_S = 0.05
    try:
        late.set_primary_budget(asyncio.ensure_future(never()))
        late.begin_turn()
        assert [c async for c in late.stream("హలో", "te")]
    finally:
        F.BUDGET_WAIT_S = saved
    assert late.primary_budget == 0 and not late_primary.calls and late.served_engine == "sarvam_v4", "no allowance in time: Sarvam, never over the cap"


def test_the_database_cap_fails_closed_and_gives_back_only_a_real_reservation() -> None:
    class Down:
        def call(self, token: str, function: str, args: dict[str, Any]) -> Any:
            raise ConnectionError("db down")

    class Up:
        def __init__(self) -> None:
            self.calls: list[tuple[str, dict[str, Any]]] = []

        def call(self, token: str, function: str, args: dict[str, Any]) -> Any:
            self.calls.append((function, args))
            if function == "voice_budget_reserve":
                return {"hold": str(uuid.UUID(int=5)), "granted": 2000, "day_used": 2600, "day_limit": 20000}
            return {"used": args["p_used"], "granted": 2000, "day_used": 1100}

    assert RpcVoiceBudget(Down(), lambda: "t").reserve(2000, "call") == Hold(None, 0), "no reservation: 0 characters (Sarvam)"
    assert RpcVoiceBudget(Down(), lambda: "t").release(Hold(None, 0), 10) is None
    up = Up()
    budget = RpcVoiceBudget(up, lambda: "t")
    hold = budget.reserve(2000, "call")
    assert hold.granted == 2000 and up.calls[0] == ("voice_budget_reserve", {"p_engine": "cartesia", "p_want": 2000, "p_source": "call"})
    assert budget.release(hold, 500) == {"used": 500, "granted": 2000, "day_used": 1100} and up.calls[1] == ("voice_budget_release", {"p_hold": str(uuid.UUID(int=5)), "p_used": 500})


def test_the_day_limit_holds_across_calls() -> None:
    day = FixedBudget(day_chars=20_000)
    holds = [day.reserve(5000, "call") for _ in range(12)]
    assert [h.granted for h in holds] == [2000] * 10 + [0, 0] and day.used == 20_000, "2,000 a call, 20,000 a day: the 11th call speaks with Sarvam"
    day.release(holds[0], 300)
    assert day.used == 18_300 and day.reserve(2000, "call").granted == 1700


@arun
async def test_a_phone_call_reserves_after_admission_gives_back_what_it_did_not_use_and_logs_it() -> None:
    from app.telephony import inbound
    from tests.test_ph_inbound import SECRET, FakeStore, _call, service

    store = FakeStore()
    svc = service(store=store)
    svc.budget = FixedBudget(day_chars=20_000)
    sim, task = await _call(svc, inbound.mint(SECRET, inbound.monotonic(), "CA123"))
    heard = sim.heard
    await until(lambda: bool(heard.marks), 5)
    await sim.hang_up()
    await asyncio.wait_for(task, 10)
    numbers = svc.last_numbers
    assert numbers is not None and numbers["voice_budget"] is not None
    assert numbers["voice_budget"]["granted"] == 2000 and numbers["voice_budget"]["day_limit"] == 20_000
    assert svc.budget.released == [(2000, numbers["voice_budget"]["used"])] and svc.budget.used == numbers["voice_budget"]["used"], "what was not used went back to the day"


@arun
async def test_a_refused_call_reserves_nothing() -> None:
    from app.telephony import inbound
    from tests.test_ph_inbound import SECRET, FakeStore, _call, service

    svc = service(store=FakeStore(), numbers=frozenset({"+919999999999"}))   # the caller is not on the allowed list
    svc.budget = FixedBudget(day_chars=20_000)
    sim, task = await _call(svc, inbound.mint(SECRET, inbound.monotonic(), "CA123"))
    await asyncio.wait_for(task, 10)
    assert svc.budget.used == 0 and svc.budget.released == []


def test_live_talk_speaks_with_sarvam_until_the_owner_says_otherwise() -> None:
    assert {f.name: f.default for f in dataclasses.fields(BrowserVoice)}["talk_primary"] is False
    from app.config import Settings

    assert Settings.model_fields["voice_talk_primary"].default is False


def test_the_warning_reads_plainly_in_needs_you() -> None:
    row = {"kind": "voice_credits", "id": str(uuid.UUID(int=9)), "customer": "Voice credits", "city": None, "agent": "followup_desk", "ref": "day_80", "at": "2026-11-06T10:00:00Z",
           "amount_paise": None, "target": {"type": "billing", "id": str(uuid.UUID(int=1))}}
    item = needs_item(row)
    assert item.kind == "voice_credits" and item.customer == "Voice credits" and "80 percent of today's limit" in item.summary and "Sarvam" in item.summary
    for ref, words in (("day_100", "reached today's limit"), ("month_80", "80 percent of this month's credits"), ("month_100", "Overage charges apply now")):
        assert words in needs_item({**row, "ref": ref}).summary
