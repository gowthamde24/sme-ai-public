"""VoiceLink reseller prices (owner, 26 Nov 2026): Rs 0.25 a minute inbound, Rs 0.50 outbound, 60 s pulses from the answer. An inbound call is costed with its own rate when TELEPHONY_COST_PAISE_PER_MINUTE_INBOUND is set; unset, the one rate covers both."""

# ruff: noqa: E501
from __future__ import annotations

from app.config import Settings
from app.telephony.outcome import cost_paise


def test_the_two_rates_cost_a_call_by_its_direction() -> None:
    assert cost_paise(61, 25, 60) == 50      # inbound: two started minutes at 25 paise
    assert cost_paise(61, 50, 60) == 100     # outbound: two started minutes at 50 paise
    assert cost_paise(0, 50, 60) == 0        # unanswered is free


def test_the_inbound_rate_is_optional() -> None:
    assert Settings.model_fields["telephony_cost_paise_per_minute_inbound"].default is None


async def _inbound_cost(inbound_rate: int | None) -> int:
    import asyncio
    import dataclasses

    from tests.test_dv_browser_voice import until
    from tests.test_ph_inbound import FakeStore
    from tests.test_voicelink_route import TOKEN, VL_LINE, _call, service

    store = FakeStore(line=VL_LINE)
    svc = dataclasses.replace(service(store=store), cost_paise_per_minute=100, cost_paise_per_minute_inbound=inbound_rate)
    sim, task = await _call(svc, TOKEN)
    await until(lambda: bool(sim.heard.marks), 5)
    await sim.speak_for(600)
    await sim.quiet_for(700)
    await until(lambda: len(store.progress) == 1, 5)
    await sim.hang_up()
    await asyncio.wait_for(task, 10)
    return int(store.finished[0][1].cost_paise)


def test_an_inbound_call_is_costed_at_the_inbound_rate_when_one_is_set() -> None:
    import asyncio

    assert asyncio.run(_inbound_cost(25)) == 25      # one started 60 s pulse at 25 paise, not the 100 of the general rate
    assert asyncio.run(_inbound_cost(None)) == 100   # unset: the one rate covers both directions
